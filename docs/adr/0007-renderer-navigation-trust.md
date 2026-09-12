# ADR-0007: Renderer Navigation and Window-Open Trust Boundary

## Status

Accepted

## Context

Issue #158 (parent #119, depends on #114/#115) closes a gap found during the
2026-08 architecture review: the main process created its one `BrowserWindow`
without ever attaching `will-navigate` or `setWindowOpenHandler` listeners to
its `webContents`. Electron trusts the embedder to install these handlers —
without them, any script running in the renderer (a supply-chain compromise
of a dependency, a bug that lets untrusted content reach the DOM, or a future
regression) could navigate the main window to an arbitrary origin or spawn an
arbitrary new window, and Electron would allow it by default. The renderer
already reaches main only through the typed `castApi` IPC contract and the
app has `contextIsolation: true` / `nodeIntegration: false`
(`app/main/index.ts`), but navigation and window-creation were the one
remaining unguarded surface.

`app/main/security.ts` already had `isTrustedAppUrl` (exported as
`isTrustedWebContentsUrl`), used by `assertTrustedIpcSender` to check the
sender window's URL before trusting an IPC call. Reusing it for navigation
decisions was the obvious move, but auditing it against the escape and
credential cases this issue's acceptance criteria require surfaced two real
gaps, both fixed in this change rather than papered over with a parallel
check:

- Its `file:` branch matched the *packaged renderer path* with
  `normalizedPath.endsWith('/renderer/index.html')`. That is a suffix check,
  not an identity check: a `file://` URL pointing at
  `/tmp/attacker-controlled/renderer/index.html` — a directory with nothing
  to do with the app — satisfies the suffix and was wrongly treated as
  trusted. This is exactly the "local-file escape" case the acceptance
  criteria call out, so it had to be closed as part of meeting them. The fix
  compares against the *exact* expected path, computed the same way
  `app/main/index.ts`'s `loadRendererView` computes the file it loads
  (`path.join(__dirname, '../renderer/index.html')`); both files live in
  `app/main` and are bundled into the single `out/main/index.js` by
  `electron.vite.config.ts`'s lib-mode entry, so their `__dirname` is
  identical at runtime.
- Its `http:`/`https:` branch checked only `DEV_ALLOWED_HOSTS.has(parsed.hostname)`.
  A URL with embedded credentials, e.g. `https://user:pass@localhost/`,
  parses with `hostname === 'localhost'` and would have passed unchanged —
  the credentials were simply along for the ride. The fix rejects any
  `http:`/`https:` URL carrying a non-empty `username` or `password` before
  the host is even considered.

Both fixes live inside `isTrustedAppUrl`/`isTrustedWebContentsUrl` itself, so
`assertTrustedIpcSender` (an existing, unrelated caller) gets the same
hardening as a side effect, and there is exactly one function that answers
"is this URL the application's own origin," not two competing ones.

The one external destination the app opens today is
`shell.openExternal('https://openai.com')`, the Help menu's "Learn more" item
in `app/main/application-menu.ts` (outside this issue's write boundary, so it
was verified but not changed). The product is LumaCast, so this destination
does not obviously belong in its Help menu, and it reads as a placeholder —
but why it is there has not been established, so no provenance is claimed
here. It was kept exactly as-is in the allow-list below because changing it
is a product decision, not a security one; it needs a separate decision from
the maintainer. Should that URL change, this allow-list must change with it,
or the menu item will silently stop working.

No renderer code calls `window.open` or `target="_blank"`, and the renderer
has no exposed `openExternal` API today. The window-open handler added here
has no legitimate caller to preserve yet — it is pure hardening against
future or injected code, exercising the same deny-by-default posture as
`will-navigate`.

## Decision

- **Deny by default.** Both `will-navigate` and `setWindowOpenHandler` are
  attached to the main window's `webContents` in `createMainWindow()`
  (`app/main/index.ts`). Anything not explicitly allowed is denied; nothing
  is denied by pattern-matching known-bad input.
- **`will-navigate`** calls `isTrustedWebContentsUrl` (unchanged export,
  hardened implementation as above) and calls `event.preventDefault()` for
  anything else. This only ever gates renderer/user-initiated navigation —
  Electron does not fire `will-navigate` for the app's own initial
  `loadFile`/`loadURL` call or for in-page navigation, so normal startup and
  the `?view=ui-spec` query param are unaffected.
- **The window-open handler** always returns `{ action: 'deny' }`, so
  Electron never creates a new `BrowserWindow` or tab from renderer-requested
  navigation. Before returning, it checks the target URL against
  `isApprovedExternalUrl`; if approved, it calls `shell.openExternal(url)` so
  the destination still opens, just in the OS default browser rather than a
  new Electron window this process would have to sandbox and manage.
- **The allow-list.** `app/main/security.ts` defines two, kept intentionally
  separate because they answer different questions:
  - The *application origin* check (`isTrustedWebContentsUrl`): the dev
    server host set already in `DEV_ALLOWED_HOSTS`
    (`localhost`, `127.0.0.1`, `[::1]`, matched by hostname only — the dev
    server's port is not pinned) for `http:`/`https:`, or the exact packaged
    `file://…/renderer/index.html` path for production. This set is fixed by
    what `loadRendererView` already loads at startup; extending it means
    extending what the app itself is allowed to load, which is an
    application-startup decision, not a per-feature one.
  - The *approved external origins* allow-list (`APPROVED_EXTERNAL_ORIGINS`
    in `app/main/security.ts`), matched by origin (scheme + host + port), not
    full URL: today it contains exactly one entry,
    `https://openai.com` (the Help-menu destination above). Only `https:`
    destinations may be added, and adding one is a source-code change to
    that constant reviewed like any other change to this file — never
    something populated from renderer input, IPC payloads, or configuration.
    A future entry should record here (by amending this ADR) which caller it
    serves and why.
- **Credentials in a URL are always denied**, in both allow-lists,
  independent of whether the bare host would otherwise match — a URL is
  either trusted by construction (the app's own load, or a reviewed
  allow-list entry) or it is not, and stripping/ignoring embedded credentials
  to make an otherwise-good match is not a case this app needs to support.
- **Denial never logs or surfaces the denied URL itself.** A `file:` URL can
  contain an absolute filesystem path (usernames, project directory names,
  etc.), so both handlers log only `describeUrlSchemeForLogging(url)` — the
  URL's scheme (e.g. `'file:'`, `'https:'`), or the literal string
  `'unparseable'` — never the host, path, query, or full string.
- **The `cast-media:` scheme is unaffected by this change and is not part of
  this allow-list.** It is a separately privileged custom scheme
  (`protocol.registerSchemesAsPrivileged`, `{ secure: true, supportFetchAPI:
  true, stream: true }`) that the renderer's own `<audio>`/`<video>` elements
  fetch from, gated by `resolveTrustedCastMediaRequest`
  (referrer-checked against the same `isTrustedAppUrl`, then resolved through
  `resolveLocalMediaSourcePath`). It is a resource-fetch boundary, not a
  navigation or window-creation target, and neither `will-navigate` nor the
  window-open handler ever needs to allow it — a `cast-media:` URL cannot
  satisfy either check because neither allow-list lists that scheme, so
  navigating the top-level frame to a `cast-media:` URL (as opposed to
  fetching a resource from it) is correctly denied too.

  **Superseded in part by ADR-0008 (issue #159), on the resolution mechanism
  only.** The parenthetical above described `resolveTrustedCastMediaRequest` as
  resolving "through `resolveLocalMediaSourcePath`" — that is, decoding an
  absolute filesystem path out of the URL the renderer supplied. It no longer
  does: the URL now carries an opaque managed media id resolved against a
  main-owned registry, and a URL carrying an encoded path is denied. The
  referrer check is retained. The conclusion of this bullet is unchanged —
  `cast-media:` remains a resource-fetch boundary belonging to neither
  navigation allow-list.
- **Sandboxing (`webPreferences.sandbox`) stays `false` in this slice**,
  unchanged from the existing `createRendererWindowOptions`. This issue only
  closes the navigation/window-open gap; enabling the Chromium OS sandbox for
  the renderer process is a separate, larger change with its own
  prerequisites that have not been verified yet:
  - The preload script (`app/main/preload.ts`) must work under the sandboxed
    preload environment (no Node built-ins beyond what
    `contextBridge`/`ipcRenderer` expose; today's preload has not been
    audited for this).
  - Renderer-side dependencies (Konva/react-konva, NDI-adjacent audio/video
    element handling, `cast-media:` fetches) must be verified to still work
    with `nodeIntegration`/preload Node access further restricted than
    today's `contextIsolation: true, nodeIntegration: false` already
    provides.
  - The build/packaging pipeline (`electron-builder.yml`) needs the sandboxed
    renderer binary/entitlements confirmed for macOS notarization and
    Windows code signing, which have not been checked as part of this issue.

  Until those are verified, sandboxing is out of scope; this ADR records the
  decision explicitly so it is not silently assumed to already be enabled.

## Consequences

- Renderer-initiated navigation to anything other than the app's own origin
  is now impossible; a compromised or buggy renderer cannot pivot the main
  window to an attacker-controlled page.
- Renderer-initiated `window.open`/`target="_blank"` can no longer create a
  new, unmanaged `BrowserWindow`; the only observable effect of a call
  targeting the one approved external origin is the OS default browser
  opening, which is the same outcome as today's Help-menu behavior via
  `shell.openExternal`, minus ever spawning a second Electron window.
- Extending either allow-list is a reviewed, in-repo source change (this file
  plus this ADR), never a runtime-configurable value — there is no path for
  renderer code, IPC, or user input to add a trusted origin or an approved
  external destination.
- Fixing `isTrustedWebContentsUrl`'s file-path and credentials handling also
  hardens `assertTrustedIpcSender`, its only other caller, without changing
  its contract: a `file://` escape or a credentialed sender URL that
  previously might have been accepted is now rejected there too.
- Sandboxing remains disabled; this is a known, explicitly recorded gap, not
  an oversight, and the prerequisites above are the concrete next steps
  before it can be revisited.
