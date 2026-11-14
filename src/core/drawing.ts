export type RGBA = [number, number, number, number];
export function rgba(color: string): RGBA {
  return [1, 3, 5, 7].map(offset => Number.parseInt(color.slice(offset, offset + 2), 16)) as RGBA;
}
export function paint(pixels: Uint8Array, width: number, height: number, x: number, y: number, color: RGBA) {
  if (x >= 0 && y >= 0 && x < width && y < height) pixels.set(color, (y * width + x) * 4);
}
// Inclusive integer Bresenham; rasterize first, clip individual pixels second.
export function line(x1: number, y1: number, x2: number, y2: number, put: (x: number, y: number) => void) {
  const dx = Math.abs(x2 - x1), sx = x1 < x2 ? 1 : -1;
  const dy = -Math.abs(y2 - y1), sy = y1 < y2 ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    put(x1, y1);
    if (x1 === x2 && y1 === y2) break;
    const twice = 2 * error;
    if (twice >= dy) { error += dy; x1 += sx; }
    if (twice <= dx) { error += dx; y1 += sy; }
  }
}
export function flood(pixels: Uint8Array, width: number, height: number, x: number, y: number, color: RGBA) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const first = y * width + x;
  const old = pixels.slice(first * 4, first * 4 + 4);
  const matches = (index: number) => old.every((value, channel) => pixels[index * 4 + channel] === value);
  if (old.every((value, channel) => value === color[channel])) return;
  const stack = new Uint32Array(width * height);
  let count = 0;
  const visit = (index: number) => { if (matches(index)) { pixels.set(color, index * 4); stack[count++] = index; } };
  visit(first);
  while (count) {
    const index = stack[--count], px = index % width;
    if (px > 0) visit(index - 1);
    if (px + 1 < width) visit(index + 1);
    if (index >= width) visit(index - width);
    if (index + width < width * height) visit(index + width);
  }
}
// Layers arrive bottom to top. Keep floating premultiplied intermediates and
// round once at the output boundary to avoid cumulative byte-rounding drift.
export function composite(width: number, height: number, layers: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < output.length; offset += 4) {
    let r = 0, g = 0, b = 0, a = 0;
    for (const layer of layers) {
      const alpha = layer[offset + 3] / 255, keep = 1 - alpha;
      r = layer[offset] * alpha + r * keep;
      g = layer[offset + 1] * alpha + g * keep;
      b = layer[offset + 2] * alpha + b * keep;
      a = alpha + a * keep;
    }
    if (a > 0) output.set([Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round(a * 255)], offset);
  }
  return output;
}
