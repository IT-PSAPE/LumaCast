// Regenerate the checked-in desktop icons from the unmodified Figma SVGs.
// Uses the suite's existing Sharp dependency; no platform-specific tools needed.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
const apps = ['cast', 'stream', 'flux'];
const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];
const macTypes = [
  ['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128],
  ['ic08', 256], ['ic09', 512], ['ic10', 1024],
  ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512],
];

function encodeIco(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(([size, png], index) => {
    const entry = 6 + index * 16;
    header[entry] = size === 256 ? 0 : size;
    header[entry + 1] = header[entry];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map(([, png]) => png)]);
}

function encodeIcns(images) {
  const chunks = macTypes.map(([type, size]) => {
    const png = images.get(size);
    const header = Buffer.alloc(8);
    header.write(type);
    header.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([header, png]);
  });
  const header = Buffer.alloc(8);
  header.write('icns');
  header.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
  return Buffer.concat([header, ...chunks]);
}

for (const app of apps) {
  const resources = path.join(root, 'apps', app, 'resources');
  // Figma's 32px frames are vector artwork: rasterize at the largest size
  // before downsampling, preserving the SVG's own geometry and colors.
  const master = await sharp(path.join(resources, 'icon.svg'), { density: 2304 }).png().toBuffer();
  // Legacy macOS ICNS icons need their own outer transparent canvas. Keep
  // the 824px artwork centered in 1024px for every app and every resolution.
  // Windows/Linux and browser favicons use the original Figma frame.
  const macMaster = await sharp(master).resize(824, 824).extend({
    top: 100, bottom: 100, left: 100, right: 100,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  }).png().toBuffer();
  const images = new Map();
  const macImages = new Map();
  for (const size of sizes) {
    images.set(size, await sharp(master).resize(size, size).png().toBuffer());
    macImages.set(size, await sharp(macMaster).resize(size, size).png().toBuffer());
  }
  await writeFile(path.join(resources, 'icon.png'), images.get(1024));
  await writeFile(path.join(resources, 'icon-mac.png'), macImages.get(1024));
  await writeFile(path.join(resources, 'icon.ico'), encodeIco([...images].filter(([size]) => size <= 256)));
  await writeFile(path.join(resources, 'icon.icns'), encodeIcns(macImages));
  const publicDir = path.join(root, 'apps', app, 'renderer', 'public');
  await mkdir(publicDir, { recursive: true });
  await writeFile(path.join(publicDir, 'favicon.png'), images.get(32));
  // Keep Cast's existing size-specific exports in sync.
  if (app === 'cast') {
    for (const [size, png] of images) {
      if (size !== 48) await writeFile(path.join(resources, 'app_icons', `recast_icon_${size}.png`), png);
    }
  }
  console.log(`Generated ${app} icons`);
}
