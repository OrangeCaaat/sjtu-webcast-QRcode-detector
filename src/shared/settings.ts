import { DEFAULT_SETTINGS, INTERVALS, type Settings } from './types';

export function validateSettings(value: Settings): Settings {
  if (!(INTERVALS as readonly number[]).includes(value.detectionIntervalMs)) throw new Error('请选择有效的检测间隔。');
  if (!Number.isInteger(value.rearmSeconds) || value.rearmSeconds < 1 || value.rearmSeconds > 300) throw new Error('冷却时间必须是 1–300 秒的整数。');
  if (!Number.isFinite(value.volume) || value.volume < 0 || value.volume > 100) throw new Error('音量必须在 0–100% 之间。');
  if (typeof value.autoOpen !== 'boolean') throw new Error('自动打开设置无效。');
  if (value.customSoundName !== null && typeof value.customSoundName !== 'string') throw new Error('铃声设置无效。');
  return { ...value };
}
export async function loadSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get('settings');
  const saved = settings && typeof settings === 'object' ? settings as Partial<Settings> : {};
  try { return validateSettings({ ...DEFAULT_SETTINGS, ...saved }); } catch { return { ...DEFAULT_SETTINGS }; }
}
export function safeUrl(text?: string): string | null {
  if (!text) return null;
  try {
    const url = new URL(text);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
