// Public entry point for @lumacast/composition (issue #219; item-model
// refactor wave A). This package is the visual-document domain model: the
// three independent item entities (Presentation/Lyric/Talk) and the global
// playlists built from them, slide/element/theme/overlay/stage entities,
// rich text, and the headless scene-normalization contract (RenderScene /
// ResolvedRenderScene) every rendering surface — editor preview, NDI
// capture, thumbnails — shares. There is no unified "deck item" concept, no
// collections, and no library grouping playlists — see #219 decisions
// D1/D3/D4 for why.
//
// Every export below is re-exported whole-module (`export *`) rather than
// individually named, per the package convention: none of the modules below
// export colliding names, so a blanket re-export keeps this file mechanical
// and low-churn as the package grows. If a future addition collides, resolve
// it explicitly here rather than dropping to deep imports.

// ---------------------------------------------------------------------------
// Domain primitives (the entity model).
// ---------------------------------------------------------------------------
export * from './domain/items';
export * from './domain/media-assets';
export * from './domain/overlays';
export * from './domain/playlists';
export * from './domain/slide-elements';
export * from './domain/slides';
export * from './domain/stages';
export * from './domain/theme';

// ---------------------------------------------------------------------------
// Rich text (canonical Rich Body model, run resolution, measurement, edits).
// ---------------------------------------------------------------------------
export * from './rich-text/types';
export * from './rich-text/resolve';
export * from './rich-text/serialize';
export * from './rich-text/edit';
export * from './rich-text/measure';

// ---------------------------------------------------------------------------
// Composition-domain helpers.
// ---------------------------------------------------------------------------
export * from './binding-values';
export * from './clone';
export * from './element-payload';
export * from './items';
export * from './playlist-item-reference';
export * from './presentation-layers';
export * from './themes';

// ---------------------------------------------------------------------------
// Headless scene-normalization contract (moved from app/renderer; carries no
// React/Konva/DOM — see src/scene for the boundary note on what stayed behind).
// ---------------------------------------------------------------------------
export * from './scene/scene-types';
export * from './scene/scene-traversal';
