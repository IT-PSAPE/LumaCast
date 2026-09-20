// The canonical action registry (resolves `TODO(commands-canonical-ids)`,
// continued from `actions.ts`). `ActionId` is the one string-literal-union
// namespace every command surface — keyboard shortcuts, the native app menu,
// the command palette, the in-app agent, and the MCP server — maps into.
// `ACTION_METADATA` is the source of truth an agent principal reads to
// decide whether an action is safe to call and what it does; the two
// `*_TO_ACTION_ID` maps translate the two legacy vocabularies in this
// package (`ShortcutActionId`, `AppMenuCommandId`) into this space so a
// caller can go from "the user pressed Cmd+D" or "the Edit menu sent
// edit.duplicate" straight to a canonical action id.
//
// Naming: `<domain>.<verbNoun>`, lower camel case after the dot. One id per
// agent-meaningful operation, not one id per RPC method — several legacy
// per-type methods (e.g. `renamePresentation`/`renameLyric`, or
// `createPresentation`/`createLyric`/`createItem`) collapse into a single
// generic action (`item.rename`, `item.create`) because they differ only in
// which table the id happens to live in, a distinction the domain model
// already erases via `ItemRef`/`ItemType`.
import type { ActionExecutionSite, ActionRiskClass } from './actions';
import type { AppMenuCommandId } from './app-menu';
import type { ShortcutActionId } from './shortcuts';

export type ActionId =
  // --- Playlists (main) ---
  | 'playlist.create'
  | 'playlist.rename'
  | 'playlist.delete'
  | 'playlist.setOrder'
  | 'playlist.list'
  | 'playlist.get'
  | 'playlist.addItem'
  | 'playlist.moveRow'
  | 'playlist.removeRow'
  | 'separator.create'
  | 'separator.rename'
  | 'separator.setColor'
  // --- Items (main) ---
  | 'item.create'
  | 'item.duplicate'
  | 'item.rename'
  | 'item.move'
  | 'item.delete'
  | 'item.list'
  | 'item.get'
  | 'item.applyTheme'
  | 'item.detachTheme'
  | 'lyric.setBlankSlides'
  // --- Slides (main) ---
  | 'slide.create'
  | 'slide.duplicate'
  | 'slide.delete'
  | 'slide.setOrder'
  | 'slide.updateNotes'
  | 'slide.updateBackground'
  | 'slide.get'
  | 'slideTag.create'
  | 'slideTag.update'
  | 'slideTag.delete'
  | 'slideTag.assign'
  | 'slideTag.list'
  | 'timer.create'
  | 'timer.update'
  | 'timer.delete'
  // --- Elements (main) ---
  | 'element.create'
  | 'element.createMany'
  | 'element.update'
  | 'element.updateMany'
  | 'element.delete'
  | 'element.deleteMany'
  // --- Media (main) ---
  | 'media.import'
  | 'media.delete'
  | 'media.replaceSource'
  | 'media.reclaimLibrary'
  | 'media.ensureDerivative'
  | 'media.list'
  // --- Overlays (main) ---
  | 'overlay.create'
  | 'overlay.update'
  | 'overlay.setEnabled'
  | 'overlay.delete'
  | 'overlay.setOrder'
  | 'overlay.applyTheme'
  | 'overlay.list'
  // --- Themes (main) ---
  | 'theme.create'
  | 'theme.update'
  | 'theme.delete'
  | 'theme.setOrder'
  | 'theme.syncLinkedItems'
  | 'theme.list'
  // --- Stages (main) ---
  | 'stage.create'
  | 'stage.update'
  | 'stage.delete'
  | 'stage.duplicate'
  | 'stage.setOrder'
  | 'stage.list'
  // --- Automation defs (main) ---
  | 'cue.create'
  | 'cue.update'
  | 'cue.delete'
  | 'cue.list'
  | 'macro.create'
  | 'macro.update'
  | 'macro.delete'
  | 'macro.setOrder'
  | 'macro.list'
  | 'triggerBinding.create'
  | 'triggerBinding.delete'
  | 'triggerBinding.list'
  | 'schedule.save'
  | 'schedule.delete'
  | 'schedule.list'
  // --- Project (main) ---
  | 'project.getSnapshot'
  | 'project.getOverview'
  | 'project.search'
  | 'project.exportBundle'
  | 'project.inspectBundle'
  | 'project.importBundle'
  | 'project.restoreBackup'
  // --- Output (main) ---
  | 'output.setEnabled'
  | 'output.getState'
  | 'output.getConfigs'
  | 'output.updateConfig'
  | 'output.getDiagnostics'
  // --- System (main) ---
  | 'clipboard.read'
  | 'clipboard.write'
  | 'logs.listSessions'
  | 'logs.readSession'
  | 'logs.getCurrentPath'
  | 'logs.getSystemMetrics'
  // --- Reserved for upcoming features (main) ---
  | 'document.extractText'
  // --- Canvas grouping/align, rich text, and slide rendering (renderer) ---
  | 'slide.render'
  | 'slide.renderContactSheet'
  | 'element.setRichText'
  | 'element.group'
  | 'element.ungroup'
  | 'element.align'
  | 'element.distribute'
  // --- Take/nav (renderer) ---
  | 'slide.take'
  | 'slide.activate'
  | 'slide.next'
  | 'slide.previous'
  | 'slide.jumpTo'
  | 'slide.select'
  | 'slide.selectRange'
  // --- Layers (renderer) ---
  | 'overlay.activate'
  | 'overlay.clear'
  | 'overlay.clearAll'
  | 'overlay.setMode'
  | 'mediaLayer.set'
  | 'mediaLayer.clear'
  | 'layer.clearContent'
  | 'layer.clearAll'
  // --- Video transport (renderer) ---
  | 'video.arm'
  | 'video.clear'
  | 'video.play'
  | 'video.pause'
  | 'video.seek'
  | 'video.setVolume'
  | 'video.toggleMute'
  | 'video.toggleLoop'
  | 'video.next'
  | 'video.previous'
  // --- Audio transport (renderer) ---
  | 'audio.arm'
  | 'audio.clear'
  | 'audio.play'
  | 'audio.pause'
  | 'audio.seek'
  | 'audio.setVolume'
  | 'audio.toggleMute'
  | 'audio.toggleLoop'
  | 'audio.next'
  | 'audio.previous'
  | 'audioSync.resume'
  // --- Stage (renderer) ---
  | 'stage.arm'
  | 'stage.clear'
  // --- Timers (renderer) ---
  | 'timer.start'
  | 'timer.stop'
  | 'timer.reset'
  | 'timer.resetAll'
  // --- Automation exec (renderer) ---
  | 'macro.run'
  | 'macro.cancelAll'
  | 'cue.run'
  // --- Workbench (renderer) ---
  | 'workbench.setMode'
  | 'workbench.openSettings'
  | 'workbench.togglePanel'
  | 'workbench.setSlideBrowserMode'
  | 'workbench.setProgramMode'
  | 'commandPalette.open'
  | 'lyricEditor.open'
  | 'editor.saveChanges'
  // --- Navigation/selection (renderer) ---
  | 'navigation.selectPlaylist'
  | 'navigation.selectPlaylistEntry'
  | 'navigation.browseItem'
  // --- Element editing (renderer) ---
  | 'element.select'
  | 'element.selectMany'
  | 'element.clearSelection'
  | 'element.copy'
  | 'element.cut'
  | 'element.paste'
  | 'element.duplicateSelection'
  | 'element.nudge'
  | 'element.bringToFront'
  | 'element.sendToBack'
  | 'element.bringForward'
  | 'element.sendBackward'
  | 'element.toggleVisibility'
  | 'element.toggleLock'
  | 'element.rename'
  // --- History (renderer) ---
  | 'edit.undo'
  | 'edit.redo';

export interface ActionMetadata {
  id: ActionId;
  /** Short imperative title, e.g. "Create playlist". */
  title: string;
  /** One or two sentences an agent can read to decide whether to call it. */
  description: string;
  risk: ActionRiskClass;
  site: ActionExecutionSite;
}

export const ACTION_METADATA: Readonly<Record<ActionId, ActionMetadata>> = {
  // --- Playlists (main) ---
  'playlist.create': {
    id: 'playlist.create',
    title: 'Create playlist',
    description: 'Creates a new, empty playlist with the given name. Always succeeds; returns the snapshot patch containing the new playlist.',
    risk: 'write',
    site: 'main',
  },
  'playlist.rename': {
    id: 'playlist.rename',
    title: 'Rename playlist',
    description: 'Renames an existing playlist. The playlist must already exist; returns the snapshot patch with the updated name.',
    risk: 'write',
    site: 'main',
  },
  'playlist.delete': {
    id: 'playlist.delete',
    title: 'Delete playlist',
    description: 'Permanently deletes a playlist and its row list. Not reversible through undo; the presentations/lyrics referenced by its rows are not deleted. Returns the resulting snapshot patch.',
    risk: 'destructive',
    site: 'main',
  },
  'playlist.setOrder': {
    id: 'playlist.setOrder',
    title: 'Reorder playlist',
    description: 'Moves a playlist to a new absolute position (or one step up/down) among all playlists. Out-of-range targets clamp to the nearest end; returns the snapshot patch with the new order.',
    risk: 'write',
    site: 'main',
  },
  'playlist.list': {
    id: 'playlist.list',
    title: 'List playlists',
    description: 'Returns every playlist with its row list. Read-only; call before addItem/moveRow/removeRow to resolve ids.',
    risk: 'read',
    site: 'main',
  },
  'playlist.get': {
    id: 'playlist.get',
    title: 'Get playlist',
    description: 'Returns a single playlist and its ordered rows by id, or null if it does not exist. Read-only.',
    risk: 'read',
    site: 'main',
  },
  'playlist.addItem': {
    id: 'playlist.addItem',
    title: 'Add item to playlist',
    description: 'Attaches an existing presentation or lyric to a playlist as a new row, appended unless a position is given. The item must already exist; returns the snapshot patch with the new row.',
    risk: 'write',
    site: 'main',
  },
  'playlist.moveRow': {
    id: 'playlist.moveRow',
    title: 'Move playlist row',
    description: "Moves one row (an item entry or a separator) to a new position within its playlist's flat row list. Returns the snapshot patch with the new row order.",
    risk: 'write',
    site: 'main',
  },
  'playlist.removeRow': {
    id: 'playlist.removeRow',
    title: 'Remove playlist row',
    description: 'Detaches a row from its playlist without deleting the underlying presentation, lyric, or separator it references. Returns the snapshot patch reflecting the removal.',
    risk: 'write',
    site: 'main',
  },
  'separator.create': {
    id: 'separator.create',
    title: 'Create separator',
    description: 'Inserts a labeled divider row into a playlist. The playlist must exist; returns the snapshot patch with the new separator row.',
    risk: 'write',
    site: 'main',
  },
  'separator.rename': {
    id: 'separator.rename',
    title: 'Rename separator',
    description: 'Changes a separator row’s label. The separator must exist; returns the snapshot patch with the updated label.',
    risk: 'write',
    site: 'main',
  },
  'separator.setColor': {
    id: 'separator.setColor',
    title: 'Set separator color',
    description: 'Sets or clears a separator row’s color key (null clears it back to the default). Returns the snapshot patch with the updated color.',
    risk: 'write',
    site: 'main',
  },
  // --- Items (main) ---
  'item.create': {
    id: 'item.create',
    title: 'Create item',
    description: 'Creates a new presentation or lyric item, optionally placed into a playlist at creation time. Returns the created item’s id and ref.',
    risk: 'write',
    site: 'main',
  },
  'item.duplicate': {
    id: 'item.duplicate',
    title: 'Duplicate item',
    description: 'Creates a copy of an existing presentation or lyric, including its slides and elements. The source item must exist; returns the new item’s id and ref.',
    risk: 'write',
    site: 'main',
  },
  'item.rename': {
    id: 'item.rename',
    title: 'Rename item',
    description: 'Renames a presentation or lyric, addressed by its ItemRef. The item must exist; returns the snapshot patch with the updated title.',
    risk: 'write',
    site: 'main',
  },
  'item.move': {
    id: 'item.move',
    title: 'Move item',
    description: "Moves a presentation or lyric one position up or down within its own type’s order (presentations and lyrics reorder independently). Returns the snapshot patch with the new order.",
    risk: 'write',
    site: 'main',
  },
  'item.delete': {
    id: 'item.delete',
    title: 'Delete item',
    description: 'Permanently deletes a presentation or lyric, including its slides and elements. Not reversible through undo. Returns the resulting snapshot patch.',
    risk: 'destructive',
    site: 'main',
  },
  'item.list': {
    id: 'item.list',
    title: 'List items',
    description: 'Returns every presentation and lyric item. Read-only; use to resolve an ItemRef before calling other item actions.',
    risk: 'read',
    site: 'main',
  },
  'item.get': {
    id: 'item.get',
    title: 'Get item',
    description: 'Returns a single presentation or lyric by its ItemRef, or null if it does not exist. Read-only.',
    risk: 'read',
    site: 'main',
  },
  'item.applyTheme': {
    id: 'item.applyTheme',
    title: 'Apply theme to item',
    description: 'Applies an existing theme to a presentation or lyric’s slides. Both the theme and the item must already exist; returns the snapshot patch.',
    risk: 'write',
    site: 'main',
  },
  'item.detachTheme': {
    id: 'item.detachTheme',
    title: 'Detach theme from item',
    description: 'Removes the theme association from an item without deleting the theme itself. Returns the snapshot patch with the item’s theme cleared.',
    risk: 'write',
    site: 'main',
  },
  'lyric.setBlankSlides': {
    id: 'lyric.setBlankSlides',
    title: 'Set lyric blank slides',
    description: 'Configures runtime-only blank slides at the start, end, both ends, or neither end of a lyric. Returns the updated lyric patch.',
    risk: 'write',
    site: 'main',
  },
  // --- Slides (main) ---
  'slide.create': {
    id: 'slide.create',
    title: 'Create slide',
    description: 'Creates a new slide in an item at the given position. The owning item must exist; returns the snapshot patch with the new slide.',
    risk: 'write',
    site: 'main',
  },
  'slide.duplicate': {
    id: 'slide.duplicate',
    title: 'Duplicate slide',
    description: 'Creates a copy of an existing slide, including its elements, immediately after the source. Returns the snapshot patch with the new slide.',
    risk: 'write',
    site: 'main',
  },
  'slide.delete': {
    id: 'slide.delete',
    title: 'Delete slide',
    description: 'Permanently deletes a slide and its elements. Not reversible through undo. Returns the resulting snapshot patch.',
    risk: 'destructive',
    site: 'main',
  },
  'slide.setOrder': {
    id: 'slide.setOrder',
    title: 'Reorder slide',
    description: "Moves a slide to a new position within its item's slide list. Returns the snapshot patch with the new order.",
    risk: 'write',
    site: 'main',
  },
  'slide.updateNotes': {
    id: 'slide.updateNotes',
    title: 'Update slide notes',
    description: 'Replaces a slide’s presenter notes text. The slide must exist; returns the snapshot patch with the updated notes.',
    risk: 'write',
    site: 'main',
  },
  'slide.updateBackground': {
    id: 'slide.updateBackground',
    title: 'Update slide background',
    description: 'Changes a slide’s background (color, or a media reference). The slide must exist; returns the snapshot patch with the updated background.',
    risk: 'write',
    site: 'main',
  },
  'slide.get': {
    id: 'slide.get',
    title: 'Get slide',
    description: 'Returns a single slide, including its elements, by id, or null if it does not exist. Read-only.',
    risk: 'read',
    site: 'main',
  },
  'slideTag.create': {
    id: 'slideTag.create',
    title: 'Create slide tag',
    description: 'Creates a new reusable slide tag definition (label/color). Returns the snapshot patch with the new tag.',
    risk: 'write',
    site: 'main',
  },
  'slideTag.update': {
    id: 'slideTag.update',
    title: 'Update slide tag',
    description: 'Changes an existing slide tag’s label or color. The tag must exist; returns the snapshot patch with the update.',
    risk: 'write',
    site: 'main',
  },
  'slideTag.delete': {
    id: 'slideTag.delete',
    title: 'Delete slide tag',
    description: 'Permanently deletes a slide tag definition and unassigns it from every slide that used it. Not reversible through undo. Returns the resulting snapshot patch.',
    risk: 'destructive',
    site: 'main',
  },
  'slideTag.assign': {
    id: 'slideTag.assign',
    title: 'Assign slide tags',
    description: 'Sets the tags assigned to a slide. Both the slide and every tag id must already exist; returns the snapshot patch with the updated assignment.',
    risk: 'write',
    site: 'main',
  },
  'slideTag.list': {
    id: 'slideTag.list',
    title: 'List slide tags',
    description: 'Returns every slide tag definition. Read-only; use to resolve tag ids before calling slideTag.assign.',
    risk: 'read',
    site: 'main',
  },
  'timer.create': {
    id: 'timer.create',
    title: 'Create timer',
    description: 'Creates a new named timer (countdown, countdown-to-time, or elapsed). Returns the snapshot patch with the new timer.',
    risk: 'write',
    site: 'main',
  },
  'timer.update': {
    id: 'timer.update',
    title: 'Update timer',
    description: 'Changes an existing timer’s configuration (kind, duration, target time, format, thresholds, order). The timer must exist; returns the snapshot patch with the update.',
    risk: 'write',
    site: 'main',
  },
  'timer.delete': {
    id: 'timer.delete',
    title: 'Delete timer',
    description: 'Permanently deletes a timer definition. Text elements linked to it keep their link and render a placeholder. Not reversible through undo. Returns the resulting snapshot patch.',
    risk: 'destructive',
    site: 'main',
  },
  // --- Elements (main) ---
  'element.create': {
    id: 'element.create',
    title: 'Create element',
    description: 'Creates a single element (text, shape, image, or video) on a slide. The slide must exist; returns the snapshot patch with the new element.',
    risk: 'write',
    site: 'main',
  },
  'element.createMany': {
    id: 'element.createMany',
    title: 'Create elements',
    description: 'Creates a batch of elements across one or more slides in one call. All target slides must exist; returns one snapshot patch covering every created element.',
    risk: 'write',
    site: 'main',
  },
  'element.update': {
    id: 'element.update',
    title: 'Update element',
    description: 'Updates a single element’s properties (position, size, content, style). The element must exist; returns the snapshot patch with the update.',
    risk: 'write',
    site: 'main',
  },
  'element.updateMany': {
    id: 'element.updateMany',
    title: 'Update elements',
    description: 'Updates a batch of elements in one call (e.g. a multi-element drag or nudge). Rejects if any referenced element no longer exists; returns one snapshot patch covering every update.',
    risk: 'write',
    site: 'main',
  },
  'element.delete': {
    id: 'element.delete',
    title: 'Delete element',
    description: 'Permanently deletes a single element from its slide. Not reversible through undo. Returns the resulting snapshot patch.',
    risk: 'destructive',
    site: 'main',
  },
  'element.deleteMany': {
    id: 'element.deleteMany',
    title: 'Delete elements',
    description: 'Permanently deletes a batch of elements in one call. Not reversible through undo. Returns one snapshot patch covering every deletion.',
    risk: 'destructive',
    site: 'main',
  },
  // --- Media (main) ---
  'media.import': {
    id: 'media.import',
    title: 'Import media',
    description: 'Registers a new media asset from a file on the user’s filesystem into the media library. Reads outside the library, so treat as a filesystem access. Returns the snapshot patch with the new asset.',
    risk: 'filesystem',
    site: 'main',
  },
  'media.delete': {
    id: 'media.delete',
    title: 'Delete media asset',
    description: 'Permanently removes a media asset from the library. Elements referencing it are left with a dangling reference; not reversible through undo. Returns the resulting snapshot patch.',
    risk: 'destructive',
    site: 'main',
  },
  'media.replaceSource': {
    id: 'media.replaceSource',
    title: 'Replace media source',
    description: 'Repoints an existing media asset at a different source file on the user’s filesystem. Reads outside the library, so treat as a filesystem access. Returns the snapshot patch with the updated source.',
    risk: 'filesystem',
    site: 'main',
  },
  'media.reclaimLibrary': {
    id: 'media.reclaimLibrary',
    title: 'Reclaim media library',
    description: 'Scans the media library and permanently deletes derivative files and cache entries no asset references anymore. Not reversible through undo. Returns a summary of what was reclaimed.',
    risk: 'destructive',
    site: 'main',
  },
  'media.ensureDerivative': {
    id: 'media.ensureDerivative',
    title: 'Ensure media derivative',
    description: 'Ensures a playable/previewable derivative (e.g. a thumbnail or transcode) exists for a media asset, generating it if missing. The asset must exist; returns the derivative’s location and status.',
    risk: 'read',
    site: 'main',
  },
  'media.list': {
    id: 'media.list',
    title: 'List media assets',
    description: 'Returns every media asset in the library. Read-only; use to resolve asset ids before calling other media actions.',
    risk: 'read',
    site: 'main',
  },
  // --- Overlays (main) ---
  'overlay.create': {
    id: 'overlay.create',
    title: 'Create overlay',
    description: 'Creates a new overlay definition (its elements, animation, and auto-clear settings). Returns the snapshot patch with the new overlay.',
    risk: 'write',
    site: 'main',
  },
  'overlay.update': {
    id: 'overlay.update',
    title: 'Update overlay',
    description: 'Updates an existing overlay definition’s properties. The overlay must exist; returns the snapshot patch with the update.',
    risk: 'write',
    site: 'main',
  },
  'overlay.setEnabled': {
    id: 'overlay.setEnabled',
    title: 'Enable or disable overlay',
    description: 'Sets whether an overlay definition is available to be activated. This only toggles availability in the picker, not whether it is currently shown live — see overlay.activate for that. Returns the snapshot patch with the flag.',
    risk: 'write',
    site: 'main',
  },
  'overlay.delete': {
    id: 'overlay.delete',
    title: 'Delete overlay',
    description: 'Permanently deletes an overlay definition. Not reversible through undo. Returns the resulting snapshot patch.',
    risk: 'destructive',
    site: 'main',
  },
  'overlay.setOrder': {
    id: 'overlay.setOrder',
    title: 'Reorder overlay',
    description: 'Moves an overlay to a new position in the overlay list. Returns the snapshot patch with the new order.',
    risk: 'write',
    site: 'main',
  },
  'overlay.applyTheme': {
    id: 'overlay.applyTheme',
    title: 'Apply theme to overlay',
    description: 'Applies an existing theme to an overlay’s elements. Both the theme and the overlay must already exist; returns the snapshot patch.',
    risk: 'write',
    site: 'main',
  },
  'overlay.list': {
    id: 'overlay.list',
    title: 'List overlays',
    description: 'Returns every overlay definition. Read-only; use to resolve overlay ids before calling other overlay actions.',
    risk: 'read',
    site: 'main',
  },
  // --- Themes (main) ---
  'theme.create': {
    id: 'theme.create',
    title: 'Create theme',
    description: 'Creates a new theme for one owner type (presentation, lyric, or overlay). Returns the snapshot patch with the new theme.',
    risk: 'write',
    site: 'main',
  },
  'theme.update': {
    id: 'theme.update',
    title: 'Update theme',
    description: 'Updates an existing theme’s properties. The theme must exist; returns the snapshot patch with the update.',
    risk: 'write',
    site: 'main',
  },
  'theme.delete': {
    id: 'theme.delete',
    title: 'Delete theme',
    description: 'Permanently deletes a theme from its owner-type table. Items and overlays that had it applied fall back to no theme. Not reversible through undo. Returns the resulting snapshot patch.',
    risk: 'destructive',
    site: 'main',
  },
  'theme.setOrder': {
    id: 'theme.setOrder',
    title: 'Reorder theme',
    description: 'Moves a theme to a new position within its owner-type’s theme list. Returns the snapshot patch with the new order.',
    risk: 'write',
    site: 'main',
  },
  'theme.syncLinkedItems': {
    id: 'theme.syncLinkedItems',
    title: 'Sync theme to linked items',
    description: 'Re-applies a theme’s current properties to every presentation or lyric already linked to it. Scoped to one item type; overlay themes have no linked-item concept to sync. Returns the snapshot patch.',
    risk: 'write',
    site: 'main',
  },
  'theme.list': {
    id: 'theme.list',
    title: 'List themes',
    description: 'Returns every theme across all owner types. Read-only; use to resolve theme ids before applying or syncing one.',
    risk: 'read',
    site: 'main',
  },
  // --- Stages (main) ---
  'stage.create': {
    id: 'stage.create',
    title: 'Create stage',
    description: 'Creates a new stage-display layout definition. Returns the snapshot patch with the new stage.',
    risk: 'write',
    site: 'main',
  },
  'stage.update': {
    id: 'stage.update',
    title: 'Update stage',
    description: 'Updates an existing stage-display layout’s properties. The stage must exist; returns the snapshot patch with the update.',
    risk: 'write',
    site: 'main',
  },
  'stage.delete': {
    id: 'stage.delete',
    title: 'Delete stage',
    description: 'Permanently deletes a stage-display layout. Not reversible through undo. Returns the resulting snapshot patch.',
    risk: 'destructive',
    site: 'main',
  },
  'stage.duplicate': {
    id: 'stage.duplicate',
    title: 'Duplicate stage',
    description: 'Creates a copy of an existing stage-display layout. Returns the snapshot patch with the new stage.',
    risk: 'write',
    site: 'main',
  },
  'stage.setOrder': {
    id: 'stage.setOrder',
    title: 'Reorder stage',
    description: 'Moves a stage layout to a new position in the stage list. Returns the snapshot patch with the new order.',
    risk: 'write',
    site: 'main',
  },
  'stage.list': {
    id: 'stage.list',
    title: 'List stages',
    description: 'Returns every stage-display layout. Read-only; use to resolve stage ids before calling other stage actions.',
    risk: 'read',
    site: 'main',
  },
  // --- Automation defs (main) ---
  'cue.create': {
    id: 'cue.create',
    title: 'Create cue',
    description: 'Creates a new automation cue definition. Returns the snapshot patch with the new cue.',
    risk: 'write',
    site: 'main',
  },
  'cue.update': {
    id: 'cue.update',
    title: 'Update cue',
    description: 'Updates an existing cue’s properties. The cue must exist; returns the snapshot patch with the update.',
    risk: 'write',
    site: 'main',
  },
  'cue.delete': {
    id: 'cue.delete',
    title: 'Delete cue',
    description: 'Permanently deletes a cue definition, including any trigger bindings pointing at it. Not reversible through undo. Returns the resulting snapshot patch.',
    risk: 'destructive',
    site: 'main',
  },
  'cue.list': {
    id: 'cue.list',
    title: 'List cues',
    description: 'Returns every cue definition. Read-only; use to resolve cue ids before calling other automation actions.',
    risk: 'read',
    site: 'main',
  },
  'macro.create': {
    id: 'macro.create',
    title: 'Create macro',
    description: 'Creates a new macro definition (an ordered sequence of steps the deterministic runtime can execute). Returns the snapshot patch with the new macro.',
    risk: 'write',
    site: 'main',
  },
  'macro.update': {
    id: 'macro.update',
    title: 'Update macro',
    description: 'Updates an existing macro’s steps or properties. The macro must exist; returns the snapshot patch with the update.',
    risk: 'write',
    site: 'main',
  },
  'macro.delete': {
    id: 'macro.delete',
    title: 'Delete macro',
    description: 'Permanently deletes a macro definition. Not reversible through undo. Returns the resulting snapshot patch.',
    risk: 'destructive',
    site: 'main',
  },
  'macro.setOrder': {
    id: 'macro.setOrder',
    title: 'Reorder macro',
    description: 'Moves a macro to a new position in the macro list. Returns the snapshot patch with the new order.',
    risk: 'write',
    site: 'main',
  },
  'macro.list': {
    id: 'macro.list',
    title: 'List macros',
    description: 'Returns every macro definition. Read-only; use to resolve macro ids before calling macro.run.',
    risk: 'read',
    site: 'main',
  },
  'triggerBinding.create': {
    id: 'triggerBinding.create',
    title: 'Create trigger binding',
    description: 'Creates a binding from an automation trigger event to a cue or macro. Returns the snapshot patch with the new binding.',
    risk: 'write',
    site: 'main',
  },
  'triggerBinding.delete': {
    id: 'triggerBinding.delete',
    title: 'Delete trigger binding',
    description: 'Permanently deletes a trigger binding. Not reversible through undo. Returns the resulting snapshot patch.',
    risk: 'destructive',
    site: 'main',
  },
  'triggerBinding.list': {
    id: 'triggerBinding.list',
    title: 'List trigger bindings',
    description: 'Returns every trigger binding. Read-only; use to inspect what fires in response to a given trigger event.',
    risk: 'read',
    site: 'main',
  },
  'schedule.save': {
    id: 'schedule.save',
    title: 'Save playback schedule',
    description: 'Creates or updates a playback schedule (identified by the schedule’s own id). Returns the snapshot patch with the saved schedule.',
    risk: 'write',
    site: 'main',
  },
  'schedule.delete': {
    id: 'schedule.delete',
    title: 'Delete playback schedule',
    description: 'Permanently deletes a playback schedule. Not reversible through undo. Returns the resulting snapshot patch.',
    risk: 'destructive',
    site: 'main',
  },
  'schedule.list': {
    id: 'schedule.list',
    title: 'List playback schedules',
    description: 'Returns every playback schedule. Read-only.',
    risk: 'read',
    site: 'main',
  },
  // --- Project (main) ---
  'project.getSnapshot': {
    id: 'project.getSnapshot',
    title: 'Get project snapshot',
    description: 'Returns the full current application snapshot (every playlist, item, slide, theme, overlay, stage, and automation definition). Read-only; expensive relative to the scoped list/get actions — prefer those when only one domain is needed.',
    risk: 'read',
    site: 'main',
  },
  'project.getOverview': {
    id: 'project.getOverview',
    title: 'Get project overview',
    description: 'Returns a lightweight summary of the project (counts and titles) without the full per-domain detail of project.getSnapshot. Read-only; use for orientation before drilling into a specific domain.',
    risk: 'read',
    site: 'main',
  },
  'project.search': {
    id: 'project.search',
    title: 'Search project',
    description: 'Searches across playlists, items, and slides by text query and returns matching refs. Read-only.',
    risk: 'read',
    site: 'main',
  },
  'project.exportBundle': {
    id: 'project.exportBundle',
    title: 'Export item bundle',
    description: 'Writes the given items (and their media) to a portable bundle file at the given filesystem path. Writes outside the project, so treat as a filesystem access. Returns the written file path and item count.',
    risk: 'filesystem',
    site: 'main',
  },
  'project.inspectBundle': {
    id: 'project.inspectBundle',
    title: 'Inspect import bundle',
    description: 'Reads a bundle file from the filesystem and reports its contents and any broken media references, without importing it. Call before project.importBundle to decide how to resolve conflicts. Returns the inspection report.',
    risk: 'filesystem',
    site: 'main',
  },
  'project.importBundle': {
    id: 'project.importBundle',
    title: 'Import bundle',
    description: 'Merges a previously inspected bundle’s items into the current project, applying the given decisions for any broken references. Not reversible through routine undo. Returns the resulting full snapshot.',
    risk: 'destructive',
    site: 'main',
  },
  'project.restoreBackup': {
    id: 'project.restoreBackup',
    title: 'Restore project backup',
    description: 'Restores the project database from a validated backup, replacing current project state. The pre-recovery database is retained as a timestamped sibling file, but this is not routine undo. Returns the restore result, including the retained pre-recovery database path.',
    risk: 'destructive',
    site: 'main',
  },
  // --- Output (main) ---
  'output.setEnabled': {
    id: 'output.setEnabled',
    title: 'Enable or disable output',
    description: 'Turns the named NDI output (audience or stage) on or off. This changes what is currently broadcast. Returns the resulting output state.',
    risk: 'broadcast',
    site: 'main',
  },
  'output.getState': {
    id: 'output.getState',
    title: 'Get output state',
    description: 'Returns whether each NDI output is currently enabled. Read-only.',
    risk: 'read',
    site: 'main',
  },
  'output.getConfigs': {
    id: 'output.getConfigs',
    title: 'Get output configs',
    description: 'Returns the configuration (resolution, frame rate, name, etc.) for every NDI output. Read-only.',
    risk: 'read',
    site: 'main',
  },
  'output.updateConfig': {
    id: 'output.updateConfig',
    title: 'Update output config',
    description: 'Changes the configuration of a named NDI output. Can change what viewers of that output see (e.g. resolution), so treat as changing what is live. Returns the updated config map.',
    risk: 'broadcast',
    site: 'main',
  },
  'output.getDiagnostics': {
    id: 'output.getDiagnostics',
    title: 'Get output diagnostics',
    description: 'Returns NDI sender diagnostics: active senders, frame telemetry, and availability drop counts per output. Read-only.',
    risk: 'read',
    site: 'main',
  },
  // --- System (main) ---
  'clipboard.read': {
    id: 'clipboard.read',
    title: 'Read clipboard',
    description: 'Returns the current system clipboard text contents. Read-only.',
    risk: 'read',
    site: 'main',
  },
  'clipboard.write': {
    id: 'clipboard.write',
    title: 'Write clipboard',
    description: 'Replaces the system clipboard text contents with the given string.',
    risk: 'write',
    site: 'main',
  },
  'logs.listSessions': {
    id: 'logs.listSessions',
    title: 'List log sessions',
    description: 'Returns a summary of every recorded log session (file path, start time, size). Read-only.',
    risk: 'read',
    site: 'main',
  },
  'logs.readSession': {
    id: 'logs.readSession',
    title: 'Read log session',
    description: 'Reads a page of log lines from a given session file, starting at the given offset. The file path must come from logs.listSessions. Returns the requested lines and whether more remain.',
    risk: 'read',
    site: 'main',
  },
  'logs.getCurrentPath': {
    id: 'logs.getCurrentPath',
    title: 'Get current log path',
    description: 'Returns the file path of the actively-written log session, or null if logging to a file is unavailable. Read-only.',
    risk: 'read',
    site: 'main',
  },
  'logs.getSystemMetrics': {
    id: 'logs.getSystemMetrics',
    title: 'Get system metrics',
    description: 'Returns a snapshot of current system resource usage (CPU, memory, and related process metrics). Read-only.',
    risk: 'read',
    site: 'main',
  },
  // --- Reserved for upcoming features (main) ---
  'document.extractText': {
    id: 'document.extractText',
    title: 'Extract document text',
    description: 'Extracts plain text from a document file (e.g. PDF or Word) on the user’s filesystem, outside the media library, for use as slide content. Returns the extracted text.',
    risk: 'filesystem',
    site: 'main',
  },
  // --- Canvas grouping/align, rich text, and slide rendering (renderer) ---
  'slide.render': {
    id: 'slide.render',
    title: 'Render slide',
    description: 'Renders a single slide to an image at the given size. The slide must exist; returns the rendered image. Read-only — does not change what is live.',
    risk: 'read',
    site: 'renderer',
  },
  'slide.renderContactSheet': {
    id: 'slide.renderContactSheet',
    title: 'Render slide contact sheet',
    description: 'Renders thumbnail images for every slide in an item as a single contact sheet. Read-only — does not change what is live.',
    risk: 'read',
    site: 'renderer',
  },
  'element.setRichText': {
    id: 'element.setRichText',
    title: 'Set element rich text',
    description: 'Replaces a text element’s rich-text content (formatted runs, not just plain text). The element must exist and be a text element; returns the snapshot patch with the update.',
    risk: 'write',
    site: 'renderer',
  },
  'element.group': {
    id: 'element.group',
    title: 'Group elements',
    description: 'Combines a set of elements on the same slide into a single group so they move and resize together. Every referenced element must exist on the same slide; returns the snapshot patch with the new group.',
    risk: 'write',
    site: 'renderer',
  },
  'element.ungroup': {
    id: 'element.ungroup',
    title: 'Ungroup elements',
    description: 'Dissolves an element group back into its independent members, preserving their current positions. The group must exist; returns the snapshot patch with the update.',
    risk: 'write',
    site: 'renderer',
  },
  'element.align': {
    id: 'element.align',
    title: 'Align elements',
    description: 'Aligns a set of elements on a shared edge or center (e.g. left, center, top). Every referenced element must exist on the same slide; returns the snapshot patch with their new positions.',
    risk: 'write',
    site: 'renderer',
  },
  'element.distribute': {
    id: 'element.distribute',
    title: 'Distribute elements',
    description: 'Spaces three or more elements evenly along an axis. Every referenced element must exist on the same slide; returns the snapshot patch with their new positions.',
    risk: 'write',
    site: 'renderer',
  },
  // --- Take/nav (renderer) ---
  'slide.take': {
    id: 'slide.take',
    title: 'Take slide',
    description: 'Puts the currently selected slide live on the armed output. This changes what the audience sees right now. Requires a current playlist entry and an armed output; returns nothing on success.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'slide.activate': {
    id: 'slide.activate',
    title: 'Activate slide',
    description: 'Selects a slide by index as current and, if an output is armed, immediately puts it live. Distinct from slide.select, which only changes editor selection without touching output. Requires slides to be loaded for the current item.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'slide.next': {
    id: 'slide.next',
    title: 'Go to next slide',
    description: 'Advances to the next slide. If an output is armed on the current selection this also takes it live; otherwise it only moves the editor’s current-slide pointer. No-op at the end of the slide list.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'slide.previous': {
    id: 'slide.previous',
    title: 'Go to previous slide',
    description: 'Moves to the previous slide. If an output is armed on the current selection this also takes it live; otherwise it only moves the editor’s current-slide pointer. No-op at the start of the slide list.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'slide.jumpTo': {
    id: 'slide.jumpTo',
    title: 'Jump to slide',
    description: 'Jumps directly to a specific slide by id or index within the current item, taking it live if an output is armed. Requires the slide to belong to the currently loaded item.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'slide.select': {
    id: 'slide.select',
    title: 'Select slide',
    description: 'Changes which single slide is selected in the editor, without affecting what is live on any output. Requires the slide to belong to the currently loaded item.',
    risk: 'write',
    site: 'renderer',
  },
  'slide.selectRange': {
    id: 'slide.selectRange',
    title: 'Select slide range',
    description: 'Selects a contiguous range of slides in the editor (e.g. shift-click), without affecting what is live on any output.',
    risk: 'write',
    site: 'renderer',
  },
  // --- Layers (renderer) ---
  'overlay.activate': {
    id: 'overlay.activate',
    title: 'Activate overlay',
    description: 'Shows an enabled overlay live on the armed output, running its enter animation. The overlay must be enabled (see overlay.setEnabled); this changes what the audience sees right now.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'overlay.clear': {
    id: 'overlay.clear',
    title: 'Clear overlay',
    description: 'Hides one currently active overlay from the live output, running its exit animation. This changes what the audience sees right now.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'overlay.clearAll': {
    id: 'overlay.clearAll',
    title: 'Clear all overlays',
    description: 'Hides every currently active overlay from the live output. This changes what the audience sees right now.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'overlay.setMode': {
    id: 'overlay.setMode',
    title: 'Set overlay mode',
    description: 'Changes the overlay editor’s local editing mode (e.g. selection vs. draw). Editor-only state; does not affect what is live.',
    risk: 'write',
    site: 'renderer',
  },
  'mediaLayer.set': {
    id: 'mediaLayer.set',
    title: 'Set media layer',
    description: 'Puts a media asset live on the background media layer of the armed output. This changes what the audience sees right now.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'mediaLayer.clear': {
    id: 'mediaLayer.clear',
    title: 'Clear media layer',
    description: 'Removes whatever is currently showing on the background media layer of the armed output. This changes what the audience sees right now.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'layer.clearContent': {
    id: 'layer.clearContent',
    title: 'Clear layer content',
    description: 'Clears the content of one specific live-show layer (e.g. slide, or media) without affecting the others. This changes what the audience sees right now.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'layer.clearAll': {
    id: 'layer.clearAll',
    title: 'Clear all layers',
    description: 'Clears every live-show layer (slide, overlays, and media) on the armed output at once, taking the output to black. This changes what the audience sees right now.',
    risk: 'broadcast',
    site: 'renderer',
  },
  // --- Video transport (renderer) ---
  'video.arm': {
    id: 'video.arm',
    title: 'Arm video',
    description: 'Loads a video asset onto the armed output’s video layer, ready to play, without starting playback. This changes what the audience sees right now (the first frame appears).',
    risk: 'broadcast',
    site: 'renderer',
  },
  'video.clear': {
    id: 'video.clear',
    title: 'Clear video',
    description: 'Removes the currently armed or playing video from the live output. This changes what the audience sees right now.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'video.play': {
    id: 'video.play',
    title: 'Play video',
    description: 'Starts or resumes playback of the currently armed video on the live output. Requires a video already armed via video.arm.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'video.pause': {
    id: 'video.pause',
    title: 'Pause video',
    description: 'Pauses playback of the currently playing video on the live output, holding on the current frame.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'video.seek': {
    id: 'video.seek',
    title: 'Seek video',
    description: 'Moves the playhead of the currently armed video to a given timestamp on the live output.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'video.setVolume': {
    id: 'video.setVolume',
    title: 'Set video volume',
    description: 'Sets the playback volume of the currently armed video on the live output.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'video.toggleMute': {
    id: 'video.toggleMute',
    title: 'Toggle video mute',
    description: 'Toggles whether the currently armed video’s audio is muted on the live output.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'video.toggleLoop': {
    id: 'video.toggleLoop',
    title: 'Toggle video loop',
    description: 'Toggles whether the currently armed video restarts automatically on the live output when it reaches the end.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'video.next': {
    id: 'video.next',
    title: 'Play next video',
    description: 'Advances to and arms the next video in the current playback queue on the live output.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'video.previous': {
    id: 'video.previous',
    title: 'Play previous video',
    description: 'Moves to and arms the previous video in the current playback queue on the live output.',
    risk: 'broadcast',
    site: 'renderer',
  },
  // --- Audio transport (renderer) ---
  'audio.arm': {
    id: 'audio.arm',
    title: 'Arm audio',
    description: 'Loads an audio asset onto the armed output’s audio layer, ready to play, without starting playback. This changes what the audience hears once played.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'audio.clear': {
    id: 'audio.clear',
    title: 'Clear audio',
    description: 'Removes the currently armed or playing audio track from the live output. This changes what the audience hears right now.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'audio.play': {
    id: 'audio.play',
    title: 'Play audio',
    description: 'Starts or resumes playback of the currently armed audio track on the live output. Requires an audio track already armed via audio.arm.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'audio.pause': {
    id: 'audio.pause',
    title: 'Pause audio',
    description: 'Pauses playback of the currently playing audio track on the live output.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'audio.seek': {
    id: 'audio.seek',
    title: 'Seek audio',
    description: 'Moves the playhead of the currently armed audio track to a given timestamp on the live output.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'audio.setVolume': {
    id: 'audio.setVolume',
    title: 'Set audio volume',
    description: 'Sets the playback volume of the currently armed audio track on the live output.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'audio.toggleMute': {
    id: 'audio.toggleMute',
    title: 'Toggle audio mute',
    description: 'Toggles whether the currently armed audio track is muted on the live output.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'audio.toggleLoop': {
    id: 'audio.toggleLoop',
    title: 'Toggle audio loop',
    description: 'Toggles whether the currently armed audio track restarts automatically on the live output when it reaches the end.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'audio.next': {
    id: 'audio.next',
    title: 'Play next audio',
    description: 'Advances to and arms the next track in the current audio playback queue on the live output.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'audio.previous': {
    id: 'audio.previous',
    title: 'Play previous audio',
    description: 'Moves to and arms the previous track in the current audio playback queue on the live output.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'audioSync.resume': {
    id: 'audioSync.resume',
    title: 'Resume audio sync',
    description: 'Resumes an audio track’s playback position after it drifted out of sync with its driving slide/video on the live output.',
    risk: 'broadcast',
    site: 'renderer',
  },
  // --- Stage (renderer) ---
  'stage.arm': {
    id: 'stage.arm',
    title: 'Arm stage',
    description: 'Puts a stage-display layout live on the stage output. This changes what stage monitors show right now.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'stage.clear': {
    id: 'stage.clear',
    title: 'Clear stage',
    description: 'Removes the currently armed stage-display layout from the stage output. This changes what stage monitors show right now.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'timer.start': {
    id: 'timer.start',
    title: 'Start timer',
    description: 'Starts or resumes a timer. Text elements linked to it update live wherever they are shown, including on air.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'timer.stop': {
    id: 'timer.stop',
    title: 'Stop timer',
    description: 'Pauses a running timer. Text elements linked to it stop updating wherever they are shown, including on air.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'timer.reset': {
    id: 'timer.reset',
    title: 'Reset timer',
    description: 'Resets a timer to its idle starting value. Text elements linked to it update live wherever they are shown, including on air.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'timer.resetAll': {
    id: 'timer.resetAll',
    title: 'Reset all timers',
    description: 'Resets every timer to its idle starting value. Text elements linked to any of them update live wherever they are shown, including on air.',
    risk: 'broadcast',
    site: 'renderer',
  },
  // --- Automation exec (renderer) ---
  'macro.run': {
    id: 'macro.run',
    title: 'Run macro',
    description: 'Executes a macro’s steps through the deterministic runtime immediately. Steps can include live-show actions, so this can change what is live. The macro must exist; returns nothing on success.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'macro.cancelAll': {
    id: 'macro.cancelAll',
    title: 'Cancel all macros',
    description: 'Cancels every macro currently running or scheduled, stopping any further steps from executing. Use to stop an in-flight macro before it reaches a live-show step.',
    risk: 'broadcast',
    site: 'renderer',
  },
  'cue.run': {
    id: 'cue.run',
    title: 'Run cue',
    description: 'Fires a cue immediately, running whatever it is configured to trigger. Can change what is live depending on the cue’s configuration. The cue must exist; returns nothing on success.',
    risk: 'broadcast',
    site: 'renderer',
  },
  // --- Workbench (renderer) ---
  'workbench.setMode': {
    id: 'workbench.setMode',
    title: 'Set workbench mode',
    description: 'Switches the main workbench view (show, item editor, overlay editor, theme editor, stage editor, macro editor, or settings). Editor-only state; does not affect what is live.',
    risk: 'write',
    site: 'renderer',
  },
  'workbench.openSettings': {
    id: 'workbench.openSettings',
    title: 'Open settings',
    description: 'Switches the workbench to the settings view. Editor-only state; does not affect what is live.',
    risk: 'write',
    site: 'renderer',
  },
  'workbench.togglePanel': {
    id: 'workbench.togglePanel',
    title: 'Toggle panel',
    description: 'Shows or hides a named workbench side panel. Editor-only state; does not affect what is live.',
    risk: 'write',
    site: 'renderer',
  },
  'workbench.setSlideBrowserMode': {
    id: 'workbench.setSlideBrowserMode',
    title: 'Set slide browser mode',
    description: 'Switches the slide browser between grid and list view. Editor-only state; does not affect what is live.',
    risk: 'write',
    site: 'renderer',
  },
  'workbench.setProgramMode': {
    id: 'workbench.setProgramMode',
    title: 'Set program mode',
    description: 'Switches how the program/preview area is laid out in the workbench. Editor-only state; does not affect what is live.',
    risk: 'write',
    site: 'renderer',
  },
  'commandPalette.open': {
    id: 'commandPalette.open',
    title: 'Open command palette',
    description: 'Opens the in-app command palette. Editor-only state; does not affect what is live.',
    risk: 'write',
    site: 'renderer',
  },
  'lyricEditor.open': {
    id: 'lyricEditor.open',
    title: 'Open lyric editor',
    description: 'Opens the lyric text editor for a lyric item. Editor-only state; does not affect what is live.',
    risk: 'write',
    site: 'renderer',
  },
  'editor.saveChanges': {
    id: 'editor.saveChanges',
    title: 'Save editor changes',
    description: 'Commits pending in-editor text changes (e.g. an open lyric or rich-text edit) to project state. Reversible through undo.',
    risk: 'write',
    site: 'renderer',
  },
  // --- Navigation/selection (renderer) ---
  'navigation.selectPlaylist': {
    id: 'navigation.selectPlaylist',
    title: 'Select playlist',
    description: 'Changes which playlist is current in the navigation UI. Editor-only state; does not affect what is live.',
    risk: 'write',
    site: 'renderer',
  },
  'navigation.selectPlaylistEntry': {
    id: 'navigation.selectPlaylistEntry',
    title: 'Select playlist entry',
    description: 'Changes which row within the current playlist is selected in the navigation UI, loading its item. Editor-only state; does not affect what is live.',
    risk: 'write',
    site: 'renderer',
  },
  'navigation.browseItem': {
    id: 'navigation.browseItem',
    title: 'Browse item',
    description: 'Opens a presentation or lyric in the editor outside of any playlist context (e.g. from a search result). Editor-only state; does not affect what is live.',
    risk: 'write',
    site: 'renderer',
  },
  // --- Element editing (renderer) ---
  'element.select': {
    id: 'element.select',
    title: 'Select element',
    description: 'Changes which single element on the current slide is selected in the editor. Editor-only state; does not affect what is live.',
    risk: 'write',
    site: 'renderer',
  },
  'element.selectMany': {
    id: 'element.selectMany',
    title: 'Select elements',
    description: 'Selects multiple elements on the current slide at once (e.g. a marquee or shift-click selection). Editor-only state; does not affect what is live.',
    risk: 'write',
    site: 'renderer',
  },
  'element.clearSelection': {
    id: 'element.clearSelection',
    title: 'Clear element selection',
    description: 'Deselects every currently selected element on the canvas. Editor-only state; does not affect what is live.',
    risk: 'write',
    site: 'renderer',
  },
  'element.copy': {
    id: 'element.copy',
    title: 'Copy selection',
    description: 'Copies the currently selected element(s) to the in-app clipboard for pasting elsewhere. Requires a non-empty selection.',
    risk: 'write',
    site: 'renderer',
  },
  'element.cut': {
    id: 'element.cut',
    title: 'Cut selection',
    description: 'Copies the currently selected element(s) to the in-app clipboard and deletes them from the slide. Requires a non-empty selection; returns the snapshot patch with the deletion.',
    risk: 'write',
    site: 'renderer',
  },
  'element.paste': {
    id: 'element.paste',
    title: 'Paste selection',
    description: 'Pastes previously copied or cut element(s) onto the current slide. Requires the in-app clipboard to hold elements; returns the snapshot patch with the new elements.',
    risk: 'write',
    site: 'renderer',
  },
  'element.duplicateSelection': {
    id: 'element.duplicateSelection',
    title: 'Duplicate selection',
    description: 'Creates a copy of the currently selected element(s) on the same slide, offset from the originals. Requires a non-empty selection; returns the snapshot patch with the new elements.',
    risk: 'write',
    site: 'renderer',
  },
  'element.nudge': {
    id: 'element.nudge',
    title: 'Nudge selection',
    description: 'Moves the currently selected element(s) by a small fixed offset in one direction. Requires a non-empty selection; returns the snapshot patch with the new positions.',
    risk: 'write',
    site: 'renderer',
  },
  'element.bringToFront': {
    id: 'element.bringToFront',
    title: 'Bring element to front',
    description: 'Moves the selected element to the top of its slide’s stacking order. Requires a single selected element; returns the snapshot patch with the new order.',
    risk: 'write',
    site: 'renderer',
  },
  'element.sendToBack': {
    id: 'element.sendToBack',
    title: 'Send element to back',
    description: 'Moves the selected element to the bottom of its slide’s stacking order. Requires a single selected element; returns the snapshot patch with the new order.',
    risk: 'write',
    site: 'renderer',
  },
  'element.bringForward': {
    id: 'element.bringForward',
    title: 'Bring element forward',
    description: 'Moves the selected element one step up in its slide’s stacking order. Requires a single selected element; returns the snapshot patch with the new order.',
    risk: 'write',
    site: 'renderer',
  },
  'element.sendBackward': {
    id: 'element.sendBackward',
    title: 'Send element backward',
    description: 'Moves the selected element one step down in its slide’s stacking order. Requires a single selected element; returns the snapshot patch with the new order.',
    risk: 'write',
    site: 'renderer',
  },
  'element.toggleVisibility': {
    id: 'element.toggleVisibility',
    title: 'Toggle element visibility',
    description: 'Shows or hides a single element on its slide. A hidden element is not rendered on output either, so this can change what is on the live slide the next time it is shown. Returns the snapshot patch with the flag.',
    risk: 'write',
    site: 'renderer',
  },
  'element.toggleLock': {
    id: 'element.toggleLock',
    title: 'Toggle element lock',
    description: 'Locks or unlocks a single element against further editing on the canvas (selection and drag are blocked while locked). Editor-only state; does not affect what is live.',
    risk: 'write',
    site: 'renderer',
  },
  'element.rename': {
    id: 'element.rename',
    title: 'Rename element',
    description: 'Sets a single element’s display name shown in the layers panel. Purely cosmetic; does not affect what is live.',
    risk: 'write',
    site: 'renderer',
  },
  // --- History (renderer) ---
  'edit.undo': {
    id: 'edit.undo',
    title: 'Undo',
    description: 'Reverts the most recent undoable change. No-op if there is nothing to undo.',
    risk: 'write',
    site: 'renderer',
  },
  'edit.redo': {
    id: 'edit.redo',
    title: 'Redo',
    description: 'Re-applies the most recently undone change. No-op if there is nothing to redo.',
    risk: 'write',
    site: 'renderer',
  },
};

export const ACTION_IDS: readonly ActionId[] = Object.keys(ACTION_METADATA) as ActionId[];

// `ShortcutActionId` predates this registry (see the package-level TODO this
// file resolves) and every one of its 20 members already has an
// agent-meaningful canonical action, so none map to null. Two pairs of
// dual-purpose shortcuts collapse to the branch judged canonical:
//   - `nudgeOrGoNext`/`nudgeOrGoPrev` -> `slide.next`/`slide.previous`: both
//     only nudge an element when editing WITH a selection; their `always`
//     context and primary behavior is slide navigation.
//   - `deleteSelected` -> `slide.delete`: by the same reasoning as above (see
//     `use-keyboard-shortcuts.ts`'s `deleteSelected` handler), element
//     deletion only fires with a specific element selected while editing;
//     the broader, always-available behavior is deleting the current slide.
export const SHORTCUT_ACTION_TO_ACTION_ID: Readonly<Record<ShortcutActionId, ActionId | null>> = {
  copySelection: 'element.copy',
  cutSelection: 'element.cut',
  pasteSelection: 'element.paste',
  duplicateSelection: 'element.duplicateSelection',
  undo: 'edit.undo',
  redo: 'edit.redo',
  globalUndo: 'edit.undo',
  globalRedo: 'edit.redo',
  openCommandPalette: 'commandPalette.open',
  setSlideBrowserMode: 'workbench.setSlideBrowserMode',
  takeSlide: 'slide.take',
  deleteSelected: 'slide.delete',
  clearSelection: 'element.clearSelection',
  nudgeOrGoNext: 'slide.next',
  nudgeOrGoPrev: 'slide.previous',
  nudgeUp: 'element.nudge',
  nudgeDown: 'element.nudge',
  activateSlide: 'slide.activate',
  groupSelection: 'element.group',
  ungroupSelection: 'element.ungroup',
};

// `AppMenuCommandId` predates this registry too (same TODO). `edit.delete`
// mirrors the `deleteSelected` shortcut judgment call above (they are
// literally the same dispatch, see `use-app-menu.ts`'s `edit.delete` case).
// The only genuinely agent-meaningless legacy id is `app.checkForUpdates`
// (an app self-update check, excluded from the RPC coverage above too).
export const APP_MENU_COMMAND_TO_ACTION_ID: Readonly<Record<AppMenuCommandId, ActionId | null>> = {
  'file.newPresentation': 'item.create',
  'file.newLyric': 'item.create',
  'file.newPlaylist': 'playlist.create',
  'file.newSeparator': 'separator.create',
  'file.newSlide': 'slide.create',
  'file.exportCurrentItem': 'project.exportBundle',
  'file.exportWorkspace': 'project.exportBundle',
  'app.openSettings': 'workbench.openSettings',
  'app.checkForUpdates': null,
  'edit.undo': 'edit.undo',
  'edit.redo': 'edit.redo',
  'edit.cut': 'element.cut',
  'edit.copy': 'element.copy',
  'edit.paste': 'element.paste',
  'edit.duplicate': 'element.duplicateSelection',
  'edit.delete': 'slide.delete',
  'edit.clearSelection': 'element.clearSelection',
  'view.openCommandPalette': 'commandPalette.open',
  'view.mode.show': 'workbench.setMode',
  'view.mode.deckEditor': 'workbench.setMode',
  'view.mode.overlayEditor': 'workbench.setMode',
  'view.mode.themeEditor': 'workbench.setMode',
  'view.mode.stageEditor': 'workbench.setMode',
  'view.mode.macroEditor': 'workbench.setMode',
  'view.mode.settings': 'workbench.openSettings',
  'view.slideBrowser.grid': 'workbench.setSlideBrowserMode',
  'view.slideBrowser.list': 'workbench.setSlideBrowserMode',
  'playback.takeSlide': 'slide.take',
  'playback.previousSlide': 'slide.previous',
  'playback.nextSlide': 'slide.next',
  'playback.toggleAudienceOutput': 'output.setEnabled',
  'playback.toggleStageOutput': 'output.setEnabled',
};
