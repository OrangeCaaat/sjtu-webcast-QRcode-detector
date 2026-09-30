import { configureDecoder, detectCodes } from './detection/decoder';
import type { WorkerInput, WorkerOutput } from './shared/types';
const scope = globalThis as unknown as { onmessage: ((event: MessageEvent<WorkerInput & { type?: string; wasmUrl?: string }>) => void) | null; postMessage(message: WorkerOutput): void };
scope.onmessage = async ({ data }) => {
  if (data.type === 'init' && data.wasmUrl) { configureDecoder(data.wasmUrl); return; }
  const start = performance.now();
  try {
    const detections = await detectCodes(new ImageData(new Uint8ClampedArray(data.buffer), data.width, data.height));
    scope.postMessage({ requestId: data.requestId, detections, durationMs: performance.now() - start });
  } catch {
    scope.postMessage({ requestId: data.requestId, detections: [], durationMs: performance.now() - start, error: '二维码检测线程处理失败。' });
  }
};
