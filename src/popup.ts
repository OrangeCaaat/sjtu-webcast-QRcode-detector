import './ui.css';
import { clearError, element, request, showError, snapshot } from './shared/ui';
import { DEFAULT_SETTINGS, type Settings, type State } from './shared/types';
import { safeUrl } from './shared/settings';
let settings: Settings = { ...DEFAULT_SETTINGS };
let saving = false, updating = false, testing = false;
let codeSignature = '';
const rearm = element<HTMLInputElement>('rearm'), autoOpen = element<HTMLInputElement>('auto-open'), volume = element<HTMLInputElement>('volume');
const autoOpenOnRefresh = element<HTMLInputElement>('auto-open-refresh');
function render(state: State): void {
  const names = { stopped: '已停止', starting: '正在启动', monitoring: state.qrPresent ? '检测到二维码' : '监控中', recovering: '正在恢复', error: '出现问题' };
  element('status').textContent = state.health === 'monitoring' && state.cooldownUntil ? '冷却中' : names[state.health]; element('detail').textContent = state.detail;
  element('status-dot').className = state.health === 'monitoring' && state.qrPresent ? 'qr' : state.health;
  element('session-title').textContent = state.title;
  element('start').hidden = !!state.sessionId; element('stop').hidden = !state.sessionId;
  element('ack').hidden = state.alarms.length === 0; element('retry').hidden = state.health !== 'error' || !state.sessionId;
  element('next-player').hidden = !state.sessionId; element('focus').hidden = !state.sessionId;
  const preview = element<HTMLImageElement>('preview'); preview.hidden = !state.preview;
  if (state.preview && preview.src !== state.preview) preview.src = state.preview;
  element('preview-placeholder').hidden = !!state.preview;
  const warnings = [state.audioError, state.notificationError, volume.value === '0' ? '报警音量为 0%，不会听到声音。' : ''].filter(Boolean);
  element('warning').hidden = !warnings.length; element('warning').textContent = warnings.join(' ');
  element('frame-age').textContent = state.lastFrameAt ? `最近检测：${Math.max(0, Math.floor((Date.now() - state.lastFrameAt) / 1000))} 秒前` : '等待监控';
  element('codes-section').hidden = !state.codes.length;
  const signature = JSON.stringify(state.codes);
  if (signature === codeSignature) return; codeSignature = signature;
  const container = element('codes'); container.replaceChildren();
  for (const code of state.codes) {
    const item = document.createElement('article'); item.className = 'code-item';
    const title = document.createElement('strong');
    const url = safeUrl(code.text); title.textContent = url ? new URL(url).hostname : code.decoded ? '已识别的二维码内容' : '疑似二维码，未解码';
    const description = document.createElement('p'); description.textContent = code.opened ? '本轮链接已在后台打开' : code.autoOpenSuppressed ? '位置发生变化，请手动确认后打开' : code.decoded ? '打开链接后，仍需按网站要求操作' : '请返回直播，用手机扫描或等待更清晰的画面';
    item.append(title, description);
    const buttons = document.createElement('div'); buttons.className = 'code-actions';
    if (url) {
      const open = document.createElement('button'); open.textContent = '后台打开';
      open.onclick = () => { void action(() => request('OPEN_CODE', { id: code.id })); }; buttons.append(open);
    }
    if (code.text) {
      const copy = document.createElement('button'); copy.textContent = '复制内容';
      copy.onclick = () => { void navigator.clipboard.writeText(code.text!).then(() => { copy.textContent = '已复制'; }).catch(showError); }; buttons.append(copy);
      const details = document.createElement('details'), summary = document.createElement('summary'), text = document.createElement('p');
      summary.textContent = '查看完整内容'; text.textContent = code.text; details.append(summary, text); item.append(details);
    }
    item.append(buttons); container.append(item);
  }
}
function applySettings(): void {
  if (saving) return;
  const interval = document.querySelector<HTMLInputElement>(`input[name="interval"][value="${settings.detectionIntervalMs}"]`); if (interval) interval.checked = true;
  if (document.activeElement !== rearm) rearm.value = String(settings.rearmSeconds);
  if (document.activeElement !== volume) volume.value = String(settings.volume);
  autoOpen.checked = settings.autoOpen; element('volume-label').textContent = `${volume.value}%`;
  autoOpenOnRefresh.disabled = !settings.autoOpen;
  autoOpenOnRefresh.checked = settings.autoOpen && settings.autoOpenOnRefresh;
  element('refresh-hint').textContent = !settings.autoOpen ? '需先开启“自动打开链接”' : settings.autoOpenOnRefresh ? '链接每次变化并确认后打开；可能产生多个标签页' : '关闭时，同处二维码每轮只打开一次';
}
async function refresh(): Promise<void> {
  if (updating) return; updating = true;
  try { const data = await snapshot(); if (!saving) settings = data.settings; applySettings(); render(data.state); }
  catch (error) { showError(error); } finally { updating = false; }
}
async function action(fn: () => Promise<unknown>): Promise<void> {
  clearError(); try { await fn(); await refresh(); } catch (error) { showError(error); }
}
async function save(patch: Partial<Settings>): Promise<void> {
  saving = true; clearError();
  try { settings = await request<Settings>('SAVE_SETTINGS', { settings: { ...settings, ...patch } }); }
  catch (error) { showError(error); } finally { saving = false; applySettings(); }
}
document.querySelectorAll<HTMLInputElement>('input[name="interval"]').forEach(input => input.onchange = () => { void save({ detectionIntervalMs: Number(input.value) }); });
rearm.onchange = () => {
  const value = Number(rearm.value);
  if (!Number.isInteger(value) || value < 1 || value > 300 || !rearm.value.trim()) { showError(new Error('冷却时间必须是 1–300 秒的整数。')); rearm.value = String(settings.rearmSeconds); return; }
  void save({ rearmSeconds: value });
};
autoOpen.onchange = () => {
  if (!autoOpen.checked) { autoOpenOnRefresh.disabled = true; autoOpenOnRefresh.checked = false; }
  void save({ autoOpen: autoOpen.checked, ...(!autoOpen.checked ? { autoOpenOnRefresh: false } : {}) });
};
autoOpenOnRefresh.onchange = () => { void save({ autoOpenOnRefresh: autoOpen.checked && autoOpenOnRefresh.checked }); };
volume.oninput = () => { element('volume-label').textContent = `${volume.value}%`; };
volume.onchange = () => { void save({ volume: Number(volume.value) }); };
element('start').onclick = () => { void action(async () => { const result = await request<{ selecting: boolean }>('START'); if (result.selecting) window.close(); }); };
element('stop').onclick = () => { void action(() => request('STOP')); };
element('ack').onclick = () => { void action(() => request('ACK_ALARMS')); };
element('retry').onclick = () => { void action(() => request('RETRY')); };
element('select-region').onclick = () => { void action(async () => { await request('SELECT_REGION'); window.close(); }); };
element('next-player').onclick = () => { void action(() => request('NEXT_PLAYER')); };
element('focus').onclick = () => { void action(() => request('FOCUS_TAB')); };
element('test-sound').onclick = () => { testing = true; void action(() => request('TEST_SOUND', { play: true })); };
element('stop-test').onclick = () => { testing = false; void action(() => request('TEST_SOUND', { play: false })); };
function options(): void { void chrome.runtime.openOptionsPage(); }
element('settings-button').onclick = options; element('sound-settings').onclick = options;
window.addEventListener('pagehide', () => { if (testing) void request('TEST_SOUND', { play: false }).catch(() => undefined); });
void refresh(); setInterval(() => { void refresh(); }, 1000);
