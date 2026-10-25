import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Panel } from '@lumacast/ui';

// Cast's inspector panels and list columns use the package Panel. The #217
// contract (data-* and className survive on every part, e.g. the
// data-ui-region="inspector-panel" the UI specs rely on) must hold for it too.
// Root is a <section> here, where LumaCastPanel.Root is an <aside>.

describe('package Panel as used by cast', () => {
  it('Root forwards a data-* attribute and className to the rendered <section>', () => {
    render(<Panel data-ui-region="inspector-panel" className="custom-root">content</Panel>);
    const node = document.querySelector('[data-ui-region="inspector-panel"]');
    expect(node).not.toBeNull();
    expect(node?.tagName).toBe('SECTION');
    expect(node?.classList.contains('custom-root')).toBe(true);
  });

  it('Header forwards a data-* attribute and className to the rendered <header>', () => {
    render(<Panel><Panel.Header data-ui-marker="header" className="custom-header">content</Panel.Header></Panel>);
    const node = document.querySelector('[data-ui-marker="header"]');
    expect(node?.tagName).toBe('HEADER');
    expect(node?.classList.contains('custom-header')).toBe(true);
  });

  it('Body forwards a data-* attribute and className', () => {
    render(<Panel><Panel.Body data-ui-marker="body" className="custom-body">content</Panel.Body></Panel>);
    const node = document.querySelector('[data-ui-marker="body"]');
    expect(node).not.toBeNull();
    expect(node?.classList.contains('custom-body')).toBe(true);
  });

  it('Footer forwards a data-* attribute and className to the rendered <footer>', () => {
    render(<Panel><Panel.Footer data-ui-marker="footer" className="custom-footer">content</Panel.Footer></Panel>);
    const node = document.querySelector('[data-ui-marker="footer"]');
    expect(node?.tagName).toBe('FOOTER');
    expect(node?.classList.contains('custom-footer')).toBe(true);
  });

  it('HeaderTitle and HeaderActions forward className', () => {
    render(
      <Panel>
        <Panel.Header>
          <Panel.HeaderTitle data-ui-marker="title" className="custom-title">Title</Panel.HeaderTitle>
          <Panel.HeaderActions data-ui-marker="actions" className="custom-actions">x</Panel.HeaderActions>
        </Panel.Header>
      </Panel>,
    );
    expect(document.querySelector('[data-ui-marker="title"]')?.classList.contains('custom-title')).toBe(true);
    expect(document.querySelector('[data-ui-marker="actions"]')?.classList.contains('custom-actions')).toBe(true);
  });
});
