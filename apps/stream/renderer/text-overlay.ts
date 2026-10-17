import type { StreamSource } from '../shared/desktop-api';

const wrappedLineCache = new WeakMap<CanvasRenderingContext2D, Map<string, string[]>>();

function wrapParagraph(text: string, maxWidth: number, measure: (text: string) => number): string[] {
  if (text.length === 0) return [''];
  const lines: string[] = [];
  let line = '';
  const appendCharacters = (value: string) => {
    for (const character of value) {
      const candidate = line + character;
      if (line && measure(candidate) > maxWidth) {
        lines.push(line);
        line = character;
      } else line = candidate;
    }
  };
  let pendingWhitespace = '';
  for (const token of text.split(/(\s+)/).filter(Boolean)) {
    if (/^\s+$/.test(token)) {
      if (line) pendingWhitespace += token;
      continue;
    }
    if (line && measure(line + pendingWhitespace + token) > maxWidth) {
      lines.push(line);
      line = '';
      pendingWhitespace = '';
    }
    appendCharacters(pendingWhitespace);
    pendingWhitespace = '';
    appendCharacters(token);
  }
  if (line || lines.length === 0) lines.push(line);
  return lines;
}

export function wrapTextToWidth(text: string, maxWidth: number, measure: (text: string) => number): string[] {
  return text.split(/\r?\n/).flatMap((paragraph) => wrapParagraph(paragraph, Math.max(1, maxWidth), measure));
}

function wrappedLines(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  let cache = wrappedLineCache.get(context);
  if (!cache) {
    cache = new Map();
    wrappedLineCache.set(context, cache);
  }
  const key = `${context.font}\u0000${width}\u0000${text}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const lines = wrapTextToWidth(text, width, (line) => context.measureText(line).width);
  if (cache.size >= 256) cache.delete(cache.keys().next().value!);
  cache.set(key, lines);
  return lines;
}

export function drawTextSource(context: CanvasRenderingContext2D, source: StreamSource): void {
  const style = source.textStyle;
  if (source.kind !== 'text' || !style) return;
  const { x, y, width, height } = source.transform;
  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  if (style.background.opacity > 0) {
    context.save();
    context.globalAlpha *= style.background.opacity;
    context.fillStyle = style.background.color;
    context.fillRect(x, y, width, height);
    context.restore();
  }

  const family = style.fontFamily.replace(/["\\]/g, '\\$&');
  context.font = `${style.italic ? 'italic ' : ''}${style.bold ? '700 ' : '400 '}${style.fontSize}px "${family}", sans-serif`;
  context.textAlign = style.horizontalAlignment;
  context.textBaseline = 'top';
  const lines = wrappedLines(context, source.text ?? 'Text', width);
  const lineHeight = style.fontSize * 1.2;
  const textHeight = lines.length * lineHeight;
  const textY = style.verticalAlignment === 'center'
    ? y + (height - textHeight) / 2
    : style.verticalAlignment === 'bottom' ? y + height - textHeight : y;
  const textX = style.horizontalAlignment === 'center' ? x + width / 2
    : style.horizontalAlignment === 'right' ? x + width : x;
  context.lineJoin = 'round';
  if (style.shadow.enabled) {
    context.shadowColor = style.shadow.color;
    context.shadowBlur = style.shadow.blur;
    context.shadowOffsetX = style.shadow.offsetX;
    context.shadowOffsetY = style.shadow.offsetY;
  }
  lines.forEach((line, index) => {
    const lineY = textY + index * lineHeight;
    if (style.outline.enabled && style.outline.width > 0) {
      context.strokeStyle = style.outline.color;
      context.lineWidth = style.outline.width;
      context.strokeText(line, textX, lineY);
    }
    context.fillStyle = source.color ?? '#ffffff';
    context.fillText(line, textX, lineY);
  });
  context.restore();
}
