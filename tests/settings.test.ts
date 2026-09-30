import { describe, it, expect } from 'vitest';
import { validateSettings, safeUrl } from '../src/shared/settings';
import { DEFAULT_SETTINGS, INTERVALS } from '../src/shared/types';
describe('设置校验', () => {
  it('四档检测间隔及默认值', () => {
    expect(DEFAULT_SETTINGS.detectionIntervalMs).toBe(500);
    for (const interval of INTERVALS) expect(validateSettings({ ...DEFAULT_SETTINGS, detectionIntervalMs: interval }).detectionIntervalMs).toBe(interval);
    expect(() => validateSettings({ ...DEFAULT_SETTINGS, detectionIntervalMs: 750 })).toThrow();
  });
  it('布防输入拒绝越界、小数与非数值', () => {
    for (const value of [0, 301, 1.5, NaN, Infinity]) expect(() => validateSettings({ ...DEFAULT_SETTINGS, rearmSeconds: value })).toThrow();
    for (const value of [1, 10, 300]) expect(validateSettings({ ...DEFAULT_SETTINGS, rearmSeconds: value }).rearmSeconds).toBe(value);
  });
  it('音量边界', () => {
    for (const value of [0, 100]) expect(validateSettings({ ...DEFAULT_SETTINGS, volume: value }).volume).toBe(value);
    for (const value of [-1, 101, NaN]) expect(() => validateSettings({ ...DEFAULT_SETTINGS, volume: value })).toThrow();
  });
  it('URL保留参数并拒绝非HTTP协议', () => {
    expect(safeUrl('https://example.com/a?token=abc%2Fdef&course=2')).toBe('https://example.com/a?token=abc%2Fdef&course=2');
    expect(safeUrl('weixin://x')).toBeNull(); expect(safeUrl('https://user:secret@example.com')).toBeNull();
  });
});
