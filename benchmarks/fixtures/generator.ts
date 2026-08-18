import { createTestRepository, withDeterministicRuntime, LATEST_SCHEMA_VERSION } from '@lumacast/persistence-sqlite';
import type { CastRepository } from '@lumacast/persistence-sqlite';
import type { Id } from '@lumacast/kernel';
import type { ItemType, MediaAssetType } from '@lumacast/composition';
import type { CueKind, CuePayload } from '@lumacast/automation';
import type { AppSnapshot } from '@lumacast/protocol';
import { imageElementInput, shapeElementInput, textElementInput, videoElementInput } from './element-factories';
import { buildManifest, type FixtureClass, type FixtureManifest, isFixtureClass } from './manifest';

/** Default, fixed seed for a fixture class — "generate from a fixed seed" (#200). */
export function defaultSeedFor(fixtureClass: FixtureClass): string {
  return `lumacast-fixture:${fixtureClass}`;
}

export interface GenerateFixtureOptions {
  /** Overrides the class's default fixed seed. Same seed -> byte-identical output. */
  seed?: string;
}

export interface GeneratedFixture {
  manifest: FixtureManifest;
  snapshot: AppSnapshot;
}

/**
 * Generates one of the five fixture classes named by #139 into a throwaway
 * on-disk SQLite database (via `createTestRepository`), reads back the full
 * snapshot, and tears the database down again before returning — the
 * fixture "artifact" callers keep is the small, deterministic manifest (and,
 * in-memory, the snapshot), never a committed binary.
 *
 * Every id and timestamp involved is produced under
 * `withDeterministicRuntime`, so two calls with the same `fixtureClass` and
 * `seed` always produce byte-identical manifests (see `fixtures.test.ts`).
 *
 * Throws synchronously and non-zero (via the process exit code when driven
 * through `vitest run`) for an unknown fixture class or a blank seed, with
 * an actionable message — the failure mode #200's acceptance criteria call
 * "invalid generation fails non-zero with actionable output".
 */
export function generateFixture(fixtureClass: string, options: GenerateFixtureOptions = {}): GeneratedFixture {
  if (!isFixtureClass(fixtureClass)) {
    throw new Error(
      `Unknown fixture class '${fixtureClass}'. Expected one of: small, large, media-heavy, theme-heavy, talk-automation-heavy.`
    );
  }
  const seed = options.seed ?? defaultSeedFor(fixtureClass);
  if (seed.trim().length === 0) {
    throw new Error('Fixture seed must be a non-empty string.');
  }

  // `createTestRepository` itself (migrations plus the repository's own
  // eager seeding) must run *inside* the deterministic patch, not just the
  // population step below it: a brand-new database runs every migration up
  // to `LATEST_SCHEMA_VERSION` on construction, and one of those migrations
  // (and the repository's own first-write path) mints ids/timestamps of its
  // own. Construct the repository outside this function's control but under
  // the same patch so *nothing* the fixture touches — schema setup included
  // — can fall back to real time/randomness.
  return withDeterministicRuntime({ seed }, () => {
    const handle = createTestRepository({ seed: false });
    try {
      populateFixture(handle.repository, fixtureClass, seed);
      const snapshot = handle.repository.getSnapshot();

      const manifest = buildManifest({
        seed,
        fixtureClass,
        schemaVersion: LATEST_SCHEMA_VERSION,
        snapshot,
      });

      return { manifest, snapshot };
    } finally {
      handle.close();
      handle.cleanup();
    }
  });
}

function populateFixture(repo: CastRepository, fixtureClass: FixtureClass, seed: string): void {
  switch (fixtureClass) {
    case 'small':
      return populateSmall(repo);
    case 'large':
      return populateLarge(repo);
    case 'media-heavy':
      return populateMediaHeavy(repo, seed);
    case 'theme-heavy':
      return populateThemeHeavy(repo);
    case 'talk-automation-heavy':
      return populateTalkAutomationHeavy(repo);
  }
}

// ─── small: a single ordinary project ──────────────────────────────────

function populateSmall(repo: CastRepository): void {
  const playlistId = requireId(repo.createPlaylist('Order of Service').upserts.playlists);
  repo.createSeparator(playlistId, 'Welcome');

  const themeId = requireId(repo.createTheme({ name: 'House Theme', themeType: 'presentation' }).upserts.presentationThemes);

  const { itemId: presentationId } = repo.createItem({ type: 'presentation', title: 'Welcome Slides', themeId, playlistId });
  const { itemId: lyricId } = repo.createItem({ type: 'lyric', title: 'Opening Song', playlistId });
  const { itemId: talkId, patch: talkPatch } = repo.createItem({ type: 'talk', title: 'Message', playlistId });

  repo.createTalkScriptBlock({ slideId: requireId(talkPatch.upserts.slides), text: 'Welcome everyone.' });

  void presentationId;
  void lyricId;
  void talkId;
}

// ─── large: many items, slides, elements, playlists and separators ─────

const LARGE_PLAYLIST_COUNT = 4;
const LARGE_SEPARATORS_PER_PLAYLIST = 2;
const LARGE_ITEM_COUNT = 24;
const LARGE_EXTRA_SLIDES_PER_ITEM = 2;
const LARGE_ELEMENTS_PER_EXTRA_SLIDE = 2;
const ITEM_TYPES: readonly ItemType[] = ['presentation', 'lyric', 'talk'];

function populateLarge(repo: CastRepository): void {
  const themeIds = [
    requireId(repo.createTheme({ name: 'Theme Alpha', themeType: 'presentation' }).upserts.presentationThemes),
    requireId(repo.createTheme({ name: 'Theme Beta', themeType: 'lyric' }).upserts.lyricThemes),
  ];

  const playlistIds: Id[] = [];
  for (let playlistIndex = 0; playlistIndex < LARGE_PLAYLIST_COUNT; playlistIndex += 1) {
    const playlistId = requireId(repo.createPlaylist(`Playlist ${playlistIndex}`).upserts.playlists);
    playlistIds.push(playlistId);
    for (let separatorIndex = 0; separatorIndex < LARGE_SEPARATORS_PER_PLAYLIST; separatorIndex += 1) {
      repo.createSeparator(playlistId, `Section ${playlistIndex}-${separatorIndex}`);
    }
  }

  for (let itemIndex = 0; itemIndex < LARGE_ITEM_COUNT; itemIndex += 1) {
    const type = ITEM_TYPES[itemIndex % ITEM_TYPES.length]!;
    const playlistId = playlistIds[itemIndex % playlistIds.length]!;
    const themeId = type === 'lyric' ? themeIds[1] : itemIndex % 3 === 0 ? themeIds[0] : undefined;
    const { itemId } = repo.createItem({ type, title: `Item ${itemIndex} (${type})`, themeId, playlistId });

    for (let slideIndex = 0; slideIndex < LARGE_EXTRA_SLIDES_PER_ITEM; slideIndex += 1) {
      const slideId = requireId(
        repo.createSlide(ownerInputFor(type, itemId)).upserts.slides,
      );
      const elements = [];
      for (let elementIndex = 0; elementIndex < LARGE_ELEMENTS_PER_EXTRA_SLIDE; elementIndex += 1) {
        elements.push(
          elementIndex % 2 === 0
            ? textElementInput(slideId, elementIndex, `Item ${itemIndex} / Slide ${slideIndex} / ${elementIndex}`)
            : shapeElementInput(slideId, elementIndex),
        );
      }
      repo.createElementsBatch(elements);
    }
  }
}

// ─── media-heavy: many media assets referenced by many elements ────────

const MEDIA_HEAVY_ITEM_COUNT = 6;
const MEDIA_HEAVY_SLIDES_PER_ITEM = 2;
const MEDIA_HEAVY_IMAGE_ASSET_COUNT = 25;
const MEDIA_HEAVY_VIDEO_ASSET_COUNT = 20;
const MEDIA_HEAVY_AUDIO_ASSET_COUNT = 15;

function populateMediaHeavy(repo: CastRepository, seed: string): void {
  const imageAssetIds = createMediaAssets(repo, 'image', MEDIA_HEAVY_IMAGE_ASSET_COUNT, seed);
  const videoAssetIds = createMediaAssets(repo, 'video', MEDIA_HEAVY_VIDEO_ASSET_COUNT, seed);
  createMediaAssets(repo, 'audio', MEDIA_HEAVY_AUDIO_ASSET_COUNT, seed);

  const playlistId = requireId(repo.createPlaylist('Media Playlist').upserts.playlists);
  repo.createSeparator(playlistId, 'Media');

  for (let itemIndex = 0; itemIndex < MEDIA_HEAVY_ITEM_COUNT; itemIndex += 1) {
    const { itemId } = repo.createItem({ type: 'presentation', title: `Media Item ${itemIndex}`, playlistId });
    for (let slideIndex = 0; slideIndex < MEDIA_HEAVY_SLIDES_PER_ITEM; slideIndex += 1) {
      const slideId = requireId(repo.createSlide({ presentationId: itemId }).upserts.slides);
      const imageAsset = imageAssetIds[(itemIndex * MEDIA_HEAVY_SLIDES_PER_ITEM + slideIndex) % imageAssetIds.length]!;
      const videoAsset = videoAssetIds[(itemIndex * MEDIA_HEAVY_SLIDES_PER_ITEM + slideIndex) % videoAssetIds.length]!;
      repo.createElementsBatch([
        imageElementInput(slideId, 0, imageAsset.src),
        videoElementInput(slideId, 1, videoAsset.src),
      ]);
    }
  }
}

function createMediaAssets(
  repo: CastRepository,
  type: MediaAssetType,
  count: number,
  seed: string,
): Array<{ id: Id; src: string }> {
  const created: Array<{ id: Id; src: string }> = [];
  for (let index = 0; index < count; index += 1) {
    const extension = type === 'image' ? 'png' : type === 'video' ? 'mp4' : 'wav';
    const src = `fixture-media://${seed}/${type}/${String(index).padStart(4, '0')}.${extension}`;
    const patch = repo.createMediaAsset({ name: `${type} ${index}`, type, src });
    created.push({ id: requireId(patch.upserts.mediaAssets), src });
  }
  return created;
}

// ─── theme-heavy: many items sharing themes, edited and re-synced ──────

const THEME_HEAVY_ITEMS_PER_THEME = 6;

function populateThemeHeavy(repo: CastRepository): void {
  const presentationThemeId = requireId(
    repo.createTheme({ name: 'Presentation Theme', themeType: 'presentation' }).upserts.presentationThemes,
  );
  const lyricThemeId = requireId(repo.createTheme({ name: 'Lyric Theme', themeType: 'lyric' }).upserts.lyricThemes);
  const talkThemeId = requireId(repo.createTheme({ name: 'Talk Theme', themeType: 'talk' }).upserts.talkThemes);
  const overlayThemeId = requireId(repo.createTheme({ name: 'Overlay Theme', themeType: 'overlay' }).upserts.overlayThemes);

  const presentationIds: Id[] = [];
  const talkIds: Id[] = [];
  for (let index = 0; index < THEME_HEAVY_ITEMS_PER_THEME; index += 1) {
    presentationIds.push(
      repo.createItem({ type: 'presentation', title: `Themed Presentation ${index}`, themeId: presentationThemeId }).itemId,
    );
    talkIds.push(
      repo.createItem({ type: 'talk', title: `Themed Talk ${index}`, themeId: talkThemeId }).itemId,
    );
    repo.createItem({ type: 'lyric', title: `Themed Lyric ${index}`, themeId: lyricThemeId });
  }

  for (let index = 0; index < 3; index += 1) {
    const overlayId = requireId(repo.createOverlay({ name: `Themed Overlay ${index}` }).upserts.overlays);
    repo.applyThemeToOverlay(overlayThemeId, overlayId);
  }

  // Nested provenance: duplicating a themed presentation carries its
  // elements' sourceThemeElementId forward onto a second generation of
  // items. Talks are not duplicable (decision D1), so only presentations
  // exercise this path.
  for (const presentationId of presentationIds.slice(0, 3)) {
    repo.duplicateItem({ type: 'presentation', id: presentationId });
  }

  // Editing the theme and re-syncing fans the change out across every item
  // still linked to it — the provenance path #104/#113 made non-destructive.
  // Sync is strictly per-family: a presentation theme never fans out to talks.
  repo.updateTheme({ id: presentationThemeId, themeType: 'presentation', name: 'Presentation Theme (revised)' });
  repo.syncThemeToLinkedItems(presentationThemeId, 'presentation');

  for (const talkId of talkIds.slice(0, 2)) {
    repo.applyThemeToItem(talkThemeId, { type: 'talk', id: talkId });
  }
}

// ─── talk-automation-heavy: talks, cues, macros, trigger bindings ──────

const TALK_COUNT = 12;
const SCRIPT_BLOCKS_PER_TALK = 6;
const CUE_KINDS: readonly CueKind[] = [
  'overlay.activate',
  'overlay.clear',
  'overlay.clearAll',
  'video.arm',
  'video.clear',
  'audio.arm',
  'audio.clear',
  'stage.set',
  'stage.clear',
  'layer.clear',
];
const CUE_COUNT = 30;
const MACRO_COUNT = 15;
const TRIGGER_BINDING_COUNT = 25;

function populateTalkAutomationHeavy(repo: CastRepository): void {
  const overlayId = requireId(repo.createOverlay({ name: 'Automation Overlay' }).upserts.overlays);
  const stageId = requireId(repo.createStage({ name: 'Automation Stage' }).upserts.stages);
  const audioAssetId = requireId(
    repo.createMediaAsset({ name: 'Automation Bed', type: 'audio', src: 'fixture-media://talk-automation-heavy/audio/0000.wav' })
      .upserts.mediaAssets,
  );

  const talkIds: Id[] = [];
  const talkSlideIds: Id[] = [];
  for (let talkIndex = 0; talkIndex < TALK_COUNT; talkIndex += 1) {
    const { itemId, patch } = repo.createItem({ type: 'talk', title: `Talk ${talkIndex}` });
    talkIds.push(itemId);
    talkSlideIds.push(requireId(patch.upserts.slides));
    for (let blockIndex = 0; blockIndex < SCRIPT_BLOCKS_PER_TALK; blockIndex += 1) {
      repo.createTalkScriptBlock({ slideId: talkSlideIds[talkIndex]!, text: `Point ${blockIndex} for talk ${talkIndex}.` });
    }
  }

  const cueIds: Id[] = [];
  for (let cueIndex = 0; cueIndex < CUE_COUNT; cueIndex += 1) {
    const kind = CUE_KINDS[cueIndex % CUE_KINDS.length]!;
    const payload = cuePayloadFor(kind, { overlayId, stageId, assetId: audioAssetId });
    cueIds.push(requireId(repo.createCue({ kind, payload }).upserts.cues));
  }

  const macroIds: Id[] = [];
  for (let macroIndex = 0; macroIndex < MACRO_COUNT; macroIndex += 1) {
    const cueA = cueIds[macroIndex % cueIds.length]!;
    const cueB = cueIds[(macroIndex + 1) % cueIds.length]!;
    const patch = repo.createMacro({
      name: `Macro ${macroIndex}`,
      description: `Automation macro ${macroIndex}`,
      loopEnabled: macroIndex % 5 === 0,
      loopCount: macroIndex % 5 === 0 ? 3 : null,
      cues: [
        { cueId: cueA, orderIndex: 0, delayBeforeMs: 0, delayAfterMs: 250 },
        { cueId: cueB, orderIndex: 1, delayBeforeMs: 100, delayAfterMs: 0 },
      ],
    });
    macroIds.push(requireId(patch.upserts.macros));
  }

  for (let bindingIndex = 0; bindingIndex < TRIGGER_BINDING_COUNT; bindingIndex += 1) {
    const useMacro = bindingIndex % 2 === 0;
    const targetId = useMacro ? macroIds[bindingIndex % macroIds.length]! : cueIds[bindingIndex % cueIds.length]!;
    const triggerType = bindingIndex % 3 === 0 ? 'app.startup' : bindingIndex % 3 === 1 ? 'slide.take' : 'slide.activate';
    repo.createTriggerBinding({
      triggerType,
      sourceId: triggerType === 'app.startup' ? null : talkSlideIds[bindingIndex % talkSlideIds.length]!,
      targetType: useMacro ? 'macro' : 'cue',
      targetId,
      enabled: bindingIndex % 7 !== 0,
    });
  }
}

function cuePayloadFor(kind: CueKind, refs: { overlayId: Id; stageId: Id; assetId: Id }): CuePayload {
  switch (kind) {
    case 'overlay.activate':
    case 'overlay.clear':
      return { overlayId: refs.overlayId };
    case 'video.arm':
    case 'video.clear':
    case 'audio.arm':
    case 'audio.clear':
      return { assetId: refs.assetId };
    case 'stage.set':
    case 'stage.clear':
      return { stageId: refs.stageId };
    case 'layer.clear':
      return { layer: 'content' };
    case 'layer.clearAll':
    case 'overlay.clearAll':
    case 'mediaLayer.set':
      return {};
    case 'flow.lifecycle':
      return { action: 'cancel', target: '*' };
  }
}

// ─── shared helpers ─────────────────────────────────────────────────────

function requireId(records: Array<{ id: Id }> | undefined): Id {
  const id = records?.[0]?.id;
  if (!id) throw new Error('Expected repository call to upsert exactly one record with an id.');
  return id;
}

function ownerInputFor(type: ItemType, itemId: Id): { presentationId?: Id; lyricId?: Id; talkId?: Id } {
  if (type === 'presentation') return { presentationId: itemId };
  if (type === 'lyric') return { lyricId: itemId };
  return { talkId: itemId };
}
