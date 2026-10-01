import type { CodeView, Detection, Rect } from '../shared/types';
import { safeUrl } from '../shared/settings';

interface Track {
  id: number; rect: Rect; firstSeen: number; lastSeen: number; hits: number;
  decodedHits: number; text?: string; confirmed: boolean; decoded: boolean;
  attempted: boolean; opened: boolean; suppressed: boolean;
}
export interface EpisodeResult { alarm: boolean; present: boolean; cooldownUntil?: number; codes: CodeView[]; opens: { id: number; url: string }[] }
export function overlap(a: Rect, b: Rect): number {
  const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return w * h / Math.max(1e-9, a.width * a.height + b.width * b.height - w * h);
}
function samePlace(a: Rect, b: Rect): boolean {
  if (overlap(a, b) > .25) return true;
  const distance = Math.hypot(a.x + a.width / 2 - b.x - b.width / 2, a.y + a.height / 2 - b.y - b.height / 2);
  return distance < Math.max(a.width, b.width) * .45 && Math.min(a.width, b.width) / Math.max(a.width, b.width) > .5;
}
export class EpisodeTracker {
  private tracks: Track[] = [];
  private nextId = 1;
  private triggered = false;
  private goneSince: number | null = null;
  private openedUrls = new Set<string>();
  private layoutVersion = 0;
  private uncertainLayout = false;

  reset(): void {
    this.tracks = []; this.triggered = false; this.goneSince = null;
    this.openedUrls.clear(); this.uncertainLayout = false;
  }
  setLayout(version: number): void {
    if (this.layoutVersion && this.layoutVersion !== version && this.tracks.length) this.uncertainLayout = true;
    this.layoutVersion = version;
  }
  openResult(id: number, success: boolean): void {
    const track = this.tracks.find(t => t.id === id);
    if (track) { track.opened = success; if (!success) track.suppressed = true; }
  }
  update(detections: Detection[], now: number, interval: number, rearmSeconds: number, autoOpen: boolean): EpisodeResult {
    if (!detections.length) {
      this.goneSince ??= now;
      if (now - this.goneSince >= rearmSeconds * 1000) this.reset();
    } else { this.goneSince = null; }
    const used = new Set<number>();
    for (const detection of detections) {
      let track = this.tracks.find(t => !used.has(t.id) && samePlace(t.rect, detection.rect));
      if (!track) {
        track = { id: this.nextId++, rect: detection.rect, firstSeen: now, lastSeen: now,
          hits: 0, decodedHits: 0, confirmed: false, decoded: false,
          attempted: false, opened: false, suppressed: this.uncertainLayout };
        this.tracks.push(track);
      }
      used.add(track.id);
      if (now - track.lastSeen > Math.max(interval * 2.5, 1500)) {
        track.hits = 0; track.decodedHits = 0; track.firstSeen = now;
      }
      // Keep spatial anchors across a presentation, even if the displayed payload changes.
      track.rect = detection.rect; track.lastSeen = now; track.hits++;
      if (detection.decoded && detection.text) {
        track.decodedHits = track.text === detection.text ? track.decodedHits + 1 : 1;
        track.text = detection.text;
        if (track.decodedHits >= 2) { track.confirmed = true; track.decoded = true; }
      } else { track.decodedHits = 0; }
      if (track.hits >= 2 && now - track.firstSeen >= 1500) track.confirmed = true;
    }
    let alarm = false;
    if (!this.triggered && this.tracks.some(t => t.confirmed)) { this.triggered = true; alarm = true; }
    const opens: { id: number; url: string }[] = [];
    for (const track of this.tracks) {
      const url = safeUrl(track.text);
      if (autoOpen && track.decoded && track.decodedHits >= 2 && track.confirmed && !track.attempted && !track.suppressed && used.has(track.id) && url) {
        track.attempted = true;
        if (!this.openedUrls.has(url)) {
          this.openedUrls.add(url); opens.push({ id: track.id, url });
        } else { track.opened = true; }
      }
    }
    // Drop unconfirmed stale candidates; confirmed tracks last only until this round ends.
    this.tracks = this.tracks.filter(t => t.confirmed || now - t.lastSeen < Math.max(5000, interval * 3));
    return { alarm, present: this.triggered,
      cooldownUntil: this.triggered && this.goneSince !== null ? this.goneSince + rearmSeconds * 1000 : undefined,
      codes: this.tracks.filter(t => t.confirmed).map(t => ({ id: t.id, text: t.decoded ? t.text : undefined,
        decoded: t.decoded, opened: t.opened, autoOpenSuppressed: t.suppressed })), opens };
  }
}
