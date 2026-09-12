// Cross-runtime domain identity: Web Crypto is available in Electron renderers
// and the supported Node runtime. Never import Node built-ins into this package.
export type Id = string;
export const createId = (): string => globalThis.crypto.randomUUID();
