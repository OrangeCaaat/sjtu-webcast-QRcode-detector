import { loadSettings, safeUrl, validateSettings } from './shared/settings';
import { initialState, type Envelope, type Region, type Reply, type Settings, type State } from './shared/types';
import type { EpisodeResult } from './detection/episode';

let state = initialState();
let settings: Settings;
let pending: { sessionId: string; tabId: number; title: string } | null = null;
let creating: Promise<void> | null = null;
let contentSeen = 0, lastRetryAt = 0, captureLive = false;
let queue = Promise.resolve();
const ready = (async () => {
  settings = await loadSettings();
  const saved = await chrome.storage.session.get('state');
  if (saved.state) state = saved.state as State;
  const { interrupted } = await chrome.storage.local.get('interrupted');
  if (!state.sessionId && interrupted) {
    state.health = 'error'; state.detail = '上次监控异常结束。请打开直播页面重新开启。';
    await publish();
    await chrome.notifications.create('webcast-interrupted', { type: 'basic', iconUrl: 'icons/128.png', title: '上次二维码监控异常结束', message: '浏览器或扩展已重新启动，请在直播页重新开启监控。' }).catch(() => undefined);
  }
})();
async function offscreen(type: string, payload: Record<string, unknown> = {}): Promise<unknown> {
  const reply = await chrome.runtime.sendMessage({ target: 'offscreen', type, sessionId: state.sessionId, ...payload }) as Reply;
  if (!reply?.ok) throw new Error(reply?.error ?? '后台监控未响应。');
  return reply.data;
}
async function ensureOffscreen(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [chrome.runtime.getURL('offscreen.html')] });
  if (contexts.length) return;
  if (!creating) creating = chrome.offscreen.createDocument({ url: 'offscreen.html',
    reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.AUDIO_PLAYBACK, chrome.offscreen.Reason.WORKERS, chrome.offscreen.Reason.BLOBS],
    justification: '持续采集用户选择的直播标签页，在检测线程识别二维码并播放报警或本地自定义铃声。',
  }).finally(() => { creating = null; });
  await creating;
}
async function content(type: string, payload: Record<string, unknown> = {}, tabId = state.tabId): Promise<unknown> {
  if (tabId === null) throw new Error('直播标签页不存在。');
  const reply = await chrome.tabs.sendMessage(tabId, { target: 'content', type, sessionId: state.sessionId, ...payload }) as Reply;
  if (!reply?.ok) throw new Error(reply?.error ?? '直播页面未响应。');
  return reply.data;
}
async function publish(): Promise<void> {
  await chrome.storage.session.set({ state });
  const problem = ['error', 'recovering'].includes(state.health);
  const badge = problem ? '!' : state.qrPresent ? 'QR' : state.health === 'monitoring' ? 'ON' : state.health === 'starting' ? '…' : '';
  await chrome.action.setBadgeText({ text: badge });
  await chrome.action.setBadgeBackgroundColor({ color: problem ? '#ba4343' : state.qrPresent ? '#ad750e' : '#277552' });
  if (state.tabId !== null) await content('STATE', { state }).catch(() => undefined);
}
async function alarm(kind: 'qr' | 'fault'): Promise<void> {
  if (!state.alarms.includes(kind)) state.alarms.push(kind);
  await ensureOffscreen();
  await offscreen('SET_SETTINGS', { settings }).catch(() => undefined);
  await offscreen('SET_ALARMS', { alarms: state.alarms }).catch(() => { state.audioError = '报警声音未能启动，请打开声音设置测试。'; });
  try {
    await chrome.notifications.create(`webcast-${kind}`, { type: 'basic', iconUrl: 'icons/128.png',
      title: kind === 'qr' ? '直播画面出现二维码' : '直播二维码监控出现问题',
      message: kind === 'qr' ? '请返回直播处理。声音会持续，直到点击“停止报警”。' : state.detail,
      buttons: [{ title: '停止报警' }, { title: '返回直播' }], requireInteraction: true, priority: 2 });
    state.notificationError = undefined;
  } catch { state.notificationError = '系统通知未能显示，请检查通知权限；仍可在插件内消警。'; }
}
async function acknowledge(): Promise<void> {
  state.alarms = [];
  await offscreen('SET_ALARMS', { alarms: [] }).catch(() => undefined);
  await chrome.notifications.clear('webcast-qr'); await chrome.notifications.clear('webcast-fault');
  await publish();
}
async function stop(): Promise<void> {
  const tabId = state.tabId ?? pending?.tabId ?? null;
  const oldSessionId = state.sessionId ?? pending?.sessionId ?? null;
  await offscreen('STOP_ENGINE').catch(() => undefined);
  await chrome.notifications.clear('webcast-qr'); await chrome.notifications.clear('webcast-fault');
  state = initialState(); pending = null;
  await chrome.storage.local.set({ interrupted: false }); await chrome.alarms.clear('watchdog');
  if (tabId !== null) await chrome.tabs.sendMessage(tabId, { target: 'content', type: 'STATE', state, sessionId: oldSessionId }).catch(() => undefined);
  await publish();
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  if (contexts.length) await chrome.offscreen.closeDocument().catch(() => undefined);
}
async function currentTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.match(/^https?:\/\//)) throw new Error('请先切换到普通 HTTP/HTTPS 直播网页，再打开插件。');
  return tab;
}
async function prepare(manual: boolean): Promise<{ sessionId: string; tabId: number; title: string; region: Region }> {
  if (state.sessionId) throw new Error('已有直播在监控。请先停止，再开始另一门课程。');
  const tab = await currentTab();
  await chrome.scripting.executeScript({ target: { tabId: tab.id! }, files: ['content.js'] });
  const id = crypto.randomUUID(); pending = { sessionId: id, tabId: tab.id!, title: tab.title ?? '直播页面' };
  const reply = await chrome.tabs.sendMessage(tab.id!, { target: 'content', type: 'PREPARE', sessionId: id }) as Reply<{ region: Region }>;
  if (!reply?.ok || !reply.data) throw new Error('无法识别页面，请刷新网页重试。');
  if (manual || new URL(tab.url!).hostname !== 'v.sjtu.edu.cn') {
    await chrome.tabs.sendMessage(tab.id!, { target: 'content', type: 'SELECT', sessionId: id });
    return { ...pending, region: { ...reply.data.region, valid: false, reason: '请在页面中拖拽框选直播画面。' } };
  }
  return { ...pending, region: reply.data.region };
}
async function begin(prepared: { sessionId: string; tabId: number; title: string; region: Region }): Promise<void> {
  if (!prepared.region.valid) throw new Error(prepared.region.reason ?? '请重新选择监控区域。');
  await ensureOffscreen();
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: prepared.tabId });
  const tab = await chrome.tabs.get(prepared.tabId);
  state = { ...initialState(), ...prepared, pageOrigin: tab.url ? new URL(tab.url).origin : undefined, health: 'starting', detail: '正在采集并检查直播画面…' };
  pending = null; contentSeen = Date.now(); captureLive = true; lastRetryAt = 0;
  await chrome.storage.local.set({ interrupted: true });
  await chrome.alarms.create('watchdog', { periodInMinutes: .5 });
  await publish();
  try { await offscreen('START_ENGINE', { ...prepared, streamId, settings }); }
  catch (error) { await fail(error instanceof Error ? error.message : '监控启动失败。'); throw error; }
}
async function fail(reason: string, fatal = false): Promise<void> {
  const first = state.health !== 'error';
  state.health = 'error'; state.detail = reason; state.retrySince = null;
  state.fatalError ||= fatal;
  if (fatal) await offscreen('HALT_CAPTURE', { reason }).catch(() => undefined);
  if (first) await alarm('fault');
  await publish();
}
async function recovery(reason: string): Promise<void> {
  if (!state.sessionId || state.health === 'error') return;
  state.retrySince ??= Date.now(); state.health = 'recovering'; state.detail = reason;
  if (Date.now() - state.retrySince >= 10000) { await fail(reason); return; }
  if (Date.now() - lastRetryAt >= 2500 && state.region?.valid) {
    lastRetryAt = Date.now();
    let streamId: string | undefined;
    if (!captureLive) { streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: state.tabId! }).catch(() => undefined); }
    if (captureLive || streamId) await offscreen('RETRY_ENGINE', { streamId }).catch(() => undefined);
  }
  await publish();
}
async function handle(message: Envelope, sender: chrome.runtime.MessageSender): Promise<unknown> {
  await ready;
  const fromOffscreen = sender.url === chrome.runtime.getURL('offscreen.html');
  const ownPage = sender.url === chrome.runtime.getURL('popup.html') || sender.url === chrome.runtime.getURL('settings.html');
  const fromContent = !ownPage && !fromOffscreen && sender.tab?.id !== undefined;
  if (sender.id !== chrome.runtime.id) throw new Error('消息来源无效。');
  if (['GET_SNAPSHOT', 'SAVE_SETTINGS', 'START', 'SELECT_REGION', 'NEXT_PLAYER', 'TEST_SOUND', 'OPEN_CODE', 'RETRY', 'FOCUS_TAB'].includes(message.type) && !ownPage) throw new Error('请通过插件控制面板操作。');
  if (message.type === 'GET_SNAPSHOT') return { state, settings };
  if (message.type === 'SAVE_SETTINGS') {
    settings = validateSettings(message.settings as Settings);
    await chrome.storage.local.set({ settings });
    await offscreen('SET_SETTINGS', { settings }).catch(() => undefined); return settings;
  }
  if (message.type === 'START') {
    const prepared = await prepare(false);
    if (!prepared.region.valid) {
      if (new URL((await chrome.tabs.get(prepared.tabId)).url!).hostname === 'v.sjtu.edu.cn') throw new Error(prepared.region.reason ?? '请手动框选。');
      return { selecting: true };
    }
    await begin(prepared); return { selecting: false };
  }
  if (message.type === 'SELECT_REGION') {
    if (state.sessionId) { await content('SELECT'); return true; }
    await prepare(true); return true;
  }
  if (message.type === 'NEXT_PLAYER') { await content('NEXT_PLAYER'); return true; }
  if (message.type === 'TEST_SOUND') {
    await ensureOffscreen(); await offscreen('TEST_SOUND', { play: !!message.play, kind: message.kind === 'fault' ? 'fault' : 'qr', settings }); return true;
  }
  if (message.type === 'FOCUS_TAB') {
    if (state.tabId !== null) { const tab = await chrome.tabs.update(state.tabId, { active: true }); if (tab) await chrome.windows.update(tab.windowId, { focused: true }); }
    return true;
  }
  if (message.type === 'OPEN_CODE') {
    const code = state.codes.find(c => c.id === message.id), url = safeUrl(code?.text);
    if (!url) throw new Error('该内容不是可打开的 HTTP/HTTPS 链接。');
    await chrome.tabs.create({ url, active: false }); return true;
  }
  if (message.type === 'RETRY') {
    if (state.fatalError) throw new Error('原监控页面已失效。请停止后在直播页重新开启。');
    if (!state.sessionId || !state.region?.valid) throw new Error('请先重新选择可见监控区域。');
    state.health = 'recovering'; state.retrySince = Date.now(); lastRetryAt = 0;
    await recovery('正在重新连接监控…'); return true;
  }
  if (message.type === 'STOP' || message.type === 'ACK_ALARMS') {
    const activeContent = fromContent && sender.tab?.id === state.tabId && message.sessionId === state.sessionId;
    const pendingContent = message.type === 'STOP' && fromContent && sender.tab?.id === pending?.tabId && message.sessionId === pending?.sessionId;
    if (!ownPage && !activeContent && !pendingContent) throw new Error('会话已更换。');
    if (message.type === 'STOP') await stop(); else await acknowledge(); return true;
  }
  if (message.type === 'REGION_SELECTED' && pending && sender.tab?.id === pending.tabId && message.sessionId === pending.sessionId) {
    await begin({ ...pending, region: message.region as Region }); return true;
  }
  if (message.type === 'SELECTION_CANCELLED' && pending && sender.tab?.id === pending.tabId) { pending = null; return true; }
  if (message.type === 'AUDIO_ERROR' && fromOffscreen && message.sessionId === state.sessionId) {
    if (state.audioError !== message.error) { state.audioError = message.error as string; await publish(); }
    return true;
  }
  if (message.sessionId !== state.sessionId || !state.sessionId) return false;
  if (fromContent && sender.tab?.id === state.tabId) {
    contentSeen = Date.now();
    if (['REGION_UPDATE', 'REGION_SELECTED'].includes(message.type)) {
      state.region = message.region as Region;
      await offscreen('UPDATE_REGION', { region: state.region }).catch(() => undefined);
      if (!state.region.valid) await recovery(state.region.reason ?? '监控区域不可用。');
      return true;
    }
    if (message.type === 'CONTENT_HEARTBEAT') return true;
  }
  if (!fromOffscreen) return false;
  if (message.type === 'HEARTBEAT') {
    state.lastHeartbeatAt = Date.now(); captureLive = !!message.captureLive;
    if (message.fault) await recovery(message.fault as string);
    else if (state.retrySince !== null) await recovery(state.detail);
    else await chrome.storage.session.set({ state });
    return true;
  }
  if (message.type === 'ENGINE_FAULT') { await recovery(message.reason as string); return true; }
  if (message.type === 'ENGINE_RECOVERED') {
    state.health = 'monitoring'; state.retrySince = null; state.detail = '画面检测已恢复，已触发的报警仍需手动停止。'; await publish(); return true;
  }
  if (message.type === 'DETECTIONS') {
    if (state.fatalError) return false;
    const result = message.result as EpisodeResult;
    state.lastFrameAt = message.lastFrameAt as number; state.qrPresent = result.present; state.codes = result.codes; state.cooldownUntil = result.cooldownUntil;
    state.health = 'monitoring'; state.retrySince = null;
    state.detail = result.cooldownUntil ? `二维码已消失，冷却剩余 ${Math.max(0, Math.ceil((result.cooldownUntil - Date.now()) / 1000))} 秒。检测继续。` : state.qrPresent ? !result.alarm && !state.alarms.includes('qr') ? '已停止报警，监控继续。二维码消失并完成冷却后恢复监控状态。' : result.codes.some(c => c.decoded) ? '检测到二维码。请处理课程中的签到或问卷。' : '疑似二维码，未解码。请返回直播确认。' : state.region?.playerPaused ? '播放器已暂停，正在检测当前画面。恢复播放后继续跟随视频。' : state.region?.playerTime === undefined ? '正在检测选定区域。' : '正在检测直播画面。';
    if (result.alarm) await alarm('qr');
    for (const open of result.opens) {
      let success = false;
      if (settings.autoOpen && safeUrl(open.url)) {
        try { await chrome.tabs.create({ url: open.url, active: false }); success = true; } catch { state.detail = '二维码已检测到，但后台打开失败，可手动打开。'; }
      }
      const code = state.codes.find(c => c.id === open.id); if (code) code.opened = success;
      await offscreen('OPEN_RESULT', { id: open.id, success }).catch(() => undefined);
    }
    await publish(); return true;
  }
  if (message.type === 'PREVIEW') { state.preview = message.preview as string; await publish(); return true; }
  return false;
}
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn); queue = next.then(() => undefined, () => undefined); return next;
}
chrome.runtime.onMessage.addListener((message: Envelope, sender, respond) => {
  if (message.target !== 'background') return;
  void serial(() => handle(message, sender)).then(data => respond({ ok: true, data })).catch(error => respond({ ok: false, error: error instanceof Error ? error.message : '操作失败，请重试。' }));
  return true;
});
chrome.notifications.onButtonClicked.addListener((_id, index) => {
  if (!_id.startsWith('webcast-')) return;
  void serial(async () => { await ready; if (index === 0) await acknowledge(); else if (state.tabId !== null) { const tab = await chrome.tabs.update(state.tabId, { active: true }); if (tab) await chrome.windows.update(tab.windowId, { focused: true }); } }).catch(() => undefined);
});
chrome.notifications.onClicked.addListener(id => {
  if (!id.startsWith('webcast-')) return;
  if (id === 'webcast-interrupted') { void chrome.runtime.openOptionsPage(); return; }
  void serial(async () => { await ready; if (state.tabId !== null) { const tab = await chrome.tabs.update(state.tabId, { active: true }); if (tab) await chrome.windows.update(tab.windowId, { focused: true }); } }).catch(() => undefined);
});
chrome.tabCapture.onStatusChanged.addListener(info => {
  void serial(async () => { await ready; if (info.tabId !== state.tabId || !state.sessionId) return; if (['stopped', 'error'].includes(info.status)) { captureLive = false; await recovery('直播标签页采集意外停止。'); } });
});
chrome.tabs.onRemoved.addListener(tabId => {
  void serial(async () => { await ready; if (tabId === state.tabId && state.sessionId) { captureLive = false; await fail('监控的直播标签页已关闭。请停止后重新打开课程并开启监控。', true); } });
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  void serial(async () => {
    await ready; if (tabId !== state.tabId || !state.sessionId || !change.status) return;
    if (change.status === 'loading') {
      contentSeen = 0;
      if (state.region) { state.region = { ...state.region, valid: false, reason: '页面正在刷新，等待重新确认监控区域。' }; await offscreen('UPDATE_REGION', { region: state.region }).catch(() => undefined); }
      await recovery('页面正在刷新，正在重新确认监控区域…');
    }
    if (change.status === 'complete') {
      const tab = await chrome.tabs.get(tabId);
      if (!tab.url || new URL(tab.url).origin !== state.pageOrigin) { await fail('页面已跳转到其他网站。请停止后在目标直播页重新开启。', true); return; }
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
        const prepared = await content('PREPARE', { layoutBase: (state.region?.layoutVersion ?? 0) + 1, manualRequired: !!state.region?.manual || new URL(tab.url).hostname !== 'v.sjtu.edu.cn' }) as { region: Region };
        state.region = prepared.region; contentSeen = Date.now();
        await offscreen('UPDATE_REGION', { region: state.region });
        if (!state.region.valid) await fail('页面已刷新，请手动重新框选直播画面。');
        else { state.health = 'recovering'; state.retrySince = Date.now(); await publish(); }
      } catch { await fail('无法恢复页面授权或监控区域。请停止后重新开启。'); }
    }
  });
});
chrome.alarms.onAlarm.addListener(alarmInfo => {
  if (alarmInfo.name !== 'watchdog') return;
  void serial(async () => {
    await ready; if (!state.sessionId) return;
    const now = Date.now();
    if (!state.lastHeartbeatAt || now - state.lastHeartbeatAt > 15000) {
      await ensureOffscreen(); await fail('后台检测失去响应。请停止后重新开启监控。', true);
    } else if (contentSeen && now - contentSeen > 30000) {
      const region = await content('GET_REGION').catch(() => null) as Region | null;
      if (!region) await fail('无法确认直播页面监控区域，请重新开启监控。');
      else { state.region = region; await offscreen('UPDATE_REGION', { region }); }
    }
  });
});
chrome.runtime.onStartup.addListener(() => { void serial(async () => { await ready; state = initialState(); const { interrupted } = await chrome.storage.local.get('interrupted'); if (interrupted) { state.health = 'error'; state.detail = '上次监控异常结束，请重新开启。'; } await publish(); }); });
