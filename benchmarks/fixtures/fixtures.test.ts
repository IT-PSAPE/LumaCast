// @vitest-environment node
//
// Fixture generation opens real SQLite files and patches node:crypto and Date,
// so it runs under the Node environment rather than the config-wide jsdom one,
// the same way app/database/migrations/schema-equivalence.test.ts does.
import { describe, expect, it } from 'vitest';
import { LATEST_SCHEMA_VERSION } from '@database/migrations';
import { defaultSeedFor, generateFixture } from './generator';
import { FIXTURE_CLASSES, isManifestCurrent, type FixtureClass } from './manifest';

describe('generateFixture — determinism (#200 acceptance: repeated generation)', () => {
  for (const fixtureClass of FIXTURE_CLASSES) {
    it(`produces a byte-identical manifest across two independent generations: ${fixtureClass}`, () => {
      const first = generateFixture(fixtureClass);
      const second = generateFixture(fixtureClass);

      expect(second.manifest).toStrictEqual(first.manifest);
      expect(second.manifest.contentHash).toBe(first.manifest.contentHash);
      // Deep content equality, not just the hash: a hash collision (how ever
      // unlikely) must not be able to pass this test on its own.
      expect(second.snapshot).toStrictEqual(first.snapshot);
    });
  }

  it('changing the seed changes the content hash', () => {
    const withDefaultSeed = generateFixture('small');
    const withOtherSeed = generateFixture('small', { seed: 'a-different-seed' });

    expect(withOtherSeed.manifest.contentHash).not.toBe(withDefaultSeed.manifest.contentHash);
    expect(withOtherSeed.manifest.seed).toBe('a-different-seed');
  });

  it('uses a fixed default seed per class, not a random one', () => {
    for (const fixtureClass of FIXTURE_CLASSES) {
      expect(generateFixture(fixtureClass).manifest.seed).toBe(defaultSeedFor(fixtureClass));
    }
  });
});

describe('generateFixture — versioning against the schema (#200 acceptance: versioned)', () => {
  it('records the schema version it was generated against', () => {
    const { manifest } = generateFixture('small');
    expect(manifest.schemaVersion).toBe(LATEST_SCHEMA_VERSION);
  });

  it('flags a manifest as stale once the schema has moved on', () => {
    const { manifest } = generateFixture('small');
    expect(isManifestCurrent(manifest, { schemaVersion: LATEST_SCHEMA_VERSION })).toBe(true);
    expect(isManifestCurrent(manifest, { schemaVersion: LATEST_SCHEMA_VERSION + 1 })).toBe(false);
  });

  it('flags a manifest as stale once the generator logic has moved on', () => {
    const { manifest } = generateFixture('small');
    expect(
      isManifestCurrent(manifest, { schemaVersion: LATEST_SCHEMA_VERSION, generatorVersion: manifest.generatorVersion + 1 }),
    ).toBe(false);
  });
});

describe('generateFixture — invalid generation fails non-zero with actionable output (#200 acceptance)', () => {
  it('throws for an unknown fixture class', () => {
    expect(() => generateFixture('not-a-real-fixture-class')).toThrow(/Unknown fixture class 'not-a-real-fixture-class'/);
  });

  it('throws for a blank seed', () => {
    expect(() => generateFixture('small', { seed: '   ' })).toThrow(/non-empty/);
  });

  it('throws for an empty-string fixture class', () => {
    expect(() => generateFixture('')).toThrow(/Unknown fixture class/);
  });
});

describe('generateFixture — entity/relationship coverage (#200 acceptance: required kinds represented)', () => {
  const manifests = Object.fromEntries(
    FIXTURE_CLASSES.map((fixtureClass) => [fixtureClass, generateFixture(fixtureClass).manifest]),
  ) as Record<FixtureClass, ReturnType<typeof generateFixture>['manifest']>;

  it('small is a minimal but complete ordinary project', () => {
    const counts = manifests.small.entityCounts;
    expect(counts.libraries).toBeGreaterThanOrEqual(1);
    expect(counts.playlists).toBeGreaterThanOrEqual(1);
    expect(counts.playlistGroups).toBeGreaterThanOrEqual(1);
    expect(counts.presentations).toBe(1);
    expect(counts.lyrics).toBe(1);
    expect(counts.talks).toBe(1);
    expect(counts.slides).toBe(3);
    expect(counts.talkScriptBlocks).toBe(1);
    expect(counts.deckSlideElements).toBeGreaterThan(0);
    expect(counts.themes).toBe(1);
  });

  it('large has many decks, slides, elements, groups, playlists and collections', () => {
    const small = manifests.small.entityCounts;
    const large = manifests.large.entityCounts;
    expect(large.libraries).toBeGreaterThan(small.libraries);
    expect(large.playlists).toBeGreaterThan(small.playlists);
    expect(large.playlistGroups).toBeGreaterThan(small.playlistGroups);
    expect(large.presentations + large.lyrics + large.talks).toBeGreaterThan(20);
    expect(large.slides).toBeGreaterThan(50);
    expect(large.deckSlideElements).toBeGreaterThan(100);
    expect(large.collections).toBeGreaterThan(small.collections);
  });

  it('media-heavy is dominated by media assets referenced from slide content', () => {
    const counts = manifests['media-heavy'].entityCounts;
    expect(counts.mediaAssets).toBeGreaterThanOrEqual(60);
    expect(counts.deckSlideElements).toBeGreaterThan(0);
    expect(counts.mediaAssets).toBeGreaterThan(counts.presentations + counts.lyrics + counts.talks);
  });

  it('theme-heavy has many decks sharing themes with real provenance links, including through overlays', () => {
    const { manifest, snapshot } = generateFixture('theme-heavy');
    expect(manifest.entityCounts.themes).toBeGreaterThanOrEqual(3);
    expect(manifest.entityCounts.overlays).toBeGreaterThanOrEqual(3);
    expect(manifest.entityCounts.presentations).toBeGreaterThan(0);
    expect(manifest.entityCounts.talks).toBeGreaterThan(0);
    expect(manifest.entityCounts.lyrics).toBeGreaterThan(0);

    const provenanceLinked = snapshot.slideElements.filter((element) => element.sourceThemeElementId != null);
    expect(provenanceLinked.length).toBeGreaterThan(0);

    // As of #211, `getSlideElements()` (and so `AppSnapshot.slideElements`)
    // is scoped to deck-owned slides exactly like `AppSnapshot.slides` —
    // theme/overlay/stage container elements (there are 6 of them here: 3
    // themes + 3 overlays, each with one default element) are excluded
    // entirely, not merely double-counted. `slideElements` and
    // `deckSlideElements` should therefore be equal; a mismatch would mean
    // that scoping has regressed and container elements are leaking back
    // into the deck-content count.
    expect(manifest.entityCounts.slideElements).toBe(manifest.entityCounts.deckSlideElements);
  });

  it('talk-automation-heavy is dominated by talks, script blocks, cues, macros and trigger bindings', () => {
    const counts = manifests['talk-automation-heavy'].entityCounts;
    expect(counts.talks).toBeGreaterThanOrEqual(12);
    expect(counts.talkScriptBlocks).toBeGreaterThanOrEqual(60);
    expect(counts.cues).toBeGreaterThanOrEqual(30);
    expect(counts.macros).toBeGreaterThanOrEqual(15);
    expect(counts.triggerBindings).toBeGreaterThanOrEqual(25);
  });

  it('every entity/relationship kind is represented by at least one fixture class', () => {
    const totals = Object.values(manifests).reduce<Record<string, number>>((acc, manifest) => {
      for (const [key, value] of Object.entries(manifest.entityCounts)) {
        acc[key] = (acc[key] ?? 0) + value;
      }
      return acc;
    }, {});

    for (const [key, total] of Object.entries(totals)) {
      expect(total, `entity kind '${key}' was never produced by any fixture class`).toBeGreaterThan(0);
    }
  });
});
