import type { Envelope, Region, State } from './shared/types';

(() => {
  const rootWindow = window as unknown as { __webcastMonitor?: boolean };
  if (rootWindow.__webcastMonitor) return;
  rootWindow.__webcastMonitor = true;
  let sessionId: string | null = null;
  let selected: HTMLElement | null = null;
  let manual: { x: number; y: number; width: number; height: number } | null = null;
  let identity = '', version = 1, lastRect: Region | null = null;
  let lastSent = '', running = false, selecting = false;
  const host = document.createElement('div'); host.id = 'webcast-monitor-widget';
  host.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;display:none;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host{font-family:"Microsoft YaHei",sans-serif;color:#eff5fa} .bar{display:flex;align-items:center;gap:12px;background:#172a3c;box-shadow:0 5px 24px #0005;border:1px solid #8293a6;border-radius:9px;padding:9px 12px;font-size:13px;max-width:90vw}
    .dot{width:9px;height:9px;border-radius:50%;background:#8ba0b4;flex-shrink:0}.dot.monitoring{background:#7cd6a7}.dot.qr{background:#ffd373}.dot.error,.dot.recovering{background:#ff8585}
    button{font:inherit;border:1px solid #8293a6;background:#263e55;color:#fff;border-radius:5px;padding:5px 9px;cursor:pointer;white-space:nowrap}button:focus-visible{outline:2px solid #ffd373} button[hidden]{display:none}
    .detail{max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#c2d0dd;font-size:11px}
    .border{pointer-events:none;position:fixed;border:2px solid #77cba4;border-radius:3px;box-sizing:border-box;display:none}.pick{position:fixed;inset:0;background:#12243833;cursor:crosshair;display:none;touch-action:none}
    .instruction{position:absolute;top:62px;left:50%;transform:translateX(-50%);background:#172a3c;padding:12px 20px;border-radius:8px;font-size:14px;white-space:nowrap}
  </style><div class="border"></div><div class="pick"><div class="instruction">拖拽框选直播画面 · 按 Esc 取消</div></div><div class="bar"><span class="dot"></span><div><strong id="status">课间哨</strong><div class="detail"></div></div><button id="ack" hidden>停止报警</button><button id="choose">框选</button><button id="stop">停止监控</button></div>`;
  document.documentElement.append(host);
  const dot = shadow.querySelector('.dot')!, label = shadow.querySelector('#status')!;
  const detail = shadow.querySelector('.detail')!;
  const border = shadow.querySelector<HTMLElement>('.border')!, pick = shadow.querySelector<HTMLElement>('.pick')!;
  const ack = shadow.querySelector<HTMLButtonElement>('#ack')!;
  function emit(type: string, payload: Record<string, unknown> = {}): void {
    void chrome.runtime.sendMessage({ target: 'background', type, sessionId, ...payload }).catch(() => undefined);
  }
  function candidates(): HTMLElement[] {
    const elements = [...document.querySelectorAll<HTMLElement>('video, canvas, .player-wrapper, .second-player-wrapper__body')];
    return elements.filter(element => {
      const rect = element.getBoundingClientRect(), css = getComputedStyle(element);
      return rect.width >= 160 && rect.height >= 90 && css.visibility !== 'hidden' && css.display !== 'none' && rect.bottom > 0 && rect.right > 0 && rect.left < innerWidth && rect.top < innerHeight;
    }).sort((a, b) => {
      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      return br.width * br.height - ar.width * ar.height;
    }).filter((element, index, all) => !all.slice(0, index).some(outer => {
      const a = outer.getBoundingClientRect(), b = element.getBoundingClientRect();
      return Math.abs(a.left - b.left) < 5 && Math.abs(a.top - b.top) < 5 && Math.abs(a.width - b.width) < 10 && Math.abs(a.height - b.height) < 10;
    }));
  }
  function autoSelect(): void {
    const options = candidates();
    selected = options[0] ?? null; manual = null;
    identity = selected ? `player-${options.indexOf(selected)}-${selected.tagName}` : 'none';
  }
  function computeRegion(): Region {
    if (!manual && running && selected && !selected.isConnected) autoSelect();
    if (!manual && running && selected && identity.startsWith('auto-')) {
      const large = candidates()[0];
      if (large && large !== selected) { selected = large; identity = `auto-${large.tagName}-${large.id}`; version++; }
    }
    const rect = manual ? { x: manual.x * innerWidth, y: manual.y * innerHeight, width: manual.width * innerWidth, height: manual.height * innerHeight } : selected?.getBoundingClientRect();
    const player = selected instanceof HTMLVideoElement ? selected : selected?.querySelector('video');
    const valid = !!rect && rect.width >= 32 && rect.height >= 32 && rect.x >= -2 && rect.y >= -2 && rect.x + rect.width <= innerWidth + 2 && rect.y + rect.height <= innerHeight + 2;
    let reason = !rect ? '没有找到直播画面，请手动框选。' : !valid ? '监控画面未完整显示，请滚回播放器或重新框选。' : undefined;
    if (manual && Math.abs(scrollX - manualScroll.x) + Math.abs(scrollY - manualScroll.y) > 2) reason = '页面已滚动，手动框选区域需要重新确认。';
    if (manual && (manualViewport.width !== innerWidth || manualViewport.height !== innerHeight)) reason = '窗口尺寸或缩放已改变，请重新框选直播画面。';
    const next: Region = { x: Math.max(0, rect?.x ?? 0), y: Math.max(0, rect?.y ?? 0), width: rect?.width ?? 0, height: rect?.height ?? 0,
      viewportWidth: innerWidth, viewportHeight: innerHeight, valid: valid && !reason, reason, identity, manual: !!manual,
      layoutVersion: version, playerTime: player?.currentTime, playerPaused: player?.paused };
    if (lastRect && (lastRect.identity !== next.identity || Math.abs(lastRect.x / lastRect.viewportWidth - next.x / innerWidth) > .05 || Math.abs(lastRect.y / lastRect.viewportHeight - next.y / innerHeight) > .05 || Math.abs(lastRect.width / lastRect.viewportWidth - next.width / innerWidth) > .08 || Math.abs(lastRect.height / lastRect.viewportHeight - next.height / innerHeight) > .08)) next.layoutVersion = ++version;
    lastRect = next; return next;
  }
  function showBorder(region: Region): void {
    border.style.display = region.valid ? 'block' : 'none';
    border.style.left = `${region.x - (host.getBoundingClientRect().left)}px`;
    border.style.top = `${region.y - (host.getBoundingClientRect().top)}px`;
    border.style.width = `${region.width}px`; border.style.height = `${region.height}px`;
  }
  let manualScroll = { x: 0, y: 0 };
  let manualViewport = { width: 0, height: 0 };
  function beginSelect(): void {
    selecting = true; host.style.display = 'block';
    host.style.left = '0'; host.style.top = '0'; host.style.transform = 'none'; host.style.width = '100vw'; host.style.height = '100vh';
    pick.style.display = 'block'; border.style.display = 'none';
    shadow.querySelector<HTMLElement>('.bar')!.style.display = 'none';
  }
  function endSelect(): void {
    selecting = false; pick.style.display = 'none';
    host.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;display:block;';
    shadow.querySelector<HTMLElement>('.bar')!.style.display = 'flex';
    border.style.display = 'none';
  }
  let drag: { x: number; y: number } | null = null;
  pick.addEventListener('pointerdown', event => { drag = { x: event.clientX, y: event.clientY }; pick.setPointerCapture(event.pointerId); });
  pick.addEventListener('pointermove', event => {
    if (!drag) return;
    border.style.display = 'block'; border.style.left = `${Math.min(drag.x, event.clientX)}px`; border.style.top = `${Math.min(drag.y, event.clientY)}px`;
    border.style.width = `${Math.abs(drag.x - event.clientX)}px`; border.style.height = `${Math.abs(drag.y - event.clientY)}px`;
  });
  pick.addEventListener('pointerup', event => {
    if (!drag) return;
    const width = Math.abs(drag.x - event.clientX), height = Math.abs(drag.y - event.clientY);
    if (width < 32 || height < 32) { drag = null; return; }
    manual = { x: Math.min(drag.x, event.clientX) / innerWidth, y: Math.min(drag.y, event.clientY) / innerHeight, width: width / innerWidth, height: height / innerHeight };
    identity = `manual-${++version}`; selected = null; manualScroll = { x: scrollX, y: scrollY }; manualViewport = { width: innerWidth, height: innerHeight }; drag = null;
    endSelect(); const region = computeRegion(); emit('REGION_SELECTED', { region });
    showBorder(region); setTimeout(() => { border.style.display = 'none'; }, 1800);
  });
  window.addEventListener('keydown', event => {
    if (selecting && event.key === 'Escape') { drag = null; endSelect(); emit('SELECTION_CANCELLED'); if (!running) host.style.display = 'none'; }
  });
  ack.onclick = () => emit('ACK_ALARMS');
  shadow.querySelector<HTMLButtonElement>('#choose')!.onclick = () => beginSelect();
  shadow.querySelector<HTMLButtonElement>('#stop')!.onclick = () => emit('STOP');
  chrome.runtime.onMessage.addListener((message: Envelope, _sender, respond) => {
    if (message.target !== 'content') return;
    if (message.type === 'PREPARE') {
      sessionId = message.sessionId!; running = false; lastRect = null; version = typeof message.layoutBase === 'number' ? message.layoutBase : 1;
      autoSelect(); identity = selected ? `auto-${selected.tagName}-${selected.id}` : 'none';
      if (message.manualRequired) { selected = null; manual = null; identity = 'none'; }
      host.style.display = 'block'; label.textContent = '监控区域预览'; detail.textContent = '绿框表示即将检测的画面';
      const region = computeRegion(); showBorder(region); setTimeout(() => { border.style.display = 'none'; }, 2000);
      respond({ ok: true, data: { region, choices: candidates().length } }); return;
    }
    if (message.sessionId !== sessionId) { respond({ ok: false, error: '会话已更换。' }); return; }
    if (message.type === 'SELECT') { beginSelect(); respond({ ok: true }); return; }
    if (message.type === 'NEXT_PLAYER') {
      const options = candidates(); const index = options.indexOf(selected!);
      selected = options[(index + 1) % options.length] ?? null; manual = null; identity = `chosen-${++version}`;
      const region = computeRegion(); emit('REGION_SELECTED', { region }); showBorder(region);
      setTimeout(() => { border.style.display = 'none'; }, 1800); respond({ ok: true, data: region }); return;
    }
    if (message.type === 'STATE') {
      const state = message.state as State; running = state.health !== 'stopped';
      host.style.display = running || state.alarms.length ? 'block' : 'none';
      dot.className = `dot ${state.health === 'error' || state.health === 'recovering' ? state.health : state.qrPresent ? 'qr' : state.health}`;
      label.textContent = state.health === 'error' ? '出现问题' : state.health === 'recovering' ? '正在恢复' : state.qrPresent ? '检测到二维码' : state.health === 'monitoring' ? '监控中' : state.health === 'starting' ? '正在启动' : '已停止';
      detail.textContent = state.detail; ack.hidden = state.alarms.length === 0;
      respond({ ok: true }); return;
    }
    if (message.type === 'GET_REGION') { respond({ ok: true, data: computeRegion() }); return; }
  });
  setInterval(() => {
    if (!sessionId || !running || selecting) return;
    const region = computeRegion();
    const serialized = JSON.stringify(region);
    if (serialized !== lastSent) { lastSent = serialized; emit('REGION_UPDATE', { region }); }
    else emit('CONTENT_HEARTBEAT');
  }, 1000);
  document.addEventListener('fullscreenchange', () => {
    const fullscreen = document.fullscreenElement;
    // Video-native fullscreen cannot host a page overlay; notifications remain available.
    if (fullscreen && !(fullscreen instanceof HTMLVideoElement)) fullscreen.append(host);
    else document.documentElement.append(host);
    version++;
  });
})();
