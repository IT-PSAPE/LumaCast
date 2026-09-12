import { describe, expect, it } from 'vitest';
import { resolveLinkedSlideElements } from '@lumacast/composition';
import { validateProjectBackup } from '@lumacast/protocol';
import { createTestRepository } from '../../../../packages/persistence-sqlite/src/test-support';

for (const operation of ['detach', 'delete'] as const) {
  describe(`live theme ${operation}`, () => {
    it('materializes current inherited values, preserves explicit overrides, and clears provenance', () => {
      const target = createTestRepository({ seed: false });
      try {
        const repo = target.repository;
        const theme = repo.createTheme({ name: 'Linked', themeType: 'presentation' }).upserts.presentationThemes![0]!;
        const itemId = repo.createItem({ type: 'presentation', title: 'Deck', themeId: theme.id }).itemId;
        const snapshot = repo.getSnapshot();
        const slide = snapshot.slides.find((entry) => entry.presentationId === itemId)!;
        const row = snapshot.slideElements.find((entry) => entry.slideId === slide.id)!;
        repo.updateElement({ id: row.id, x: 123, themeOverrideKeys: ['x'] });
        repo.updateTheme({ id: theme.id, themeType: 'presentation', elements: theme.elements.map((element) => ({ ...element, x: 999, y: 456 })) });
        const saved = repo.getSnapshot();
        const currentTheme = saved.presentationThemes.find((entry) => entry.id === theme.id)!;
        const rows = saved.slideElements.filter((entry) => entry.slideId === slide.id);
        const live = resolveLinkedSlideElements(currentTheme, slide.id, rows);
        expect(live.find((entry) => entry.id === row.id)).toMatchObject({ x: 123, y: 456 });
        expect(validateProjectBackup(repo.exportProjectBackup()).tables.slide_elements.find((entry) => entry.id === row.id)?.theme_override_keys_json).toBe('["x"]');
        if (operation === 'detach') repo.detachThemeFromItem({ type: 'presentation', id: itemId });
        else repo.deleteTheme(theme.id, 'presentation');
        const detached = repo.getSnapshot();
        expect(detached.presentations.find((entry) => entry.id === itemId)?.themeId).toBeNull();
        expect(detached.slideElements.find((entry) => entry.id === row.id)).toMatchObject({ x: 123, y: 456, sourceThemeElementId: null, themeOverrideKeys: null });
      } finally { target.close(); target.cleanup(); }
    });

    it('removes deleted theme nodes and materializes new ones', () => {
      const target = createTestRepository({ seed: false });
      try {
        const repo = target.repository;
        const theme = repo.createTheme({ name: 'Linked', themeType: 'presentation' }).upserts.presentationThemes![0]!;
        const itemId = repo.createItem({ type: 'presentation', title: 'Deck', themeId: theme.id }).itemId;
        const initial = repo.getSnapshot();
        const slide = initial.slides.find((entry) => entry.presentationId === itemId)!;
        const oldIds = initial.slideElements.filter((entry) => entry.slideId === slide.id).map((entry) => entry.id);
        repo.updateTheme({ id: theme.id, themeType: 'presentation', elements: [{ ...theme.elements[0]!, id: 'new-source', x: 321 }] });
        if (operation === 'detach') repo.detachThemeFromItem({ type: 'presentation', id: itemId });
        else repo.deleteTheme(theme.id, 'presentation');
        const rows = repo.getSnapshot().slideElements.filter((entry) => entry.slideId === slide.id);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ x: 321, sourceThemeElementId: null });
        expect(oldIds).not.toContain(rows[0]!.id);
      } finally { target.close(); target.cleanup(); }
    });
  });
}
