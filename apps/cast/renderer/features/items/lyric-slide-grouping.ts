import { measureInlineTextHeight } from '@lumacast/canvas';
import type { Block } from '../../components/form/doc-editor';
import { normalizeLyricText } from './lyric-text-utils';
import type { LyricLayoutConfig } from './lyric-layout-config';

const SEGMENT_JOIN = '\n';

type MeasureFn = typeof measureInlineTextHeight;
type NewIdFn = () => string;

const defaultNewId: NewIdFn = () => Math.random().toString(36).slice(2, 9);

export interface GroupBlocksOptions {
  config: LyricLayoutConfig;
  measure?: MeasureFn;
  newId?: NewIdFn;
}

export function joinSegments(segments: string[]): string {
  return segments.join(SEGMENT_JOIN);
}

interface Segment {
  id: string | null;
  content: string;
}

function fitsInBox(text: string, config: LyricLayoutConfig, measure: MeasureFn): boolean {
  const measured = measure({
    text,
    width: config.boxWidth,
    fontSize: config.fontSize,
    lineHeight: config.lineHeight,
    fontWeight: config.fontWeight,
    fontStyle: 'normal',
    fontFamily: config.fontFamily,
  });
  return measured <= config.boxHeight + 0.5;
}

function fitSingleSegment(segment: Segment, config: LyricLayoutConfig, measure: MeasureFn, newId: NewIdFn): Block[] {
  const id = segment.id ?? newId();
  if (fitsInBox(segment.content, config, measure)) return [{ id, content: segment.content }];
  if (!segment.content.includes(SEGMENT_JOIN)) return [{ id, content: segment.content }];
  const lines = segment.content.split(SEGMENT_JOIN);
  return groupSegments(
    lines.map((content, index) => ({ id: index === 0 ? segment.id : null, content })),
    config,
    measure,
    newId,
  );
}

function groupSegments(segments: Segment[], config: LyricLayoutConfig, measure: MeasureFn, newId: NewIdFn): Block[] {
  if (segments.length === 0) return [];
  if (segments.length === 1) return fitSingleSegment(segments[0], config, measure, newId);

  const joined = joinSegments(segments.map((segment) => segment.content));
  if (fitsInBox(joined, config, measure)) {
    return [{ id: segments[0].id ?? newId(), content: joined }];
  }

  const half = Math.ceil(segments.length / 2);
  const head = segments.map((segment, index) => (index === 0 ? segment : { id: null, content: segment.content })).slice(0, half);
  const tail = segments.slice(half).map((segment) => ({ id: null, content: segment.content }));
  return [...groupSegments(head, config, measure, newId), ...groupSegments(tail, config, measure, newId)];
}

export function groupBlocksForSlides(blocks: Block[], options: GroupBlocksOptions): Block[] {
  const { config, measure = measureInlineTextHeight, newId = defaultNewId } = options;
  const target = Math.max(1, Math.floor(config.segmentsPerSlide));
  const result: Block[] = [];
  let pending: Segment[] = [];

  const flush = () => {
    if (pending.length === 0) return;
    result.push(...groupSegments(pending, config, measure, newId));
    pending = [];
  };

  for (const block of blocks) {
    const content = normalizeLyricText(block.content);
    if (content.length === 0) {
      flush();
      result.push({ id: block.id, content: '' });
      continue;
    }
    pending.push({ id: block.id, content });
    if (pending.length === target) flush();
  }
  flush();

  return result;
}
