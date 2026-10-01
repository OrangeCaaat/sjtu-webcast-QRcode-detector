import { describe, it, expect, vi } from 'vitest';
import { validateSettings, safeUrl, loadSettings } from '../src/shared/settings';
import { DEFAULT_SETTINGS, INTERVALS } from '../src/shared/types';
describe('设置校验', () => {
  it('刷新开页默认关闭，父开关关闭时强制关闭子开关', () => {
    expect(DEFAULT_SETTINGS.autoOpenOnRefresh).toBe(false);
    expect(validateSettings({ ...DEFAULT_SETTINGS, autoOpenOnRefresh: true }).autoOpenOnRefresh).toBe(false);
    expect(validateSettings({ ...DEFAULT_SETTINGS, autoOpen: true, autoOpenOnRefresh: true }).autoOpenOnRefresh).toBe(true);
    expect(() => validateSettings({ ...DEFAULT_SETTINGS, autoOpenOnRefresh: 'true' as unknown as boolean })).toThrow();
  });
  it('旧版设置保留音量等偏好，并补入关闭的新开关', async () => {
    const { autoOpenOnRefresh: _, ...old } = { ...DEFAULT_SETTINGS, autoOpen: true, volume: 100, rearmSeconds: 1 };
    vi.stubGlobal('chrome', { storage: { local: { get: async () => ({ settings: old }) } } });
    try { expect(await loadSettings()).toEqual({ ...old, autoOpenOnRefresh: false }); }
    finally { vi.unstubAllGlobals(); }
  });
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
