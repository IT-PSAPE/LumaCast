import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { LumaCastPanel } from './panel';

// Covers #217: every LumaCastPanel subcomponent except MenuItem destructured
// only { children, className } and silently dropped every other prop before
// rendering its element, so a caller-supplied data-* attribute (e.g. the
// `data-ui-region="inspector-panel"` used by both inspector-panel screens)
// never reached the DOM. Each case renders a subcomponent with a forwarded
// data-* attribute (used as the lookup key, since it must itself survive)
// plus className, and asserts both land on the actual rendered element.

describe('LumaCastPanel', () => {
  it('Root forwards a data-* attribute and className to the rendered <aside>', () => {
    render(
      <LumaCastPanel.Root data-ui-region="inspector-panel" className="custom-root">
        content
      </LumaCastPanel.Root>,
    );
    const node = document.querySelector('[data-ui-region="inspector-panel"]');
    expect(node).not.toBeNull();
    expect(node?.tagName).toBe('ASIDE');
    expect(node?.classList.contains('custom-root')).toBe(true);
  });

  it('Header forwards a data-* attribute and className to the rendered <header>', () => {
    render(
      <LumaCastPanel.Header data-ui-marker="header" className="custom-header">
        content
      </LumaCastPanel.Header>,
    );
    const node = document.querySelector('[data-ui-marker="header"]');
    expect(node).not.toBeNull();
    expect(node?.tagName).toBe('HEADER');
    expect(node?.classList.contains('custom-header')).toBe(true);
  });

  it('Content forwards a data-* attribute and className to the rendered element', () => {
    render(
      <LumaCastPanel.Content data-ui-marker="content" className="custom-content">
        content
      </LumaCastPanel.Content>,
    );
    const node = document.querySelector('[data-ui-marker="content"]');
    expect(node).not.toBeNull();
    expect(node?.classList.contains('custom-content')).toBe(true);
  });

  it('Footer forwards a data-* attribute and className to its outer wrapper', () => {
    render(
      <LumaCastPanel.Footer data-ui-marker="footer" className="custom-footer">
        content
      </LumaCastPanel.Footer>,
    );
    const node = document.querySelector('[data-ui-marker="footer"]');
    expect(node).not.toBeNull();
    expect(node?.classList.contains('custom-footer')).toBe(true);
  });

  it('Group forwards a data-* attribute and className to the rendered element', () => {
    render(
      <LumaCastPanel.Group data-ui-marker="group" className="custom-group">
        content
      </LumaCastPanel.Group>,
    );
    const node = document.querySelector('[data-ui-marker="group"]');
    expect(node).not.toBeNull();
    expect(node?.classList.contains('custom-group')).toBe(true);
  });

  it('GroupTitle forwards a data-* attribute and className to the rendered element', () => {
    render(
      <LumaCastPanel.GroupTitle data-ui-marker="group-title" className="custom-group-title">
        content
      </LumaCastPanel.GroupTitle>,
    );
    const node = document.querySelector('[data-ui-marker="group-title"]');
    expect(node).not.toBeNull();
    expect(node?.classList.contains('custom-group-title')).toBe(true);
  });

  it('GroupFooter forwards a data-* attribute and className to the rendered element', () => {
    render(
      <LumaCastPanel.GroupFooter data-ui-marker="group-footer" className="custom-group-footer">
        content
      </LumaCastPanel.GroupFooter>,
    );
    const node = document.querySelector('[data-ui-marker="group-footer"]');
    expect(node).not.toBeNull();
    expect(node?.classList.contains('custom-group-footer')).toBe(true);
  });

  it('GroupContent forwards a data-* attribute and className to the rendered element', () => {
    render(
      <LumaCastPanel.GroupContent data-ui-marker="group-content" className="custom-group-content">
        content
      </LumaCastPanel.GroupContent>,
    );
    const node = document.querySelector('[data-ui-marker="group-content"]');
    expect(node).not.toBeNull();
    expect(node?.classList.contains('custom-group-content')).toBe(true);
  });

  it('MenuItem already forwards a data-* attribute and className to the rendered <button> (control case)', () => {
    render(
      <LumaCastPanel.MenuItem data-ui-marker="menu-item" className="custom-menu-item">
        content
      </LumaCastPanel.MenuItem>,
    );
    const node = document.querySelector('[data-ui-marker="menu-item"]');
    expect(node).not.toBeNull();
    expect(node?.tagName).toBe('BUTTON');
    expect(node?.classList.contains('custom-menu-item')).toBe(true);
  });
});
