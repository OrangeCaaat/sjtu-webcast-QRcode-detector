export const INTERVALS = [250, 500, 1000, 2000] as const;
export interface Settings {
  detectionIntervalMs: number;
  rearmSeconds: number;
  volume: number;
  autoOpen: boolean;
  autoOpenOnRefresh: boolean;
  customSoundName: string | null;
}
export type Health = 'stopped' | 'starting' | 'monitoring' | 'recovering' | 'error';
export type AlarmKind = 'qr' | 'fault';
export interface Rect { x: number; y: number; width: number; height: number }
export interface Region extends Rect {
  viewportWidth: number; viewportHeight: number;
  valid: boolean; reason?: string; identity: string; manual: boolean;
  layoutVersion: number; playerTime?: number; playerPaused?: boolean;
}
export interface Detection { rect: Rect; text?: string; decoded: boolean }
export interface CodeView { id: number; text?: string; decoded: boolean; opened: boolean; autoOpenSuppressed?: boolean }
export interface State {
  sessionId: string | null; tabId: number | null; title: string;
  health: Health; qrPresent: boolean; alarms: AlarmKind[];
  codes: CodeView[]; detail: string; region: Region | null;
  lastFrameAt: number; lastHeartbeatAt: number; retrySince: number | null;
  preview?: string; notificationError?: string; audioError?: string;
  pageOrigin?: string;
  fatalError?: boolean;
  cooldownUntil?: number;
}
export interface WorkerInput { requestId: number; width: number; height: number; buffer: ArrayBuffer }
export interface WorkerOutput { requestId: number; detections: Detection[]; durationMs: number; error?: string }
export interface Envelope {
  target: 'background' | 'offscreen' | 'content'; type: string;
  sessionId?: string; [key: string]: unknown;
}
export interface Reply<T = unknown> { ok: boolean; data?: T; error?: string }
export const DEFAULT_SETTINGS: Settings = {
  detectionIntervalMs: 500, rearmSeconds: 10, volume: 70,
  autoOpen: false, autoOpenOnRefresh: false, customSoundName: null,
};
export function initialState(): State {
  return { sessionId: null, tabId: null, title: '', health: 'stopped', qrPresent: false,
    alarms: [], codes: [], detail: '选择直播标签页，开始监控。', region: null,
    lastFrameAt: 0, lastHeartbeatAt: 0, retrySince: null };
}
