import { describe, it, expect } from 'vitest';
import { EpisodeTracker } from '../src/detection/episode';
import type { Detection } from '../src/shared/types';
const qr = (text = 'https://mlearning.sjtu.edu.cn/question?a=1&token=x', x = .2): Detection => ({ decoded: true, text, rect: { x, y: .2, width: .12, height: .2 } });
describe('二维码报警轮次与开页', () => {
  it('两次解码才报警，同轮只响一次', () => {
    const t = new EpisodeTracker();
    expect(t.update([qr()], 0, 500, 10, false).alarm).toBe(false);
    expect(t.update([qr()], 500, 500, 10, false).alarm).toBe(true);
    expect(t.update([qr()], 1000, 500, 10, false).alarm).toBe(false);
  });
  it('疑似结构必须持续至少1.5秒，单帧候选不报警', () => {
    const t = new EpisodeTracker(), candidate = { ...qr(), decoded: false, text: undefined };
    for (const now of [0, 500, 1000]) expect(t.update([candidate], now, 500, 10, false).alarm).toBe(false);
    const result = t.update([candidate], 1500, 500, 10, false);
    expect(result.alarm).toBe(true); expect(result.codes[0].decoded).toBe(false);
  });
  it('2秒间隔时两次疑似结构能够触发', () => {
    const t = new EpisodeTracker(), candidate = { ...qr(), decoded: false, text: undefined };
    t.update([candidate], 0, 2000, 10, false);
    expect(t.update([candidate], 2000, 2000, 10, false).alarm).toBe(true);
  });
  it('消失不足布防时间不重响，连续消失够时进入新轮', () => {
    const t = new EpisodeTracker(); t.update([qr()], 0, 500, 10, false); t.update([qr()], 500, 500, 10, false);
    t.update([], 1000, 500, 10, false); t.update([], 9000, 500, 10, false);
    expect(t.update([qr()], 9500, 500, 10, false).alarm).toBe(false);
    t.update([], 10000, 500, 10, false);
    expect(t.update([], 20000, 500, 10, false).present).toBe(false);
    t.update([qr()], 20500, 500, 10, false);
    expect(t.update([qr()], 21000, 500, 10, false).alarm).toBe(true);
  });
  it('修改布防时间立即作用于当前离场计时', () => {
    const t = new EpisodeTracker(); t.update([qr()], 0, 500, 10, false); t.update([qr()], 500, 500, 10, false);
    t.update([], 1000, 500, 10, false);
    expect(t.update([], 2000, 500, 1, false).present).toBe(false);
  });
  it('不同位置的不同链接各打开一次，完整保留查询参数', () => {
    const t = new EpisodeTracker(); const detections = [qr(), qr('https://example.org/b?x=1&y=2', .7)];
    t.update(detections, 0, 500, 10, true);
    const r = t.update(detections, 500, 500, 10, true);
    expect(r.opens).toHaveLength(2); expect(r.opens[0].url).toContain('?a=1&token=x');
    expect(t.update(detections, 1000, 500, 10, true).opens).toHaveLength(0);
  });
  it('动态二维码同处刷新不继续开页', () => {
    const t = new EpisodeTracker(); t.update([qr()], 0, 500, 10, true); t.update([qr()], 500, 500, 10, true);
    const next = qr('https://example.org/new?token=changed');
    t.update([next], 1000, 500, 10, true);
    expect(t.update([next], 1500, 500, 10, true).opens).toHaveLength(0);
  });
  it('相同链接在两个位置只开一页', () => {
    const t = new EpisodeTracker(); const two = [qr(), qr(undefined, .7)];
    t.update(two, 0, 500, 10, true);
    expect(t.update(two, 500, 500, 10, true).opens).toHaveLength(1);
  });
  it('布局不确定时不自动打开新的位置', () => {
    const t = new EpisodeTracker(); t.setLayout(1); t.update([qr()], 0, 500, 10, true); t.update([qr()], 500, 500, 10, true);
    t.setLayout(2); const moved = qr('https://example.org/moved', .65);
    t.update([moved], 1000, 500, 10, true);
    const r = t.update([moved], 1500, 500, 10, true);
    expect(r.opens).toHaveLength(0); expect(r.codes.at(-1)?.autoOpenSuppressed).toBe(true);
  });
  it('打开失败不无限重试', () => {
    const t = new EpisodeTracker(); t.update([qr()], 0, 500, 10, true);
    const r = t.update([qr()], 500, 500, 10, true); t.openResult(r.opens[0].id, false);
    expect(t.update([qr()], 1000, 500, 10, true).opens).toHaveLength(0);
  });
  it('中途启用自动打开时仍要求当前链接连续确认', () => {
    const t = new EpisodeTracker(); t.update([qr()], 0, 500, 10, false); t.update([qr()], 500, 500, 10, false);
    const changed = qr('https://example.org/changed');
    expect(t.update([changed], 1000, 500, 10, true).opens).toHaveLength(0);
    expect(t.update([changed], 1500, 500, 10, true).opens).toHaveLength(1);
  });
  it('纯文本和危险协议不会自动打开', () => {
    for (const text of ['hello', 'weixin://scan', 'javascript:alert(1)', 'data:text/html,hello']) {
      const t = new EpisodeTracker(); t.update([qr(text)], 0, 500, 10, true);
      expect(t.update([qr(text)], 500, 500, 10, true).opens).toHaveLength(0);
    }
  });
});
