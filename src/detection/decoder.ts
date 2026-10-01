import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import type { Detection, Rect } from '../shared/types';
import { findCandidates } from './finder';
import { overlap } from './episode';

export function configureDecoder(wasmUrl: string): void {
  prepareZXingModule({ overrides: { locateFile: (path: string) => path.endsWith('.wasm') ? wasmUrl : path } });
}
function crop(image: ImageData, rect: Rect, scale = 1): ImageData {
  const x = Math.max(0, Math.floor(rect.x)), y = Math.max(0, Math.floor(rect.y));
  const w = Math.min(image.width - x, Math.ceil(rect.width)), h = Math.min(image.height - y, Math.ceil(rect.height));
  const pixels = new Uint8ClampedArray(w * h * 4 * scale * scale);
  for (let row = 0; row < h * scale; row++) for (let col = 0; col < w * scale; col++) {
    const origin = ((y + Math.floor(row / scale)) * image.width + x + Math.floor(col / scale)) * 4;
    pixels.set(image.data.subarray(origin, origin + 4), (row * w * scale + col) * 4);
  }
  return new ImageData(pixels, w * scale, h * scale);
}
export async function detectCodes(image: ImageData): Promise<Detection[]> {
  const results: Detection[] = [];
  const options = { formats: ['QRCode' as const], tryHarder: true, maxNumberOfSymbols: 12 };
  async function read(frame: ImageData, origin: Rect, scale = 1): Promise<void> {
    for (const result of await readBarcodes(frame, options)) {
      if (!result.isValid || !result.text) continue;
      const points = Object.values(result.position) as { x: number; y: number }[];
      const xs = points.map(p => p.x / scale + origin.x), ys = points.map(p => p.y / scale + origin.y);
      const rect = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
      if (!results.some(r => overlap(r.rect, rect) > .35)) results.push({ rect, text: result.text, decoded: true });
    }
  }
  await read(image, { x: 0, y: 0, width: image.width, height: image.height });
  const candidates = findCandidates(image);
  for (const rect of candidates) {
    if (!results.some(r => overlap(r.rect, rect) > .25)) {
      await read(crop(image, rect, 2), rect, 2);
      if (!results.some(r => overlap(r.rect, rect) > .25)) results.push({ rect, decoded: false });
    }
  }
  // Overlapping tiles retain source resolution for small codes in screen-sharing layouts.
  if (image.width >= 900) {
    const w = Math.ceil(image.width * .6), h = Math.ceil(image.height * .65);
    for (const x of [0, image.width - w]) for (const y of [0, image.height - h]) {
      const rect = { x, y, width: w, height: h };
      await read(crop(image, rect), rect);
    }
  }
  const decoded = results.filter(r => r.decoded);
  return [...decoded, ...results.filter(r => !r.decoded && !decoded.some(d => overlap(d.rect, r.rect) > .2))].map(d => ({ ...d,
    rect: { x: d.rect.x / image.width, y: d.rect.y / image.height, width: d.rect.width / image.width, height: d.rect.height / image.height } }));
}
