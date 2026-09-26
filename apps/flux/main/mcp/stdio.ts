import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListResourceTemplatesRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
async function main() {
  const configPath = process.argv[2];
  if (!configPath)
    throw new Error(
      "Pass the connection file path shown in Lumaflux Agent settings.",
    );
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const url = new URL(config.url);
  if (url.hostname !== "127.0.0.1" || url.protocol !== "http:")
    throw new Error("Connection must use loopback HTTP");
  const client = new Client({
    name: "lumaflux-stdio-bridge",
    version: "0.1.0",
  });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${config.token}` } },
  });
  await client.connect(transport);
  const server = new Server(
    { name: "lumaflux", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => client.listTools());
  server.setRequestHandler(CallToolRequestSchema, (req) =>
    client.callTool(req.params),
  );
  server.setRequestHandler(ListResourcesRequestSchema, () =>
    client.listResources(),
  );
  server.setRequestHandler(ListResourceTemplatesRequestSchema, () =>
    client.listResourceTemplates(),
  );
  server.setRequestHandler(ReadResourceRequestSchema, (req) =>
    client.readResource(req.params),
  );
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await transport.terminateSession().catch(() => {});
    await client.close();
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
  process.stdin.on("end", close);
  await server.connect(new StdioServerTransport());
}
main().catch((e) => {
  console.error(
    `Lumaflux MCP: ${(e as Error).message}. Open Lumaflux and enable agent access.`,
  );
  process.exit(1);
});
