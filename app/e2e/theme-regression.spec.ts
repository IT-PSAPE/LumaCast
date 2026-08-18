import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { Presentation, Slide, SlideBackground, SlideElement, ThemeOwnerType } from '@lumacast/composition';
import type { AppSnapshot } from '@lumacast/protocol';

// End-to-end regression test for GitHub issue #100 (root theme epic). The
// epic's "Completion" section lists nine manual QA steps; this spec drives
// every one of them through the real renderer UI (real clicks on real
// elements) against a real Electron instance, exactly like a human tester
// would, then reads back the persisted database state via `castApi` to
// assert on the outcome. Only the *verification* reads go through castApi —
// every state-changing action (editing a theme, clicking a Theme bin entry,
// creating a Presentation/Lyric, adding a slide, duplicating a slide/item,
// adding a custom element, syncing, duplicating a theme) is a real UI
// interaction, so the staged-theme persistence and temporary-id resolution
// paths in the renderer genuinely run — the thing a plain castApi-only test
// cannot exercise.
//
// #219 item-model refactor decision D2: themes are four independent
// per-owner families (presentation/lyric/talk/overlay) rather than one
// `kind`-tagged table, so every theme lookup below is keyed by family. The
// Theme Editor screen's own theme list only ever shows the *currently
// selected* family (a "Theme family" segmented control), so switching
// families explicitly before clicking a theme in that list is required, not
// cosmetic — the theme just isn't in the DOM otherwise.
//
// This intentionally overlaps in spirit (not in mechanism) with
// packages/persistence-sqlite/src/theme-apply.test.ts, theme-sync-integration.test.ts
// and app/renderer/contexts/asset-editor/theme-resolution.test.tsx: those
// cover the same contract at the unit/integration level; this spec is the
// one place that proves the *renderer* wiring (staging, autopush-on-navigate,
// Theme bin click, create-item dialog, sync button) matches it end to end in
// the packaged app.

const APP_ENTRY = path.resolve('out/main/index.js');
const APP_TOOLBAR_REGION = '[data-ui-region="app-toolbar"]';
const EDITOR_LAYOUT_REGION = '[data-ui-region="editor-layout"]';
const ITEM_EDITOR_LAYOUT_REGION = '[data-ui-region="item-editor-layout"]';
const RESOURCE_DRAWER_REGION = '[data-ui-region="resource-drawer"]';
const CREATE_ITEM_DIALOG_REGION = '[data-ui-region="create-item-dialog"]';
const STARTUP_TIMEOUT_MS = 30_000;

const THEME_SLIDES_NAME = 'Regression Slides Theme';
const THEME_LYRICS_NAME = 'Regression Lyrics Theme';
const THEME_SLIDES_COPY_NAME = `${THEME_SLIDES_NAME} Copy`;
const TARGET_PRESENTATION_TITLE = 'Regression Target Presentation';
const PRESENTATION_TITLE = 'Regression Presentation';
const PRESENTATION_COPY_TITLE = `${PRESENTATION_TITLE} Copy`;
const LYRIC_TITLE = 'Regression Lyric';

// Bare 8-digit RGBA hex values (no '#') typed into the background color
// picker's hex field. Each constant name traces to the manual step it proves:
// C0/D0 = baseline persisted color before any edit.
// C1     = step 1's unsaved edit, applied (step 2) while still staged.
// C2/D2  = step 3's unsaved edit, present when the Presentation/Lyric are created.
// C3     = step 5's distractor edit: persisted but never synced, so slide
//          duplication (step 5) must NOT pick it up.
// C4     = step 7's edit, explicitly saved then synced onto linked items.
// C5     = step 8's edit to the *duplicate* theme, proving independence.
const COLOR_C0 = '101010FF';
const COLOR_D0 = '202020FF';
const COLOR_C1 = 'FF3366FF';
const COLOR_C2 = '33CC88FF';
const COLOR_D2 = '8844FFFF';
const COLOR_C3 = 'AA00FFFF';
const COLOR_C4 = 'FFD700FF';
const COLOR_C5 = '00CCFFFF';

let userDataDir = '';

test.beforeAll(() => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-theme-regression-'));
});

test.afterAll(() => {
  if (userDataDir) {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const executablePath =
    process.env.ELECTRON_BINARY ?? ((await import('electron')) as unknown as { default: string }).default;
  const app = await _electron.launch({
    executablePath,
    args: [APP_ENTRY, `--user-data-dir=${userDataDir}`],
  });
  const page = await app.firstWindow();
  await page.locator(APP_TOOLBAR_REGION).waitFor({ state: 'visible', timeout: STARTUP_TIMEOUT_MS });
  return { app, page };
}

function getSnapshot(page: Page): Promise<AppSnapshot> {
  return page.evaluate(() => window.castApi.getSnapshot());
}

// The "Application views" segmented control (Show / Edit / Overlay / Themes /
// Stage / Macros) — the top-level screen switcher.
async function selectView(page: Page, name: 'Show' | 'Edit' | 'Themes') {
  await page.getByRole('group', { name: 'Application views' }).getByRole('button', { name, exact: true }).click();
}

// The resource drawer's Deck/Images/Themes tabs (only present on the Show screen).
async function openDrawerTab(page: Page, name: 'Deck' | 'Themes') {
  await page.getByRole('tab', { name }).click();
}

// The "Theme family" segmented control — shared between the Theme Editor
// screen's own theme list and the resource drawer's Theme bin: both render
// only the currently-selected family's themes (decision D2), so switching
// families is required before a theme belonging to a different family can
// be seen or clicked at all.
async function selectThemeFamily(page: Page, name: 'Presentation' | 'Lyric' | 'Talk' | 'Overlay') {
  await page.getByRole('group', { name: 'Theme family' }).getByRole('button', { name, exact: true }).click();
}

// Bin tiles/rows (theme bin, deck bin) render their name through a
// `RenameField`, which is a controlled `<input readOnly>` — its current text
// lives only in the live DOM `.value` property, not in an HTML attribute or
// text node, so `getByText`/`[value=...]` cannot find it. `inputValue()` reads
// the live property; clicking the (read-only) input bubbles a real click up
// to the tile's own click/context-menu handler exactly like a user clicking
// the tile's caption would.
async function clickTileByRenameValue(
  page: Page,
  scopeSelector: string,
  value: string,
  options: { button?: 'left' | 'right' } = {},
) {
  const inputs = page.locator(`${scopeSelector} input:not([type])`);
  const count = await inputs.count();
  for (let i = 0; i < count; i += 1) {
    const candidate = inputs.nth(i);
    const current = await candidate.inputValue().catch(() => null);
    if (current === value) {
      await candidate.click({ button: options.button ?? 'left' });
      return;
    }
  }
  throw new Error(`No tile with name "${value}" found within ${scopeSelector}`);
}

// The Theme Editor screen's own left-hand theme list renders its caption as a
// plain <span> (not a RenameField), so a normal text locator works.
async function clickThemeInEditorList(page: Page, name: string, options: { button?: 'left' | 'right' } = {}) {
  await page.locator(EDITOR_LAYOUT_REGION).getByText(name, { exact: true }).click({ button: options.button ?? 'left' });
}

// The theme background color hex field (only present once a theme's
// background kind is "Solid color" and a theme is selected in the inspector).
function backgroundHexInput(page: Page) {
  return page.locator('input[maxlength="8"]');
}

async function setBackgroundColorHex(page: Page, hex: string) {
  const input = backgroundHexInput(page);
  await input.click();
  await input.fill(hex);
  await input.press('Tab');
}

async function saveChanges(page: Page) {
  await page.getByRole('button', { name: 'Save Changes' }).click();
}

function findPresentation(snapshot: AppSnapshot, title: string): Presentation {
  const found = snapshot.presentations.find((item) => item.title === title);
  if (!found) throw new Error(`Presentation "${title}" not found in snapshot`);
  return found;
}

function slidesForOwner(snapshot: AppSnapshot, ownerId: string): Slide[] {
  return snapshot.slides
    .filter((slide) => slide.presentationId === ownerId || slide.lyricId === ownerId)
    .slice()
    .sort((a, b) => a.order - b.order);
}

function elementsForSlide(snapshot: AppSnapshot, slideId: string): SlideElement[] {
  return snapshot.slideElements.filter((element) => element.slideId === slideId);
}

function colorOf(background: SlideBackground | null | undefined): string | null {
  return background?.type === 'color' ? background.color : null;
}

function themesForFamily(snapshot: AppSnapshot, themeType: ThemeOwnerType) {
  switch (themeType) {
    case 'presentation': return snapshot.presentationThemes;
    case 'lyric': return snapshot.lyricThemes;
    case 'talk': return snapshot.talkThemes;
    case 'overlay': return snapshot.overlayThemes;
  }
}

function findTheme(snapshot: AppSnapshot, themeType: ThemeOwnerType, name: string) {
  const found = themesForFamily(snapshot, themeType).find((theme) => theme.name === name);
  if (!found) throw new Error(`Theme "${name}" not found in snapshot (family: ${themeType})`);
  return found;
}

test('theme epic #100 manual regression sequence, driven through the real UI', async () => {
  test.setTimeout(240_000);

  let themeSlidesId = '';
  let themeLyricsId = '';
  let themeSlidesCopyId = '';
  let targetPresentationId = '';
  let presentationId = '';
  let presentationCopyId = '';
  let lyricId = '';

  const first = await launchApp();
  try {
    const { page } = first;

    // ── Setup: create the two baseline themes through the real drawer "New
    // <family> theme" flow, and save each once so step 1 has an *existing*
    // (already-persisted) theme to edit, per the manual step's own wording. ──
    await test.step('setup: create baseline themes via UI', async () => {
      // Presentation-family theme, background = C0.
      await selectView(page, 'Show');
      await openDrawerTab(page, 'Themes');
      await page.getByRole('button', { name: 'More actions' }).click();
      await page.getByRole('menuitem', { name: 'New presentation theme' }).click();
      await page.getByLabel('Name').fill(THEME_SLIDES_NAME);
      await page.getByLabel('Name').press('Tab');
      await page.getByRole('button', { name: 'None' }).click();
      await page.getByRole('menuitem', { name: 'Solid color' }).click();
      await setBackgroundColorHex(page, COLOR_C0);
      await saveChanges(page);

      // Lyric-family theme, background = D0.
      await selectView(page, 'Show');
      await openDrawerTab(page, 'Themes');
      await page.getByRole('button', { name: 'More actions' }).click();
      await page.getByRole('menuitem', { name: 'New lyric theme' }).click();
      await page.getByLabel('Name').fill(THEME_LYRICS_NAME);
      await page.getByLabel('Name').press('Tab');
      await page.getByRole('button', { name: 'None' }).click();
      await page.getByRole('menuitem', { name: 'Solid color' }).click();
      await setBackgroundColorHex(page, COLOR_D0);
      await saveChanges(page);

      const snapshot = await getSnapshot(page);
      themeSlidesId = findTheme(snapshot, 'presentation', THEME_SLIDES_NAME).id;
      themeLyricsId = findTheme(snapshot, 'lyric', THEME_LYRICS_NAME).id;
      expect(colorOf(findTheme(snapshot, 'presentation', THEME_SLIDES_NAME).background)).toBe(`#${COLOR_C0}`);
      expect(colorOf(findTheme(snapshot, 'lyric', THEME_LYRICS_NAME).background)).toBe(`#${COLOR_D0}`);

      // Setup target for step 2: a presentation with no theme, created
      // through the same dialog real users use.
      await selectView(page, 'Show');
      await openDrawerTab(page, 'Deck');
      await page.getByRole('button', { name: 'More actions' }).click();
      await page.getByRole('menuitem', { name: 'New presentation' }).click();
      await page.locator(`${CREATE_ITEM_DIALOG_REGION} input[type="text"]`).fill(TARGET_PRESENTATION_TITLE);
      await page.getByRole('button', { name: 'New', exact: true }).click();

      const afterTarget = await getSnapshot(page);
      targetPresentationId = findPresentation(afterTarget, TARGET_PRESENTATION_TITLE).id;
    });

    // ── Step 1: edit an existing theme without manually saving it. ──
    await test.step('step 1: edit an existing theme without saving', async () => {
      await selectView(page, 'Themes');
      await selectThemeFamily(page, 'Presentation');
      await clickThemeInEditorList(page, THEME_SLIDES_NAME);
      await setBackgroundColorHex(page, COLOR_C1);

      // Contract rule 1 requires the edit to be genuinely unsaved at this
      // point — assert the Save Changes affordance (staged/pending state) is
      // showing rather than trusting that the click landed.
      await expect(page.getByRole('button', { name: 'Save Changes' })).toBeVisible();
      const stillPersistedAsBaseline = await getSnapshot(page);
      expect(colorOf(findTheme(stillPersistedAsBaseline, 'presentation', THEME_SLIDES_NAME).background)).toBe(`#${COLOR_C0}`);
    });

    // ── Step 2: apply it by clicking the Theme bin entry; confirm the
    // visible staged version (C1) is used, not the last-persisted one (C0). ──
    await test.step('step 2: apply staged theme via Theme bin click', async () => {
      await selectView(page, 'Show');
      await openDrawerTab(page, 'Deck');
      await clickTileByRenameValue(page, RESOURCE_DRAWER_REGION, TARGET_PRESENTATION_TITLE);
      await openDrawerTab(page, 'Themes');
      await selectThemeFamily(page, 'Presentation');
      await clickTileByRenameValue(page, RESOURCE_DRAWER_REGION, THEME_SLIDES_NAME);

      await expect
        .poll(async () => {
          const snapshot = await getSnapshot(page);
          const owner = findPresentation(snapshot, TARGET_PRESENTATION_TITLE);
          const slide = slidesForOwner(snapshot, owner.id)[0];
          return { themeId: owner.themeId, bg: colorOf(slide?.background) };
        })
        .toEqual({ themeId: themeSlidesId, bg: `#${COLOR_C1}` });
    });

    // ── Step 3: create both a Presentation and a Lyric with a
    // freshly-edited-but-unsaved theme; confirm their first slides use the
    // staged version. ──
    await test.step('step 3: create Presentation + Lyric with staged themes', async () => {
      await selectView(page, 'Themes');
      await selectThemeFamily(page, 'Presentation');
      await clickThemeInEditorList(page, THEME_SLIDES_NAME);
      await setBackgroundColorHex(page, COLOR_C2);
      await selectThemeFamily(page, 'Lyric');
      await clickThemeInEditorList(page, THEME_LYRICS_NAME);
      await setBackgroundColorHex(page, COLOR_D2);

      await selectView(page, 'Show');
      await openDrawerTab(page, 'Deck');

      await page.getByRole('button', { name: 'More actions' }).click();
      await page.getByRole('menuitem', { name: 'New presentation' }).click();
      await page.locator(`${CREATE_ITEM_DIALOG_REGION} input[type="text"]`).fill(PRESENTATION_TITLE);
      await page.getByLabel('Theme').click();
      await page.getByRole('menuitem', { name: THEME_SLIDES_NAME, exact: true }).click();
      await page.getByRole('button', { name: 'New', exact: true }).click();

      await page.getByRole('button', { name: 'More actions' }).click();
      await page.getByRole('menuitem', { name: 'New lyric' }).click();
      await page.locator(`${CREATE_ITEM_DIALOG_REGION} input[type="text"]`).fill(LYRIC_TITLE);
      await page.getByLabel('Theme').click();
      await page.getByRole('menuitem', { name: THEME_LYRICS_NAME, exact: true }).click();
      await page.getByRole('button', { name: 'Save', exact: true }).click();

      const snapshot = await getSnapshot(page);
      const presentation = findPresentation(snapshot, PRESENTATION_TITLE);
      presentationId = presentation.id;
      const lyric = snapshot.lyrics.find((item) => item.title === LYRIC_TITLE);
      if (!lyric) throw new Error('Lyric not created');
      lyricId = lyric.id;

      expect(presentation.themeId).toBe(themeSlidesId);
      expect(colorOf(slidesForOwner(snapshot, presentation.id)[0]?.background)).toBe(`#${COLOR_C2}`);
      expect(lyric.themeId).toBe(themeLyricsId);
      expect(colorOf(slidesForOwner(snapshot, lyric.id)[0]?.background)).toBe(`#${COLOR_D2}`);
    });

    // ── Step 4: add a slide; confirm it uses the owner's assigned, persisted
    // theme (C2) and not whatever theme happens to be selected in the Theme
    // Editor (Lyrics theme is left selected from step 3, as a distractor). ──
    await test.step('step 4: add a slide uses the owner\'s persisted theme', async () => {
      await selectView(page, 'Edit');
      await page.getByRole('button', { name: 'Select item' }).click();
      await page.getByRole('option', { name: PRESENTATION_TITLE, exact: true }).click();

      const before = await getSnapshot(page);
      const slideCountBefore = slidesForOwner(before, presentationId).length;

      await page.locator(ITEM_EDITOR_LAYOUT_REGION).getByRole('button', { name: 'Add', exact: true }).click();
      await page.getByRole('menuitem', { name: 'New slide' }).click();

      await expect
        .poll(async () => {
          const snapshot = await getSnapshot(page);
          return slidesForOwner(snapshot, presentationId).length;
        })
        .toBe(slideCountBefore + 1);

      const snapshot = await getSnapshot(page);
      const slides = slidesForOwner(snapshot, presentationId);
      // Assigned theme is themeSlides (still C2 at this point); the
      // distractor theme currently open in the Theme Editor is themeLyrics
      // (D2) — the new slide must not pick that up.
      expect(colorOf(slides[slides.length - 1].background)).toBe(`#${COLOR_C2}`);
    });

    // ── Step 5: duplicate a slide; confirm the duplicate exactly matches the
    // source slide, not the theme's *latest* (re-edited, unsynced) color. ──
    await test.step('step 5: duplicate a slide matches its source exactly', async () => {
      // Move the theme's persisted color on without syncing it onto any
      // item, so a naive "rebuild from latest theme" duplicate would diverge
      // from the true source-slide color (C2).
      await selectView(page, 'Themes');
      await selectThemeFamily(page, 'Presentation');
      await clickThemeInEditorList(page, THEME_SLIDES_NAME);
      await setBackgroundColorHex(page, COLOR_C3);
      await saveChanges(page);
      const afterDistractorSave = await getSnapshot(page);
      expect(colorOf(findTheme(afterDistractorSave, 'presentation', THEME_SLIDES_NAME).background)).toBe(`#${COLOR_C3}`);

      await selectView(page, 'Edit');
      const beforeSnapshot = await getSnapshot(page);
      const sourceSlide = slidesForOwner(beforeSnapshot, presentationId)[1];
      expect(colorOf(sourceSlide.background)).toBe(`#${COLOR_C2}`);

      const secondSlideTile = page.locator('[role="grid"][aria-label="Current slides"] > div').nth(1);
      await secondSlideTile.click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Duplicate' }).click();

      await expect
        .poll(async () => {
          const snapshot = await getSnapshot(page);
          return slidesForOwner(snapshot, presentationId).length;
        })
        .toBe(3);

      const afterSnapshot = await getSnapshot(page);
      const slides = slidesForOwner(afterSnapshot, presentationId);
      // Every slide must still read C2 (the source's own color): the
      // duplicate must not have been rebuilt from the theme's now-current C3.
      for (const slide of slides) {
        expect(colorOf(slide.background)).toBe(`#${COLOR_C2}`);
      }
    });

    // ── Step 6: duplicate the whole item; confirm all materialized content
    // plus the theme assignment are copied. ──
    await test.step('step 6: duplicate the whole item', async () => {
      await selectView(page, 'Show');
      await openDrawerTab(page, 'Deck');
      await clickTileByRenameValue(page, RESOURCE_DRAWER_REGION, PRESENTATION_TITLE, { button: 'right' });
      await page.getByRole('menuitem', { name: 'Duplicate' }).click();

      await expect
        .poll(async () => {
          const snapshot = await getSnapshot(page);
          return snapshot.presentations.some((item) => item.title === PRESENTATION_COPY_TITLE);
        })
        .toBe(true);

      const snapshot = await getSnapshot(page);
      const source = findPresentation(snapshot, PRESENTATION_TITLE);
      const copy = findPresentation(snapshot, PRESENTATION_COPY_TITLE);
      presentationCopyId = copy.id;

      expect(copy.themeId).toBe(source.themeId);
      const sourceSlides = slidesForOwner(snapshot, source.id);
      const copySlides = slidesForOwner(snapshot, copy.id);
      expect(copySlides).toHaveLength(sourceSlides.length);
      for (let i = 0; i < sourceSlides.length; i += 1) {
        expect(colorOf(copySlides[i].background)).toBe(colorOf(sourceSlides[i].background));
        expect(copySlides[i].id).not.toBe(sourceSlides[i].id);
      }
    });

    // ── Step 7: add custom slide content, synchronize the theme, confirm the
    // custom content survives while theme-owned content updates. ──
    await test.step('step 7: custom content survives theme sync', async () => {
      await selectView(page, 'Edit');
      await page.getByRole('button', { name: 'Select item' }).click();
      await page.getByRole('option', { name: PRESENTATION_TITLE, exact: true }).click();

      const firstSlideTile = page.locator('[role="grid"][aria-label="Current slides"] > div').nth(0);
      await firstSlideTile.click();
      await page.getByRole('button', { name: 'Add shape' }).click();
      await expect(page.getByRole('button', { name: 'Save Changes' })).toBeVisible();
      await saveChanges(page);

      const beforeSync = await getSnapshot(page);
      const firstSlideBeforeSync = slidesForOwner(beforeSync, presentationId)[0];
      const elementsBeforeSync = elementsForSlide(beforeSync, firstSlideBeforeSync.id);
      const customShape = elementsBeforeSync.find((element) => element.type === 'shape' && !element.sourceThemeElementId);
      expect(customShape, 'custom shape element should exist before sync').toBeTruthy();

      await selectView(page, 'Themes');
      await selectThemeFamily(page, 'Presentation');
      await clickThemeInEditorList(page, THEME_SLIDES_NAME);
      await setBackgroundColorHex(page, COLOR_C4);
      // The Sync button is disabled while the theme itself has pending
      // changes (rule 1: persist staged edits before the dependent
      // mutation), so this Save is required before Sync becomes clickable.
      await saveChanges(page);
      const syncButton = page.getByRole('button', { name: /^Sync \d+ linked items?$/ });
      await expect(syncButton).toBeEnabled();
      await syncButton.click();

      await expect
        .poll(async () => {
          const snapshot = await getSnapshot(page);
          const slide = slidesForOwner(snapshot, presentationId)[0];
          return colorOf(slide.background);
        })
        .toBe(`#${COLOR_C4}`);

      const afterSync = await getSnapshot(page);
      const firstSlideAfterSync = slidesForOwner(afterSync, presentationId)[0];
      const elementsAfterSync = elementsForSlide(afterSync, firstSlideAfterSync.id);
      const survivingShape = elementsAfterSync.find((element) => element.id === customShape!.id);
      expect(survivingShape, 'custom shape must survive theme sync unchanged').toBeTruthy();
      expect(survivingShape?.type).toBe('shape');
      expect(survivingShape?.sourceThemeElementId).toBeFalsy();
      // Every other linked item (target presentation from step 2, the item
      // duplicate from step 6) is synced too.
      const targetAfterSync = slidesForOwner(afterSync, targetPresentationId)[0];
      expect(colorOf(targetAfterSync.background)).toBe(`#${COLOR_C4}`);
      const copyAfterSync = slidesForOwner(afterSync, presentationCopyId);
      for (const slide of copyAfterSync) {
        expect(colorOf(slide.background)).toBe(`#${COLOR_C4}`);
      }
    });

    // ── Step 8: duplicate the theme; confirm background and elements are
    // identical but independently editable. ──
    await test.step('step 8: duplicate the theme', async () => {
      await selectView(page, 'Themes');
      await selectThemeFamily(page, 'Presentation');
      await clickThemeInEditorList(page, THEME_SLIDES_NAME, { button: 'right' });
      await page.getByRole('menuitem', { name: 'Duplicate' }).click();
      await saveChanges(page);

      const afterDuplicate = await getSnapshot(page);
      const source = findTheme(afterDuplicate, 'presentation', THEME_SLIDES_NAME);
      const copy = findTheme(afterDuplicate, 'presentation', THEME_SLIDES_COPY_NAME);
      themeSlidesCopyId = copy.id;

      expect(copy.id).not.toBe(source.id);
      expect(colorOf(copy.background)).toBe(colorOf(source.background));
      expect(copy.elements).toHaveLength(source.elements.length);
      expect(copy.elements.map((element) => element.type)).toEqual(source.elements.map((element) => element.type));
      expect(copy.elements[0]?.id).not.toBe(source.elements[0]?.id);

      // Independence: editing the duplicate must not affect the source.
      await clickThemeInEditorList(page, THEME_SLIDES_COPY_NAME);
      await setBackgroundColorHex(page, COLOR_C5);
      await saveChanges(page);

      const afterIndependentEdit = await getSnapshot(page);
      expect(colorOf(findTheme(afterIndependentEdit, 'presentation', THEME_SLIDES_NAME).background)).toBe(`#${COLOR_C4}`);
      expect(colorOf(findTheme(afterIndependentEdit, 'presentation', THEME_SLIDES_COPY_NAME).background)).toBe(`#${COLOR_C5}`);
    });
  } finally {
    await first.app.close();
  }

  // ── Step 9: restart the application; confirm all results persist. ──
  await test.step('step 9: restart and confirm persistence', async () => {
    const second = await launchApp();
    try {
      const snapshot = await getSnapshot(second.page);

      const themeSlides = findTheme(snapshot, 'presentation', THEME_SLIDES_NAME);
      const themeSlidesCopy = findTheme(snapshot, 'presentation', THEME_SLIDES_COPY_NAME);
      const themeLyrics = findTheme(snapshot, 'lyric', THEME_LYRICS_NAME);
      expect(themeSlides.id).toBe(themeSlidesId);
      expect(colorOf(themeSlides.background)).toBe(`#${COLOR_C4}`);
      expect(themeSlidesCopy.id).toBe(themeSlidesCopyId);
      expect(colorOf(themeSlidesCopy.background)).toBe(`#${COLOR_C5}`);
      expect(themeLyrics.id).toBe(themeLyricsId);
      expect(colorOf(themeLyrics.background)).toBe(`#${COLOR_D2}`);

      const targetPresentation = findPresentation(snapshot, TARGET_PRESENTATION_TITLE);
      expect(targetPresentation.id).toBe(targetPresentationId);
      expect(targetPresentation.themeId).toBe(themeSlidesId);
      expect(colorOf(slidesForOwner(snapshot, targetPresentation.id)[0]?.background)).toBe(`#${COLOR_C4}`);

      const presentation = findPresentation(snapshot, PRESENTATION_TITLE);
      expect(presentation.id).toBe(presentationId);
      const slides = slidesForOwner(snapshot, presentation.id);
      expect(slides).toHaveLength(3);
      for (const slide of slides) {
        expect(colorOf(slide.background)).toBe(`#${COLOR_C4}`);
      }
      const firstSlideElements = elementsForSlide(snapshot, slides[0].id);
      expect(firstSlideElements.some((element) => element.type === 'shape' && !element.sourceThemeElementId)).toBe(true);

      const presentationCopy = findPresentation(snapshot, PRESENTATION_COPY_TITLE);
      expect(presentationCopy.id).toBe(presentationCopyId);
      expect(presentationCopy.themeId).toBe(themeSlidesId);

      const lyric = snapshot.lyrics.find((item) => item.title === LYRIC_TITLE);
      expect(lyric?.id).toBe(lyricId);
      expect(lyric?.themeId).toBe(themeLyricsId);
    } finally {
      await second.app.close();
    }
  });
});
