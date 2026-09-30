import type { Envelope, Reply, Settings, State } from './types';
export async function request<T = unknown>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!globalThis.chrome?.runtime?.sendMessage) throw new Error('请从浏览器扩展中打开此界面。');
  const reply = await chrome.runtime.sendMessage({ target: 'background', type, ...payload } satisfies Envelope) as Reply<T>;
  if (!reply?.ok) throw new Error(reply?.error ?? '插件未响应，请在扩展管理页重载后刷新直播网页。');
  return reply.data as T;
}
export function element<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
export function showError(error: unknown): void {
  const box = element('error'); box.hidden = false;
  box.textContent = error instanceof Error ? error.message : '操作失败，请重试。';
}
export function clearError(): void { element('error').hidden = true; }
export async function snapshot(): Promise<{ settings: Settings; state: State }> { return request('GET_SNAPSHOT'); }
