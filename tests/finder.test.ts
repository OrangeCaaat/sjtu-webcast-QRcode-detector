import { describe, it, expect } from 'vitest';
import { findCandidates } from '../src/detection/finder';
function image(size: number, patterns: { x: number; y: number; unit: number }[]): ImageData {
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (const { x, y, unit } of patterns) for (let row = 0; row < 7; row++) for (let col = 0; col < 7; col++) {
    const dark = row === 0 || row === 6 || col === 0 || col === 6 || (row >= 2 && row <= 4 && col >= 2 && col <= 4);
    if (dark) for (let dy = 0; dy < unit; dy++) for (let dx = 0; dx < unit; dx++) {
      const i = ((y + row * unit + dy) * size + x + col * unit + dx) * 4; data[i] = data[i + 1] = data[i + 2] = 0;
    }
  }
  return { width: size, height: size, data } as ImageData;
}
describe('未解码定位符候选', () => {
  it('识别三个成直角的定位符', () => {
    expect(findCandidates(image(320, [{ x: 40, y: 40, unit: 4 }, { x: 208, y: 40, unit: 4 }, { x: 40, y: 208, unit: 4 }])).length).toBeGreaterThan(0);
  });
  it('空白、一个方形标记和三个共线标记不构成二维码', () => {
    expect(findCandidates(image(320, []))).toHaveLength(0);
    expect(findCandidates(image(320, [{ x: 40, y: 40, unit: 4 }]))).toHaveLength(0);
    expect(findCandidates(image(320, [{ x: 30, y: 80, unit: 3 }, { x: 120, y: 80, unit: 3 }, { x: 210, y: 80, unit: 3 }]))).toHaveLength(0);
  });
});
