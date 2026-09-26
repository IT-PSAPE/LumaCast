// Intentionally empty. The shell exposes no privileged API to the renderer
// yet, so nothing is bridged across the context boundary — adding a bridge
// here is what would later require a typed, audited channel here. The file
// still exists and is still referenced from main/window.ts so the window runs
// with a preload present from the start rather than gaining one later.
export {};
