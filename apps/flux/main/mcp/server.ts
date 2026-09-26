// The agent surface. Lumaflux's MCP server runs in the main process and owns
// three things at once: the loopback HTTP endpoint (bearer token, 127.0.0.1
// only, no browser origins), the folder-root check every path argument must
// pass, and the edit/inspect/export tools that call the same Commands the UI
// uses. The stdio bridge in this folder is the client-facing half: it is built
// to a single standalone file so an external MCP client can spawn it with
// `node` and it can reach the endpoint above.
import { editingGuide, editingInstructions } from "./editing-guide";
import { lensDatabaseInfo } from "@lumacast/photo-imaging";
import { importFormats } from "@lumacast/photo-model";
import { createServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  isInitializeRequest,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import { Commands, exportSchema } from "@lumacast/photo-library";
import {
  patchSchema,
  adjustmentControls,
  neutralRecipe,
} from "@lumacast/photo-model";

export async function assertAllowed(file: string, roots: string[]) {
  const canonical = await realpath(file);
  const allowed = await Promise.all(roots.map((root) => realpath(root)));
  if (
    !allowed.some((root) => {
      const rel = path.relative(root, canonical);
      return (
        rel === "" ||
        (!rel.startsWith(`..${path.sep}`) &&
          rel !== ".." &&
          !path.isAbsolute(rel))
      );
    })
  )
    throw new Error(
      "PATH_DENIED: Choose an allowed folder in Lumaflux agent settings",
    );
  return canonical;
}
const json = (value: unknown) => ({
  content: [
    { type: "text" as const, text: JSON.stringify(value ?? { ok: true }) },
  ],
});
const errorResult = (e: unknown) => ({
  isError: true,
  content: [
    {
      type: "text" as const,
      text: JSON.stringify({
        error: {
          code:
            e instanceof z.ZodError
              ? "INVALID_ARGUMENT"
              : (e as Error).message.split(":")[0] || "ERROR",
          message: (e as Error).message,
        },
      }),
    },
  ],
});
export function createMcpServer(commands: Commands, roots: string[]) {
  const server = new McpServer(
    { name: "lumaflux", version: "0.1.0" },
    {
      capabilities: { resources: { subscribe: true } },
      instructions: editingInstructions,
    },
  );
  const id = z.string().min(1);
  const expectedRevision = z.number().int().nonnegative();
  function tool(
    name: string,
    description: string,
    inputSchema: any,
    readOnly: boolean,
    handler: (args: any) => Promise<any>,
  ) {
    server.registerTool(
      name,
      {
        description,
        inputSchema,
        annotations: {
          readOnlyHint: readOnly,
          destructiveHint: !readOnly,
          idempotentHint: readOnly,
          openWorldHint: false,
        },
      },
      async (args: any) => {
        try {
          return await handler(args);
        } catch (e) {
          return errorResult(e);
        }
      },
    );
  }
  tool(
    "get_capabilities",
    "Discover supported formats, edit controls, geometry and revision semantics.",
    {},
    true,
    async () =>
      json({
        formats: importFormats,
        raw: true,
        exportFormats: ["jpeg", "png", "webp"],
        controls: adjustmentControls,
        geometry: {
          rotation: "0–3 quarter turns",
          straighten: "-45–45 degrees",
          crop: "normalized after lens correction/orientation/rotation/flips; null resets",
        },
        lensCorrection: {
          mode: "metadata-matched Lensfun profiles plus manual offsets",
          distortion:
            "-100–100; zero off; automatically keeps frame inside source",
          cornerIllumination: "0–100; compensates dark corners before geometry",
          chromaticAberration:
            "lensRed/lensBlue -100–100; radial channel alignment",
          profiles: lensDatabaseInfo,
        },
        denoising: {
          luminance: "noiseLuminance 0–100",
          color: "noiseColor 0–100",
          method:
            "separable edge-aware bilateral filter before tone and sharpening; zero bypasses",
        },
        photographyGuide: "lumaflux://guides/professional-editing",
        autoAdjust:
          "Measured Light adjustment per image; suggest_adjustments supports referenceId without copying values.",
        rawProcessing:
          "LibRaw camera WB; fixed brightness; 8-bit sRGB editing, no sensor highlight reconstruction.",
        atomicBatch: true,
        mutations:
          "Supply current expectedRevision. Undo/redo also increment revision.",
        maxBatch: 500,
      }),
  );
  tool(
    "get_editing_guide",
    "Read the professional photography workflow before editing. Covers RAW, composition, natural tone/color, adaptive reference matching, and visual verification.",
    {},
    true,
    async () => ({ content: [{ type: "text", text: editingGuide }] }),
  );
  server.registerResource(
    "professional-editing",
    "lumaflux://guides/professional-editing",
    {
      mimeType: "text/markdown",
      description: "Image-specific professional photo editing workflow",
    },
    async (uri) => ({ contents: [{ uri: uri.href, text: editingGuide }] }),
  );
  server.registerPrompt(
    "professional-photo-edit",
    {
      description:
        "Develop or reference-match photos with individual analysis and composition review.",
      argsSchema: { request: z.string(), referenceId: z.string().optional() },
    },
    async (a) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              editingGuide +
              "\n\nPhotography request: " +
              a.request +
              (a.referenceId ? "\nReference photo ID: " + a.referenceId : ""),
          },
        },
      ],
    }),
  );
  for (const [name, description, schema, readOnly] of [
    [
      "analyze_photo",
      "Measure the current rendered photo: tone, channel clipping, and color. Pair with get_preview for subject/composition judgment.",
      { id },
      true,
    ],
    [
      "get_lens_match",
      "Inspect camera/lens metadata and available calibrated corrections without editing.",
      { id },
      true,
    ],
    [
      "suggest_adjustments",
      "Analyze an individual photo and propose Light settings. Optional referenceId matches rendered tone rather than copying settings. Inspect candidate using get_preview(patch) before apply_edits.",
      { id, referenceId: id.optional() },
      true,
    ],
    [
      "auto_adjust",
      "Apply measured Light settings with undo. Optional referenceId adapts this photo to reference tone. Color, detail, and composition are preserved; visually review afterward.",
      { id, expectedRevision, referenceId: id.optional() },
      false,
    ],
    [
      "auto_lens_correction",
      "Apply a Lensfun calibration matched to camera/lens/focal metadata, preserving manual offsets. Returns warnings/no-match without guessed correction. Inspect rendered JPEGs for double correction.",
      { id, expectedRevision },
      false,
    ],
  ] as const)
    tool(name, description, schema, readOnly, async (a) =>
      json(await commands.run(name, a, "MCP")),
    );
  tool(
    "get_app_state",
    "Current selection, export jobs and recent activity; use list_photos for paginated library.",
    {},
    true,
    async () => {
      const s = commands.service.state();
      return json({
        selection: s.selection,
        jobs: s.jobs,
        activity: s.activity.slice(0, 30),
        photoCount: s.photos.length,
      });
    },
  );
  tool(
    "list_photos",
    "Search imported photos; excludes full history for compact results.",
    {
      query: z.string().default(""),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(200).default(50),
      favorite: z.boolean().optional(),
    },
    true,
    async (a) => {
      const photos = commands.service
        .state()
        .photos.filter(
          (p) =>
            p.name.toLowerCase().includes(a.query.toLowerCase()) &&
            (a.favorite === undefined || p.favorite === a.favorite),
        );
      return json({
        total: photos.length,
        photos: photos
          .slice(a.offset, a.offset + a.limit)
          .map(({ history, future, ...p }) => p),
      });
    },
  );
  tool(
    "get_photo",
    "Get metadata, current recipe and revision.",
    { id },
    true,
    async (a) => json(commands.service.photo(a.id)),
  );
  tool(
    "get_recipe",
    "Get current nondestructive edit recipe and revision.",
    { id },
    true,
    async (a) => {
      const p = commands.service.photo(a.id);
      return json({ id: p.id, revision: p.revision, recipe: p.recipe });
    },
  );
  tool("get_selection", "Get selected photo IDs.", {}, true, async () =>
    json(commands.service.state().selection),
  );
  tool(
    "import_photos",
    "Import existing files/folders inside configured roots. Originals remain untouched.",
    { paths: z.array(z.string()).min(1).max(500) },
    false,
    async (a) => {
      const paths = await Promise.all(
        a.paths.map((p: string) => assertAllowed(p, roots)),
      );
      return json(await commands.run("import_photos", { paths }, "MCP"));
    },
  );
  for (const [name, description, schema] of [
    [
      "set_selection",
      "Select photo IDs in the desktop gallery.",
      { ids: z.array(id).max(10000) },
    ],
    [
      "update_metadata",
      "Set a photo rating or favorite status.",
      {
        id,
        rating: z.number().int().min(0).max(5).optional(),
        favorite: z.boolean().optional(),
      },
    ],
    [
      "apply_edits",
      "Apply a partial recipe to a photo at its current revision.",
      { id, expectedRevision, patch: patchSchema },
    ],
    [
      "apply_batch_edits",
      "Atomically apply individually reviewed patches. For reference matching, call suggest_adjustments(referenceId) for each image instead of duplicating values. Identical patches are for explicit exact-sync requests. Conflicts change nothing.",
      {
        edits: z
          .array(
            z.object({ id, expectedRevision, patch: patchSchema }).strict(),
          )
          .min(1)
          .max(500),
      },
    ],
    [
      "reset_edits",
      "Reset adjustments and geometry; preserves undo history.",
      { id, expectedRevision },
    ],
    ["undo", "Undo one committed change.", { id, expectedRevision }],
    ["redo", "Redo one undone change.", { id, expectedRevision }],
    [
      "cancel_export_job",
      "Cancel remaining exports; completed files are retained.",
      { id },
    ],
  ] as const)
    tool(name, description, schema, false, async (a) =>
      json(await commands.run(name, a, "MCP")),
    );
  tool(
    "get_preview",
    "Visually inspect current, original, uncropped, or candidate edits without committing. patch is a partial recipe; original resets the base. Use uncropped to plan normalized composition. Returns image plus current revision.",
    {
      id,
      maxDimension: z.number().int().min(64).max(2000).default(1600),
      original: z.boolean().default(false),
      uncropped: z.boolean().default(false),
      patch: patchSchema.optional(),
    },
    true,
    async (a) => {
      const p = commands.service.photo(a.id);
      const candidate = {
        ...(a.original ? neutralRecipe() : p.recipe),
        ...a.patch,
        ...(a.uncropped ? { crop: null } : {}),
      };
      const bytes = await commands.preview(a.id, candidate, a.maxDimension);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              id: p.id,
              revision: p.revision,
              original: a.original,
              uncropped: a.uncropped,
              candidate: !!a.patch,
            }),
          },
          {
            type: "image",
            data: bytes.toString("base64"),
            mimeType: "image/jpeg",
          },
        ],
      };
    },
  );
  tool(
    "export_photos",
    "Queue full-resolution exports using recipe snapshots. Destination must be an allowed existing folder. Never overwrites files.",
    exportSchema.shape,
    false,
    async (a) => {
      a.directory = await assertAllowed(a.directory, roots);
      return json(await commands.run("export_photos", a, "MCP"));
    },
  );
  tool(
    "get_export_job",
    "Inspect export progress, output paths, and per-image errors.",
    { id },
    true,
    async (a) => json(await commands.run("get_export_job", a, "MCP")),
  );
  server.registerResource(
    "app-state",
    "lumaflux://app/state",
    { mimeType: "application/json" },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify({
            selection: commands.service.state().selection,
            photoCount: commands.service.state().photos.length,
            jobs: commands.service.state().jobs,
          }),
        },
      ],
    }),
  );
  server.registerResource(
    "photo",
    new ResourceTemplate("lumaflux://photos/{id}", { list: undefined }),
    { mimeType: "application/json" },
    async (uri, vars) => ({
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(commands.service.photo(String(vars.id))),
        },
      ],
    }),
  );
  const subscriptions = new Set<string>();
  server.server.setRequestHandler(SubscribeRequestSchema, async (request) => {
    const uri = request.params.uri;
    if (uri !== "lumaflux://app/state") {
      if (!uri.startsWith("lumaflux://photos/"))
        throw new McpError(ErrorCode.InvalidParams, "Unknown resource");
      commands.service.photo(uri.slice("lumaflux://photos/".length));
    }
    if (subscriptions.size >= 200 && !subscriptions.has(uri))
      throw new McpError(ErrorCode.InvalidParams, "Subscription limit reached");
    subscriptions.add(uri);
    return {};
  });
  server.server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
    subscriptions.delete(request.params.uri);
    return {};
  });
  const change = () => {
    for (const uri of subscriptions)
      server.server.sendResourceUpdated({ uri }).catch(() => {});
  };
  commands.service.on("change", change);
  const close = server.close.bind(server);
  server.close = async () => {
    commands.service.off("change", change);
    await close();
  };
  return server;
}
export async function startMcp(
  commands: Commands,
  options: { token: string; roots: string[]; port?: number },
) {
  const sessions = new Map<
    string,
    {
      transport: StreamableHTTPServerTransport;
      server: McpServer;
      lastUsed: number;
    }
  >();
  const http = createServer(async (req, res) => {
    const deny = (status: number, message: string) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    };
    const auth = Buffer.from(req.headers.authorization ?? "");
    const expected = Buffer.from(`Bearer ${options.token}`);
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) {
      deny(401, "Authentication required");
      return;
    }
    if (
      req.headers.origin ||
      !/^127\.0\.0\.1:\d+$/.test(req.headers.host ?? "")
    ) {
      deny(403, "Only local agent clients are allowed");
      return;
    }
    if (req.url !== "/mcp") {
      deny(404, "Not found");
      return;
    }
    try {
      const sessionId = req.headers["mcp-session-id"];
      let session =
        typeof sessionId === "string" ? sessions.get(sessionId) : undefined;
      let body: unknown;
      if (req.method === "POST") {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 1_048_576) {
            deny(413, "Request too large");
            return;
          }
          chunks.push(chunk);
        }
        body = JSON.parse(Buffer.concat(chunks).toString());
      }
      if (!session) {
        if (sessionId) {
          deny(404, "Session not found");
          return;
        }
        if (req.method !== "POST" || !isInitializeRequest(body)) {
          deny(400, "Initialize a session first");
          return;
        }
        if (sessions.size >= 16) {
          deny(429, "Too many agent sessions");
          return;
        }
        const server = createMcpServer(commands, options.roots);
        const transport: StreamableHTTPServerTransport =
          new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id: string): void => {
              sessions.set(id, { transport, server, lastUsed: Date.now() });
            },
          });
        transport.onclose = () => {
          if (transport.sessionId) sessions.delete(transport.sessionId);
          void server.close();
        };
        await server.connect(transport);
        session = { transport, server, lastUsed: Date.now() };
      }
      session.lastUsed = Date.now();
      await session.transport.handleRequest(req, res, body);
    } catch (e) {
      if (!res.headersSent) deny(400, (e as Error).message);
    }
  });
  const expiry = setInterval(() => {
    for (const [id, session] of sessions) {
      if (Date.now() - session.lastUsed > 30 * 60 * 1000) {
        sessions.delete(id);
        void session.server.close();
      }
    }
  }, 60_000);
  expiry.unref();
  http.requestTimeout = 30000;
  http.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(options.port ?? 0, "127.0.0.1", resolve);
  });
  const address = http.address();
  if (!address || typeof address === "string")
    throw new Error("Could not start MCP");
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: async () => {
      clearInterval(expiry);
      await Promise.all([...sessions.values()].map((s) => s.server.close()));
      sessions.clear();
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
