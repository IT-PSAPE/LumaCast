/**
 * Renderer-visible product name. Kept separate from main/app-identity.ts so
 * the renderer never imports main-process code; the two must be kept in sync
 * by hand until a shared constant package exists.
 */
export const PRODUCT_NAME = 'LumaCloud';
