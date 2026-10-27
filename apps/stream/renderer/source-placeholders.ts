const COLOR_BARS = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
const COLOR_BAR_FOOTER = ['#0000c0', '#000000', '#c000c0', '#000000', '#00c0c0', '#000000', '#c0c0c0'];

/** Draws a static SMPTE-style no-signal test pattern inside the source bounds. */
export function drawCameraColorBars(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const upperHeight = height * 0.67;
  const lowerHeight = height - upperHeight;
  COLOR_BARS.forEach((color, index) => {
    const left = x + width * index / COLOR_BARS.length;
    const right = x + width * (index + 1) / COLOR_BARS.length;
    context.fillStyle = color;
    context.fillRect(left, y, right - left, upperHeight);
    context.fillStyle = COLOR_BAR_FOOTER[index]!;
    context.fillRect(left, y + upperHeight, right - left, lowerHeight);
  });

  context.save();
  context.fillStyle = 'rgba(0, 0, 0, 0.72)';
  const labelHeight = Math.min(lowerHeight, Math.max(18, height * 0.18));
  context.fillRect(x, y + height - labelHeight, width, labelHeight);
  context.fillStyle = '#ffffff';
  context.font = `600 ${Math.max(10, Math.min(18, height * 0.08))}px sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('NO SIGNAL', x + width / 2, y + height - labelHeight / 2, Math.max(1, width - 12));
  context.restore();
}

/** Draws a static broken-image tile for an unavailable image or media asset. */
export function drawUnavailablePlaceholder(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
): void {
  context.save();
  context.fillStyle = '#20232b';
  context.fillRect(x, y, width, height);

  const iconSize = Math.max(12, Math.min(width, height) * 0.24);
  const iconX = x + (width - iconSize) / 2;
  const iconY = y + height * 0.24;
  context.strokeStyle = '#9ca3af';
  context.lineWidth = Math.max(1, Math.min(width, height) * 0.012);
  context.strokeRect(iconX, iconY, iconSize, iconSize * 0.72);
  context.beginPath();
  context.moveTo(iconX + iconSize * 0.1, iconY + iconSize * 0.6);
  context.lineTo(iconX + iconSize * 0.38, iconY + iconSize * 0.34);
  context.lineTo(iconX + iconSize * 0.54, iconY + iconSize * 0.49);
  context.lineTo(iconX + iconSize * 0.68, iconY + iconSize * 0.36);
  context.lineTo(iconX + iconSize * 0.9, iconY + iconSize * 0.6);
  context.stroke();
  context.beginPath();
  context.arc(iconX + iconSize * 0.72, iconY + iconSize * 0.2, iconSize * 0.055, 0, Math.PI * 2);
  context.fillStyle = '#9ca3af';
  context.fill();

  context.fillStyle = '#e5e7eb';
  context.font = `500 ${Math.max(10, Math.min(16, height * 0.075))}px sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, x + width / 2, y + height * 0.82, Math.max(1, width - 12));
  context.restore();
}
