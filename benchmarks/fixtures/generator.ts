import type { CastRepository } from '@database/store';
import { createTestRepository, withDeterministicRuntime } from '@database/test-support';
import { LATEST_SCHEMA_VERSION } from '@database/migrations';
import type { Id } from '@lumacast/kernel';
import type { MediaAssetType } from '@lumacast/composition';
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
  // eager default-collection seeding) must run *inside* the deterministic
  // patch, not just the population step below it: a brand-new database runs
  // every migration up to `LATEST_SCHEMA_VERSION` on construction, and one
  // of those migrations (and the repository's own first-write path) mints
  // ids/timestamps of its own. Construct the repository outside this
  // function's control but under the same patch so *nothing* the fixture
  // touches — schema setup included — can fall back to real time/randomness.
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
  const libraryId = requireId(repo.createLibrary('Sunday Service').upserts.libraries);
  const playlistId = findPlaylistId(repo, libraryId, requirePlaylistName(repo, libraryId, 'Order of Service'));
  const groupId = findGroupId(repo, playlistId, requireGroupName(repo, playlistId, 'Welcome'));

  const themeId = requireId(repo.createTheme({ name: 'House Theme', kind: 'slides' }).upserts.themes);

  const { itemId: deckId } = repo.createDeckItemWithFirstSlide({
    type: 'presentation',
    title: 'Welcome Slides',
    themeId,
    groupId,
  });
  const { itemId: lyricId } = repo.createDeckItemWithFirstSlide({ type: 'lyric', title: 'Opening Song', groupId });
  const { itemId: talkId } = repo.createDeckItemWithFirstSlide({ type: 'talk', title: 'Message', groupId });

  repo.createTalkScriptBlock({ slideId: firstSlideId(repo, talkId), text: 'Welcome everyone.' });

  void deckId;
  void lyricId;
}

// ─── large: many decks, slides, elements, groups, playlists, collections ─

const LARGE_LIBRARY_COUNT = 2;
const LARGE_PLAYLISTS_PER_LIBRARY = 2;
const LARGE_GROUPS_PER_PLAYLIST = 2;
const LARGE_DECK_COUNT = 24;
const LARGE_EXTRA_SLIDES_PER_DECK = 2;
const LARGE_ELEMENTS_PER_EXTRA_SLIDE = 2;
const DECK_TYPES = ['presentation', 'lyric', 'talk'] as const;

function populateLarge(repo: CastRepository): void {
  const deckCollectionId = requireId(repo.createCollection({ binKind: 'deck', name: 'Large Fixture Decks' }).upserts.collections);
  requireId(repo.createCollection({ binKind: 'theme', name: 'Large Fixture Themes' }).upserts.collections);

  const themeIds = [
    requireId(repo.createTheme({ name: 'Theme Alpha', kind: 'slides' }).upserts.themes),
    requireId(repo.createTheme({ name: 'Theme Beta', kind: 'lyrics' }).upserts.themes),
  ];

  const groupIds: Id[] = [];
  for (let libraryIndex = 0; libraryIndex < LARGE_LIBRARY_COUNT; libraryIndex += 1) {
    const libraryId = requireId(repo.createLibrary(`Library ${libraryIndex}`).upserts.libraries);
    for (let playlistIndex = 0; playlistIndex < LARGE_PLAYLISTS_PER_LIBRARY; playlistIndex += 1) {
      const playlistName = `Playlist ${libraryIndex}-${playlistIndex}`;
      const playlistId = findPlaylistId(repo, libraryId, requirePlaylistName(repo, libraryId, playlistName));
      for (let groupIndex = 0; groupIndex < LARGE_GROUPS_PER_PLAYLIST; groupIndex += 1) {
        const groupName = `Group ${libraryIndex}-${playlistIndex}-${groupIndex}`;
        groupIds.push(findGroupId(repo, playlistId, requireGroupName(repo, playlistId, groupName)));
      }
    }
  }

  for (let deckIndex = 0; deckIndex < LARGE_DECK_COUNT; deckIndex += 1) {
    const type = DECK_TYPES[deckIndex % DECK_TYPES.length]!;
    const groupId = groupIds[deckIndex % groupIds.length]!;
    const themeId = type === 'lyric' ? themeIds[1] : deckIndex % 3 === 0 ? themeIds[0] : undefined;
    const { itemId } = repo.createDeckItemWithFirstSlide({
      type,
      title: `Deck ${deckIndex} (${type})`,
      collectionId: type === 'presentation' ? deckCollectionId : undefined,
      themeId,
      groupId,
    });

    for (let slideIndex = 0; slideIndex < LARGE_EXTRA_SLIDES_PER_DECK; slideIndex += 1) {
      const slideId = requireId(
        repo.createSlide(ownerInputFor(type, itemId)).upserts.slides,
      );
      const elements = [];
      for (let elementIndex = 0; elementIndex < LARGE_ELEMENTS_PER_EXTRA_SLIDE; elementIndex += 1) {
        elements.push(
          elementIndex % 2 === 0
            ? textElementInput(slideId, elementIndex, `Deck ${deckIndex} / Slide ${slideIndex} / ${elementIndex}`)
            : shapeElementInput(slideId, elementIndex),
        );
      }
      repo.createElementsBatch(elements);
    }
  }
}

// ─── media-heavy: many media assets referenced by many elements ────────

const MEDIA_HEAVY_DECK_COUNT = 6;
const MEDIA_HEAVY_SLIDES_PER_DECK = 2;
const MEDIA_HEAVY_IMAGE_ASSET_COUNT = 25;
const MEDIA_HEAVY_VIDEO_ASSET_COUNT = 20;
const MEDIA_HEAVY_AUDIO_ASSET_COUNT = 15;

function populateMediaHeavy(repo: CastRepository, seed: string): void {
  const imageCollectionId = requireId(repo.createCollection({ binKind: 'image', name: 'Fixture Images' }).upserts.collections);
  const videoCollectionId = requireId(repo.createCollection({ binKind: 'video', name: 'Fixture Videos' }).upserts.collections);

  const imageAssetIds = createMediaAssets(repo, 'image', MEDIA_HEAVY_IMAGE_ASSET_COUNT, seed, imageCollectionId);
  const videoAssetIds = createMediaAssets(repo, 'video', MEDIA_HEAVY_VIDEO_ASSET_COUNT, seed, videoCollectionId);
  createMediaAssets(repo, 'audio', MEDIA_HEAVY_AUDIO_ASSET_COUNT, seed, undefined);

  const libraryId = requireId(repo.createLibrary('Media Library').upserts.libraries);
  const playlistId = findPlaylistId(repo, libraryId, requirePlaylistName(repo, libraryId, 'Media Playlist'));
  const groupId = findGroupId(repo, playlistId, requireGroupName(repo, playlistId, 'Media Group'));

  for (let deckIndex = 0; deckIndex < MEDIA_HEAVY_DECK_COUNT; deckIndex += 1) {
    const { itemId } = repo.createDeckItemWithFirstSlide({
      type: 'presentation',
      title: `Media Deck ${deckIndex}`,
      groupId,
    });
    for (let slideIndex = 0; slideIndex < MEDIA_HEAVY_SLIDES_PER_DECK; slideIndex += 1) {
      const slideId = requireId(repo.createSlide({ presentationId: itemId }).upserts.slides);
      const imageAsset = imageAssetIds[(deckIndex * MEDIA_HEAVY_SLIDES_PER_DECK + slideIndex) % imageAssetIds.length]!;
      const videoAsset = videoAssetIds[(deckIndex * MEDIA_HEAVY_SLIDES_PER_DECK + slideIndex) % videoAssetIds.length]!;
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
  collectionId: Id | undefined,
): Array<{ id: Id; src: string }> {
  const created: Array<{ id: Id; src: string }> = [];
  for (let index = 0; index < count; index += 1) {
    const extension = type === 'image' ? 'png' : type === 'video' ? 'mp4' : 'wav';
    const src = `fixture-media://${seed}/${type}/${String(index).padStart(4, '0')}.${extension}`;
    const patch = repo.createMediaAsset({ name: `${type} ${index}`, type, src, collectionId });
    created.push({ id: requireId(patch.upserts.mediaAssets), src });
  }
  return created;
}

// ─── theme-heavy: many decks sharing themes, edited and re-synced ──────

const THEME_HEAVY_DECKS_PER_THEME = 6;

function populateThemeHeavy(repo: CastRepository): void {
  const slidesThemeId = requireId(repo.createTheme({ name: 'Slides Theme', kind: 'slides' }).upserts.themes);
  const lyricsThemeId = requireId(repo.createTheme({ name: 'Lyrics Theme', kind: 'lyrics' }).upserts.themes);
  const overlaysThemeId = requireId(repo.createTheme({ name: 'Overlay Theme', kind: 'overlays' }).upserts.themes);

  const presentationIds: Id[] = [];
  const talkIds: Id[] = [];
  for (let index = 0; index < THEME_HEAVY_DECKS_PER_THEME; index += 1) {
    presentationIds.push(
      repo.createDeckItemWithFirstSlide({ type: 'presentation', title: `Themed Presentation ${index}`, themeId: slidesThemeId }).itemId,
    );
    talkIds.push(
      repo.createDeckItemWithFirstSlide({ type: 'talk', title: `Themed Talk ${index}`, themeId: slidesThemeId }).itemId,
    );
    repo.createDeckItemWithFirstSlide({ type: 'lyric', title: `Themed Lyric ${index}`, themeId: lyricsThemeId });
  }

  for (let index = 0; index < 3; index += 1) {
    const overlayId = requireId(repo.createOverlay({ name: `Themed Overlay ${index}` }).upserts.overlays);
    repo.applyThemeToOverlay(overlaysThemeId, overlayId);
  }

  // Nested provenance: duplicating a themed deck carries its elements'
  // sourceThemeElementId forward onto a second generation of decks.
  for (const presentationId of presentationIds.slice(0, 3)) {
    repo.duplicateDeckItem(presentationId);
  }

  // Editing the theme and re-syncing fans the change out across every deck
  // still linked to it — the provenance path #104/#113 made non-destructive.
  repo.updateTheme({ id: slidesThemeId, name: 'Slides Theme (revised)' });
  repo.syncThemeToLinkedDeckItems(slidesThemeId);

  for (const talkId of talkIds.slice(0, 2)) {
    repo.applyThemeToDeckItem(slidesThemeId, talkId);
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
    const { itemId, patch } = repo.createDeckItemWithFirstSlide({ type: 'talk', title: `Talk ${talkIndex}` });
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

function requirePlaylistName(repo: CastRepository, libraryId: Id, name: string): string {
  repo.createPlaylist(libraryId, name);
  return name;
}

function requireGroupName(repo: CastRepository, playlistId: Id, name: string): string {
  repo.createPlaylistGroup(playlistId, name);
  return name;
}

function findPlaylistId(repo: CastRepository, libraryId: Id, name: string): Id {
  const bundle = repo.getSnapshot().libraryBundles.find((entry) => entry.library.id === libraryId);
  const tree = bundle?.playlists.find((entry) => entry.playlist.name === name);
  if (!tree) throw new Error(`Fixture generation invariant violated: playlist '${name}' not found after creation.`);
  return tree.playlist.id;
}

function findGroupId(repo: CastRepository, playlistId: Id, name: string): Id {
  for (const bundle of repo.getSnapshot().libraryBundles) {
    const tree = bundle.playlists.find((entry) => entry.playlist.id === playlistId);
    if (!tree) continue;
    const group = tree.groups.find((entry) => entry.group.name === name);
    if (group) return group.group.id;
  }
  throw new Error(`Fixture generation invariant violated: group '${name}' not found after creation.`);
}

function firstSlideId(repo: CastRepository, deckItemId: Id): Id {
  const slide = repo.getSnapshot().slides.find(
    (candidate) => candidate.presentationId === deckItemId || candidate.lyricId === deckItemId || candidate.talkId === deckItemId,
  );
  if (!slide) throw new Error(`Fixture generation invariant violated: no slide found for deck item ${deckItemId}.`);
  return slide.id;
}

function ownerInputFor(type: (typeof DECK_TYPES)[number], itemId: Id): { presentationId?: Id; lyricId?: Id; talkId?: Id } {
  if (type === 'presentation') return { presentationId: itemId };
  if (type === 'lyric') return { lyricId: itemId };
  return { talkId: itemId };
}
