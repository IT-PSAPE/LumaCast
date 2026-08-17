import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Label, TextBlock, Title } from './text';

// Covers #218: TextBlock destructured only { children, className } and
// silently dropped every other prop before rendering its <span>, so a
// caller-supplied data-* attribute (e.g. data-ui-region) never reached the
// DOM. Each case renders an export with a forwarded data-* attribute (used
// as the lookup key, since it must itself survive) plus className, and
// asserts both land on the actual rendered element. Title and Label already
// spread their props; these are control cases. Paragraph is a deliberate
// fixed contract ({ children, className } only) and is not covered here.

describe('text primitives', () => {
  it('TextBlock forwards a data-* attribute and className to the rendered <span>', () => {
    render(
      <TextBlock data-ui-region="text-block" className="custom-block">
        content
      </TextBlock>,
    );
    const node = document.querySelector('[data-ui-region="text-block"]');
    expect(node).not.toBeNull();
    expect(node?.tagName).toBe('SPAN');
    expect(node?.classList.contains('custom-block')).toBe(true);
  });

  describe('Title', () => {
    it('Title.h1 forwards a data-* attribute and className to the rendered <h1>', () => {
      render(
        <Title.h1 data-ui-marker="title-h1" className="custom-title-h1">
          content
        </Title.h1>,
      );
      const node = document.querySelector('[data-ui-marker="title-h1"]');
      expect(node).not.toBeNull();
      expect(node?.tagName).toBe('H1');
      expect(node?.classList.contains('custom-title-h1')).toBe(true);
    });

    it('Title.h2 forwards a data-* attribute and className to the rendered <h2>', () => {
      render(
        <Title.h2 data-ui-marker="title-h2" className="custom-title-h2">
          content
        </Title.h2>,
      );
      const node = document.querySelector('[data-ui-marker="title-h2"]');
      expect(node).not.toBeNull();
      expect(node?.tagName).toBe('H2');
      expect(node?.classList.contains('custom-title-h2')).toBe(true);
    });

    it('Title.h3 forwards a data-* attribute and className to the rendered <h3>', () => {
      render(
        <Title.h3 data-ui-marker="title-h3" className="custom-title-h3">
          content
        </Title.h3>,
      );
      const node = document.querySelector('[data-ui-marker="title-h3"]');
      expect(node).not.toBeNull();
      expect(node?.tagName).toBe('H3');
      expect(node?.classList.contains('custom-title-h3')).toBe(true);
    });

    it('Title.h4 forwards a data-* attribute and className to the rendered <h4>', () => {
      render(
        <Title.h4 data-ui-marker="title-h4" className="custom-title-h4">
          content
        </Title.h4>,
      );
      const node = document.querySelector('[data-ui-marker="title-h4"]');
      expect(node).not.toBeNull();
      expect(node?.tagName).toBe('H4');
      expect(node?.classList.contains('custom-title-h4')).toBe(true);
    });

    it('Title.h5 forwards a data-* attribute and className to the rendered <h5>', () => {
      render(
        <Title.h5 data-ui-marker="title-h5" className="custom-title-h5">
          content
        </Title.h5>,
      );
      const node = document.querySelector('[data-ui-marker="title-h5"]');
      expect(node).not.toBeNull();
      expect(node?.tagName).toBe('H5');
      expect(node?.classList.contains('custom-title-h5')).toBe(true);
    });

    it('Title.h6 forwards a data-* attribute and className to the rendered <h6>', () => {
      render(
        <Title.h6 data-ui-marker="title-h6" className="custom-title-h6">
          content
        </Title.h6>,
      );
      const node = document.querySelector('[data-ui-marker="title-h6"]');
      expect(node).not.toBeNull();
      expect(node?.tagName).toBe('H6');
      expect(node?.classList.contains('custom-title-h6')).toBe(true);
    });
  });

  describe('Label', () => {
    it('Label.lg forwards a data-* attribute and className to the rendered <span>', () => {
      render(
        <Label.lg data-ui-marker="label-lg" className="custom-label-lg">
          content
        </Label.lg>,
      );
      const node = document.querySelector('[data-ui-marker="label-lg"]');
      expect(node).not.toBeNull();
      expect(node?.tagName).toBe('SPAN');
      expect(node?.classList.contains('custom-label-lg')).toBe(true);
    });

    it('Label.bg forwards a data-* attribute and className to the rendered <span>', () => {
      render(
        <Label.bg data-ui-marker="label-bg" className="custom-label-bg">
          content
        </Label.bg>,
      );
      const node = document.querySelector('[data-ui-marker="label-bg"]');
      expect(node).not.toBeNull();
      expect(node?.tagName).toBe('SPAN');
      expect(node?.classList.contains('custom-label-bg')).toBe(true);
    });

    it('Label.md forwards a data-* attribute and className to the rendered <span>', () => {
      render(
        <Label.md data-ui-marker="label-md" className="custom-label-md">
          content
        </Label.md>,
      );
      const node = document.querySelector('[data-ui-marker="label-md"]');
      expect(node).not.toBeNull();
      expect(node?.tagName).toBe('SPAN');
      expect(node?.classList.contains('custom-label-md')).toBe(true);
    });

    it('Label.sm forwards a data-* attribute and className to the rendered <span>', () => {
      render(
        <Label.sm data-ui-marker="label-sm" className="custom-label-sm">
          content
        </Label.sm>,
      );
      const node = document.querySelector('[data-ui-marker="label-sm"]');
      expect(node).not.toBeNull();
      expect(node?.tagName).toBe('SPAN');
      expect(node?.classList.contains('custom-label-sm')).toBe(true);
    });

    it('Label.xs forwards a data-* attribute and className to the rendered <span>', () => {
      render(
        <Label.xs data-ui-marker="label-xs" className="custom-label-xs">
          content
        </Label.xs>,
      );
      const node = document.querySelector('[data-ui-marker="label-xs"]');
      expect(node).not.toBeNull();
      expect(node?.tagName).toBe('SPAN');
      expect(node?.classList.contains('custom-label-xs')).toBe(true);
    });
  });
});