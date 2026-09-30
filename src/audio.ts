import { readSound } from './shared/audio-store';
import type { AlarmKind, Settings } from './shared/types';

export class SoundPlayer {
  private context = new AudioContext();
  private gain = this.context.createGain();
  private timer: ReturnType<typeof setInterval> | undefined;
  private media: HTMLAudioElement | null = null;
  private url: string | null = null;
  private kind: AlarmKind | 'test' | null = null;
  private name: string | null = null;
  private generation = 0;
  private oscillators = new Set<OscillatorNode>();
  constructor(private onError: (error: string) => void) { this.gain.connect(this.context.destination); }
  async play(kind: AlarmKind | 'test', settings: Settings): Promise<void> {
    this.setVolume(settings.volume);
    if (this.kind === kind && this.name === settings.customSoundName) return;
    this.stop();
    this.kind = kind; this.name = settings.customSoundName;
    const generation = ++this.generation;
    try {
      await Promise.race([this.context.resume(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('声音输出未启动，请测试声音并检查浏览器静音设置。')), 5000))]);
      if (generation !== this.generation) return;
      if (kind !== 'fault' && settings.customSoundName) {
        const blob = await readSound();
        if (generation !== this.generation) return;
        if (!blob) throw new Error('本地自定义铃声不存在，已改用默认提示音。');
        this.url = URL.createObjectURL(blob); const media = new Audio(this.url); this.media = media;
        media.loop = true; media.volume = settings.volume / 100;
        media.onerror = () => {
          if (generation === this.generation) { this.onError('自定义铃声播放失败，已改用默认提示音。'); this.defaultTone(kind); }
        };
        await media.play();
        if (generation !== this.generation) { media.pause(); return; }
      } else { this.defaultTone(kind); }
    } catch (error) {
      if (generation !== this.generation) return;
      this.onError(error instanceof Error ? error.message : '无法播放声音，请检查系统音量并测试报警。');
      this.defaultTone(kind);
    }
  }
  private defaultTone(kind: AlarmKind | 'test'): void {
    if (this.timer) clearInterval(this.timer);
    this.media?.pause();
    const beep = () => {
      if (this.context.state !== 'running') {
        this.onError('声音输出未启动，请点击“测试声音”并检查浏览器及系统静音设置。'); return;
      }
      const base = this.context.currentTime;
      const pitches = kind === 'fault' ? [660, 440, 660, 440] : [880, 1174, 880];
      pitches.forEach((pitch, index) => {
        const oscillator = this.context.createOscillator();
        this.oscillators.add(oscillator);
        const envelope = this.context.createGain();
        const t = base + index * .3;
        oscillator.type = 'triangle'; oscillator.frequency.value = pitch;
        envelope.gain.setValueAtTime(0, t); envelope.gain.linearRampToValueAtTime(.8, t + .015);
        envelope.gain.setValueAtTime(.8, t + .22);
        envelope.gain.linearRampToValueAtTime(0, t + .28);
        oscillator.connect(envelope); envelope.connect(this.gain);
        oscillator.start(t); oscillator.stop(t + .29);
        oscillator.onended = () => { this.oscillators.delete(oscillator); oscillator.disconnect(); envelope.disconnect(); };
      });
    };
    beep(); this.timer = setInterval(beep, kind === 'fault' ? 3000 : 1400);
  }
  setVolume(volume: number): void {
    this.gain.gain.value = volume / 100;
    if (this.media) this.media.volume = volume / 100;
  }
  stop(): void {
    this.generation++; this.kind = null; this.name = null;
    if (this.timer) clearInterval(this.timer); this.timer = undefined;
    for (const oscillator of this.oscillators) { try { oscillator.stop(); } catch { /* already ended */ } }
    this.oscillators.clear();
    this.media?.pause(); this.media = null;
    if (this.url) URL.revokeObjectURL(this.url); this.url = null;
  }
}
