import type { Rect } from '../shared/types';
import { overlap } from './episode';
interface Point { x: number; y: number; module: number; count: number }
function ratio(runs: number[]): boolean {
  const sum = runs.reduce((a, b) => a + b, 0);
  if (sum < 7) return false;
  const unit = sum / 7;
  return runs.every((n, i) => Math.abs(n - unit * (i === 2 ? 3 : 1)) < unit * (i === 2 ? 1.5 : .8));
}
// Locate the three 1:1:3:1:1 finder patterns, cross-checking vertical structure.
// This only produces a candidate; temporal confirmation is required before an alarm.
export function findCandidates(image: ImageData): Rect[] {
  const { width, height, data } = image;
  const gray = new Uint8Array(width * height);
  const sums = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      const i = y * width + x, j = i * 4;
      gray[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
      row += gray[i]; sums[(y + 1) * (width + 1) + x + 1] = sums[y * (width + 1) + x + 1] + row;
    }
  }
  const black = new Uint8Array(width * height);
  const radius = Math.max(12, Math.min(48, Math.round(width / 40)));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const x0 = Math.max(0, x - radius), x1 = Math.min(width, x + radius + 1);
    const y0 = Math.max(0, y - radius), y1 = Math.min(height, y + radius + 1), stride = width + 1;
    const sum = sums[y1 * stride + x1] - sums[y0 * stride + x1] - sums[y1 * stride + x0] + sums[y0 * stride + x0];
    const mean = sum / ((x1 - x0) * (y1 - y0));
    black[y * width + x] = gray[y * width + x] < mean - 9 ? 1 : 0;
  }
  const points: Point[] = [];
  const step = Math.max(1, Math.floor(height / 650));
  function vertical(cx: number, cy: number, expected: number): { y: number; module: number } | null {
    const counts = [0, 0, 0, 0, 0];
    let y = cy;
    while (y >= 0 && black[y * width + cx] && counts[2] <= expected * 5) { counts[2]++; y--; }
    while (y >= 0 && !black[y * width + cx] && counts[1] <= expected * 2) { counts[1]++; y--; }
    while (y >= 0 && black[y * width + cx] && counts[0] <= expected * 2) { counts[0]++; y--; }
    y = cy + 1;
    while (y < height && black[y * width + cx] && counts[2] <= expected * 5) { counts[2]++; y++; }
    while (y < height && !black[y * width + cx] && counts[3] <= expected * 2) { counts[3]++; y++; }
    while (y < height && black[y * width + cx] && counts[4] <= expected * 2) { counts[4]++; y++; }
    if (!ratio(counts)) return null;
    return { y: y - counts[4] - counts[3] - counts[2] / 2, module: counts.reduce((a, b) => a + b, 0) / 7 };
  }
  for (let y = 0; y < height; y += step) {
    const lengths: number[] = [], colors: number[] = [], ends: number[] = [];
    let color = black[y * width], length = 0;
    for (let x = 0; x <= width; x++) {
      const next = x === width ? 2 : black[y * width + x];
      if (next === color) { length++; continue; }
      lengths.push(length); colors.push(color); ends.push(x);
      if (lengths.length >= 5) {
        const start = lengths.length - 5, runs = lengths.slice(start);
        if (colors[start] === 1 && ratio(runs)) {
          const cx = Math.round(x - runs[4] - runs[3] - runs[2] / 2);
          const unit = runs.reduce((a, b) => a + b, 0) / 7;
          const v = vertical(cx, y, unit);
          if (v && Math.abs(v.module - unit) < unit * .6) {
            const existing = points.find(p => Math.hypot(p.x - cx, p.y - v.y) < Math.max(p.module, unit) * 3);
            if (existing) {
              const n = existing.count + 1;
              existing.x = (existing.x * existing.count + cx) / n;
              existing.y = (existing.y * existing.count + v.y) / n;
              existing.module = (existing.module * existing.count + unit) / n; existing.count = n;
            } else if (points.length < 160) points.push({ x: cx, y: v.y, module: unit, count: 1 });
          }
        }
      }
      color = next; length = 1;
    }
  }
  const strong = points.filter(p => p.count >= 2).sort((a, b) => b.count - a.count).slice(0, 45);
  const candidates: Rect[] = [];
  for (let i = 0; i < strong.length; i++) for (let j = i + 1; j < strong.length; j++) for (let k = j + 1; k < strong.length; k++) {
    const triple = [strong[i], strong[j], strong[k]];
    const sizes = triple.map(p => p.module);
    if (Math.max(...sizes) / Math.min(...sizes) > 1.6) continue;
    for (let corner = 0; corner < 3; corner++) {
      const a = triple[corner], b = triple[(corner + 1) % 3], c = triple[(corner + 2) % 3];
      const bx = b.x - a.x, by = b.y - a.y, cx = c.x - a.x, cy = c.y - a.y;
      const ab = Math.hypot(bx, by), ac = Math.hypot(cx, cy), module = sizes.reduce((x, y) => x + y, 0) / 3;
      if (Math.min(ab, ac) < module * 12 || Math.min(ab, ac) / Math.max(ab, ac) < .7) continue;
      if (Math.abs(bx * cx + by * cy) / (ab * ac) > .25) continue;
      const fourth = { x: b.x + c.x - a.x, y: b.y + c.y - a.y };
      const pad = module * 5;
      const left = Math.max(0, Math.min(...triple.map(p => p.x), fourth.x) - pad);
      const top = Math.max(0, Math.min(...triple.map(p => p.y), fourth.y) - pad);
      const right = Math.min(width, Math.max(...triple.map(p => p.x), fourth.x) + pad);
      const bottom = Math.min(height, Math.max(...triple.map(p => p.y), fourth.y) + pad);
      const rect = { x: left, y: top, width: right - left, height: bottom - top };
      if (rect.width > 0 && rect.height > 0 && !candidates.some(r => overlap(r, rect) > .4)) candidates.push(rect);
      break;
    }
  }
  return candidates.slice(0, 12);
}
