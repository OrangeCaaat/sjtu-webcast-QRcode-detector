import { SoundPlayer } from './audio';
import { EpisodeTracker } from './detection/episode';
import { DEFAULT_SETTINGS, type AlarmKind, type Envelope, type Region, type Settings, type WorkerOutput } from './shared/types';

const video = document.querySelector<HTMLVideoElement>('#capture')!;
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
let settings: Settings = { ...DEFAULT_SETTINGS };
let sessionId: string | null = null;
let stream: MediaStream | null = null;
let worker: Worker | null = null;
let region: Region | null = null;
let busy = false, requestId = 0, requestStarted = 0, lastFrameAt = 0;
let requestLayout = 0;
let audioSessionId: string | null = null;
let lastCaptureAt = 0, lastMediaTime = -1, lastPlayerTime: number | undefined, lastPlayerProgress = 0;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let sampleTimer: ReturnType<typeof setInterval> | undefined;
let frameCallback: number | null = null;
let alarms: AlarmKind[] = [];
let testSound = false;
let fault: string | null = null;
let previewSent = false;
let tracker = new EpisodeTracker();
function emit(type: string, payload: Record<string, unknown> = {}): void {
  void chrome.runtime.sendMessage({ target: 'background', type, sessionId, ...payload }).catch(() => undefined);
}
const sound = new SoundPlayer(error => emit('AUDIO_ERROR', { error, sessionId: sessionId ?? audioSessionId }));
function applySound(): void {
  const kind = alarms.includes('fault') ? 'fault' : alarms.includes('qr') ? 'qr' : testSound ? 'test' : null;
  if (kind) void sound.play(kind, settings); else sound.stop();
}
function setFault(reason: string): void {
  if (fault !== reason) { fault = reason; emit('ENGINE_FAULT', { reason }); }
}
function makeWorker(): void {
  worker?.terminate(); busy = false;
  worker = new Worker(new URL('./detector.worker.ts', import.meta.url), { type: 'module' });
  worker.postMessage({ type: 'init', wasmUrl: chrome.runtime.getURL('wasm/zxing_reader.wasm') });
  const ownWorker = worker;
  worker.onmessage = ({ data }: MessageEvent<WorkerOutput>) => {
    if (ownWorker !== worker || !sessionId || data.requestId !== requestId) return;
    busy = false;
    if (requestLayout !== region?.layoutVersion || !region.valid) return;
    if (data.error) { setFault(data.error); return; }
    lastFrameAt = Date.now();
    if (fault) { fault = null; emit('ENGINE_RECOVERED'); }
    const result = tracker.update(data.detections, lastFrameAt, settings.detectionIntervalMs, settings.rearmSeconds, settings.autoOpen);
    emit('DETECTIONS', { result, durationMs: data.durationMs, lastFrameAt });
  };
  worker.onerror = () => setFault('二维码检测线程意外停止。');
  worker.onmessageerror = () => setFault('检测线程消息无法读取。');
}
function schedule(): void {
  if (sampleTimer) clearInterval(sampleTimer);
  if (sessionId) sampleTimer = setInterval(sample, settings.detectionIntervalMs);
}
function watchFrames(): void {
  if (frameCallback !== null) video.cancelVideoFrameCallback(frameCallback);
  const watch = () => {
    if (!sessionId) return;
    frameCallback = video.requestVideoFrameCallback(() => { lastCaptureAt = Date.now(); watch(); });
  };
  watch();
}
function sample(): void {
  if (!sessionId || !worker) return;
  const now = Date.now();
  if (busy) {
    if (now - requestStarted > 10000) setFault('检测线程超过 10 秒没有返回结果。');
    return;
  }
  if (!region?.valid) { setFault(region?.reason ?? '找不到可见监控区域，请重新选择。'); return; }
  if (!stream || stream.getVideoTracks()[0]?.readyState !== 'live' || video.readyState < 2) { setFault('无法获取直播标签页画面。'); return; }
  if (video.currentTime !== lastMediaTime) { lastMediaTime = video.currentTime; lastCaptureAt = now; }
  if (now - lastCaptureAt > 10000) { setFault('标签页采集画面已停止更新。'); return; }
  if (region.playerTime !== undefined) {
    if (region.playerTime !== lastPlayerTime) { lastPlayerTime = region.playerTime; lastPlayerProgress = now; }
    if (region.playerPaused) { setFault('直播播放器已暂停，请恢复播放。'); return; }
    if (now - lastPlayerProgress > 10000) { setFault('直播播放时间超过 10 秒没有推进，可能断流。'); return; }
  }
  const sx = video.videoWidth / region.viewportWidth, sy = video.videoHeight / region.viewportHeight;
  const x = Math.round(region.x * sx), y = Math.round(region.y * sy);
  const w = Math.round(region.width * sx), h = Math.round(region.height * sy);
  if (w < 16 || h < 16 || x < 0 || y < 0 || x + w > video.videoWidth + 2 || y + h > video.videoHeight + 2) { setFault('监控区域不在采集画面内。'); return; }
  const scale = Math.min(1, 1920 / w, 1200 / h);
  canvas.width = Math.max(1, Math.round(w * scale)); canvas.height = Math.max(1, Math.round(h * scale));
  try {
    ctx.drawImage(video, x, y, Math.min(w, video.videoWidth - x), Math.min(h, video.videoHeight - y), 0, 0, canvas.width, canvas.height);
    if (!previewSent) {
      const preview = document.createElement('canvas'); preview.width = 360; preview.height = Math.round(canvas.height * 360 / canvas.width);
      preview.getContext('2d')!.drawImage(canvas, 0, 0, preview.width, preview.height);
      emit('PREVIEW', { preview: preview.toDataURL('image/jpeg', .6) }); previewSent = true;
    }
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    busy = true; requestStarted = now; requestId++; requestLayout = region.layoutVersion;
    worker.postMessage({ requestId, width: canvas.width, height: canvas.height, buffer: image.data.buffer }, [image.data.buffer]);
  } catch { busy = false; setFault('无法读取采集画面，请重新开启监控。'); }
}
function releaseCapture(): void {
  if (frameCallback !== null) video.cancelVideoFrameCallback(frameCallback); frameCallback = null;
  const old = stream; stream = null;
  old?.getTracks().forEach(track => { track.onended = null; track.onmute = null; track.stop(); });
  video.pause(); video.srcObject = null;
}
function stopSession(): void {
  sessionId = null; releaseCapture(); worker?.terminate(); worker = null; busy = false;
  if (sampleTimer) clearInterval(sampleTimer); sampleTimer = undefined;
  if (heartbeatTimer) clearInterval(heartbeatTimer); heartbeatTimer = undefined;
  alarms = []; testSound = false; sound.stop(); tracker.reset();
}
async function capture(id: string): Promise<void> {
  releaseCapture();
  const constraints = { audio: false, video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: id, maxWidth: 2560, maxHeight: 1600, minFrameRate: 1, maxFrameRate: 10 } } } as unknown as MediaStreamConstraints;
  const ownSession = sessionId;
  const next = await navigator.mediaDevices.getUserMedia(constraints);
  if (sessionId !== ownSession || !sessionId) { next.getTracks().forEach(t => t.stop()); return; }
  stream = next; video.srcObject = stream; video.muted = true; await video.play();
  for (const track of stream.getVideoTracks()) {
    track.onended = () => { if (stream === next) setFault('直播标签页采集已结束。'); };
    track.onmute = () => { if (stream === next) setFault('直播标签页暂时没有可采集画面。'); };
  }
  lastCaptureAt = Date.now(); lastPlayerProgress = Date.now(); lastMediaTime = -1;
  watchFrames();
}
async function handle(message: Envelope): Promise<unknown> {
  if (message.type === 'START_ENGINE') {
    stopSession(); sessionId = message.sessionId!; settings = message.settings as Settings;
    region = message.region as Region; tracker = new EpisodeTracker(); tracker.setLayout(region.layoutVersion);
    previewSent = false; fault = null; lastFrameAt = 0; lastPlayerTime = undefined;
    try { await capture(message.streamId as string); makeWorker(); schedule(); }
    catch { setFault('无法启动标签页采集，请在直播标签页重新点击“开始监控”。'); throw new Error('无法启动标签页采集。'); }
    heartbeatTimer = setInterval(() => emit('HEARTBEAT', { lastFrameAt, captureLive: stream?.getVideoTracks()[0]?.readyState === 'live', fault }), 2000);
    sample(); return true;
  }
  if (message.type === 'STOP_ENGINE') { stopSession(); return true; }
  if (message.type === 'HALT_CAPTURE' && message.sessionId === sessionId) {
    releaseCapture(); worker?.terminate(); worker = null; busy = false;
    if (sampleTimer) clearInterval(sampleTimer); sampleTimer = undefined;
    fault = message.reason as string; return true;
  }
  if (message.type === 'SET_SETTINGS') { settings = message.settings as Settings; schedule(); applySound(); return true; }
  if (message.type === 'TEST_SOUND') { settings = message.settings as Settings; testSound = !!message.play; applySound(); return true; }
  if (message.sessionId !== sessionId && message.type !== 'SET_ALARMS') return false;
  if (message.type === 'UPDATE_REGION') {
    const next = message.region as Region;
    if (region?.layoutVersion !== next.layoutVersion) previewSent = false;
    region = next; tracker.setLayout(next.layoutVersion); return true;
  }
  if (message.type === 'SET_ALARMS') {
    if (message.sessionId !== sessionId && sessionId) return false;
    audioSessionId = message.sessionId ?? null; alarms = message.alarms as AlarmKind[]; testSound = false; applySound(); return true;
  }
  if (message.type === 'RETRY_ENGINE') {
    if (message.streamId) await capture(message.streamId as string);
    makeWorker(); schedule(); sample(); return true;
  }
  if (message.type === 'OPEN_RESULT') { tracker.openResult(message.id as number, !!message.success); return true; }
  if (message.type === 'PING') return { sessionId, lastFrameAt, fault };
  return false;
}
chrome.runtime.onMessage.addListener((message: Envelope, _sender, respond) => {
  if (message.target !== 'offscreen') return;
  void handle(message).then(data => respond({ ok: true, data })).catch(error => respond({ ok: false, error: error.message }));
  return true;
});
