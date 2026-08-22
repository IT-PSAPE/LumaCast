import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useEffect } from 'react';
import { Thumbnail } from './thumbnail';

afterEach(cleanup);

// `className.toContain('border-secondary')` also matches
// `hover:border-secondary`, so state assertions compare exact class tokens.
function classes(element: Element): string[] {
  return element.className.split(/\s+/).filter(Boolean);
}

describe('Thumbnail default appearance (deck bin, theme bin, theme editor, …)', () => {
  it('keeps the unselected quiet-border treatment and adds no ring', () => {
    const { getByTestId } = render(
      <Thumbnail.Tile data-testid="tile">
        <Thumbnail.Body>body</Thumbnail.Body>
        <Thumbnail.Caption>caption</Thumbnail.Caption>
      </Thumbnail.Tile>,
    );
    const tile = getByTestId('tile');
    expect(classes(tile)).toContain('border-primary');
    expect(classes(tile)).toContain('hover:border-secondary');
    expect(classes(tile)).not.toContain('border-secondary');
    expect(tile.className).not.toContain('ring-');
  });

  it('keeps the selected tinted fill and brand border', () => {
    const { getByTestId } = render(
      <Thumbnail.Tile data-testid="tile" selected>
        <Thumbnail.Body>body</Thumbnail.Body>
        <Thumbnail.Caption>caption</Thumbnail.Caption>
      </Thumbnail.Tile>,
    );
    const tile = getByTestId('tile');
    expect(tile.className).toContain('border-brand-400/70');
    expect(tile.className).toContain('bg-brand-400/15');
    expect(tile.className).not.toContain('ring-');
  });

  it('keeps the caption as a filled strip', () => {
    const { getByText } = render(
      <Thumbnail.Tile>
        <Thumbnail.Body>body</Thumbnail.Body>
        <Thumbnail.Caption>caption</Thumbnail.Caption>
      </Thumbnail.Tile>,
    );
    const caption = getByText('caption');
    expect(caption.className).toContain('bg-tertiary');
    expect(caption.className).toContain('border-primary');
    expect(caption.className).toContain('py-1');
  });

  it('accepts an explicit aspect ratio instead of forcing aspect-video', () => {
    const { getByText } = render(
      <Thumbnail.Tile aspectRatio={4 / 3}>
        <Thumbnail.Body>body</Thumbnail.Body>
      </Thumbnail.Tile>,
    );

    const body = getByText('body');
    expect(body.className).not.toContain('aspect-video');
    expect(body.className).toContain('[aspect-ratio:var(--thumbnail-aspect-ratio)]');
  });
});

describe('Thumbnail slide variant (opt-in, only slide components)', () => {
  it('renders a lower-contrast border and a subtle hover ring when unselected', () => {
    const { getByTestId } = render(
      <Thumbnail.Tile data-testid="tile" variant="slide">
        <Thumbnail.Body>body</Thumbnail.Body>
        <Thumbnail.Caption>caption</Thumbnail.Caption>
      </Thumbnail.Tile>,
    );
    const tile = getByTestId('tile');
    expect(classes(tile)).toContain('border-secondary');
    expect(classes(tile)).toContain('ring-1');
    expect(classes(tile)).toContain('hover:ring-border-secondary');
    expect(classes(tile)).not.toContain('border-primary');
  });

  it('selects with a brand ring instead of a tinted fill', () => {
    const { getByTestId } = render(
      <Thumbnail.Tile data-testid="tile" variant="slide" selected>
        <Thumbnail.Body>body</Thumbnail.Body>
        <Thumbnail.Caption>caption</Thumbnail.Caption>
      </Thumbnail.Tile>,
    );
    const tile = getByTestId('tile');
    expect(tile.className).toContain('ring-brand-400');
    expect(tile.className).toContain('border-transparent');
    expect(tile.className).toContain('bg-primary');
    expect(tile.className).not.toContain('bg-brand-400/15');
    expect(tile.className).not.toContain('border-brand-400/70');
  });

  it('applies the quiet caption override through the Caption className', () => {
    const { getByText } = render(
      <Thumbnail.Tile variant="slide">
        <Thumbnail.Body>body</Thumbnail.Body>
        <Thumbnail.Caption className="border-secondary bg-transparent py-0.5">caption</Thumbnail.Caption>
      </Thumbnail.Tile>,
    );
    const caption = getByText('caption');
    expect(caption.className).toContain('border-secondary');
    expect(caption.className).toContain('bg-transparent');
    expect(caption.className).toContain('py-0.5');
    expect(caption.className).not.toContain('bg-tertiary');
    expect(caption.className).not.toContain('py-1');
  });

  it('applies ring selection and quiet border to Row', () => {
    const { getByTestId } = render(
      <Thumbnail.Row data-testid="row" variant="slide" selected>
        <Thumbnail.Preview>preview</Thumbnail.Preview>
        <Thumbnail.Body>body</Thumbnail.Body>
      </Thumbnail.Row>,
    );
    const row = getByTestId('row');
    expect(row.className).toContain('ring-brand-400');
    expect(row.className).toContain('border-transparent');
    expect(row.className).not.toContain('bg-brand-400/15');
  });
});

describe('Thumbnail overlays', () => {
  it('keeps overlay identity stable when overlays reorder between the same positions', () => {
    const mounts: string[] = [];

    function Marker({ id }: { id: string }) {
      useEffect(() => {
        mounts.push(id);
      }, [id]);

      return <span>{id}</span>;
    }

    const { rerender } = render(
      <Thumbnail.Tile>
        <Thumbnail.Body>body</Thumbnail.Body>
        <Thumbnail.Overlay position="top-right" className="status">
          <Marker id="first" />
        </Thumbnail.Overlay>
        <Thumbnail.Overlay position="top-right" className="actions">
          <Marker id="second" />
        </Thumbnail.Overlay>
      </Thumbnail.Tile>,
    );

    expect(mounts).toEqual(['first', 'second']);

    rerender(
      <Thumbnail.Tile>
        <Thumbnail.Body>body</Thumbnail.Body>
        <Thumbnail.Overlay position="top-right" className="actions">
          <Marker id="second" />
        </Thumbnail.Overlay>
        <Thumbnail.Overlay position="top-right" className="status">
          <Marker id="first" />
        </Thumbnail.Overlay>
      </Thumbnail.Tile>,
    );

    expect(mounts).toEqual(['first', 'second']);
  });
});
