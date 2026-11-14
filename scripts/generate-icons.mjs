import { readFile, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';

const directory = new URL('../assets/icons/', import.meta.url);
const source = PNG.sync.read(await readFile(new URL('pixelsync-master.png', directory)));
if (source.width !== source.height) throw new Error('The icon master must be square');
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const images = [];
for (const size of sizes) {
  const target = new PNG({ width: size, height: size });
  const scale = source.width / size;
  // Area averaging in premultiplied alpha avoids dark fringes on transparent edges.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const left = x * scale, right = (x + 1) * scale;
      const top = y * scale, bottom = (y + 1) * scale;
      const color = [0, 0, 0];
      let alpha = 0;
      for (let sy = Math.floor(top); sy < Math.ceil(bottom); sy++) {
        for (let sx = Math.floor(left); sx < Math.ceil(right); sx++) {
          const weight = (Math.min(right, sx + 1) - Math.max(left, sx)) * (Math.min(bottom, sy + 1) - Math.max(top, sy));
          const offset = (sy * source.width + sx) * 4;
          const coverage = source.data[offset + 3] * weight;
          alpha += coverage;
          for (let channel = 0; channel < 3; channel++) color[channel] += source.data[offset + channel] * coverage;
        }
      }
      const offset = (y * size + x) * 4;
      for (let channel = 0; channel < 3; channel++) target.data[offset + channel] = alpha ? Math.round(color[channel] / alpha) : 0;
      target.data[offset + 3] = Math.round(alpha / (scale * scale));
    }
  }
  const data = PNG.sync.write(target);
  await writeFile(new URL(`pixelsync-${size}.png`, directory), data);
  if (size <= 256) images.push({ size, data });
}

// ICO directory entries point to PNG frames, supported by Windows Vista and newer.
const header = Buffer.alloc(6 + images.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
for (const [index, { size, data }] of images.entries()) {
  const entry = 6 + index * 16;
  header[entry] = header[entry + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(data.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += data.length;
}
await writeFile(new URL('pixelsync.ico', directory), Buffer.concat([header, ...images.map(image => image.data)]));
console.log(`Generated PNG icons (${sizes.join(', ')}px) and Windows ICO.`);
