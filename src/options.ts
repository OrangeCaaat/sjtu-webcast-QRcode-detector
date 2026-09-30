import './ui.css';
import { readSound, writeSound } from './shared/audio-store';
import { clearError, element, request, showError, snapshot } from './shared/ui';
import { DEFAULT_SETTINGS, type Settings } from './shared/types';
let settings: Settings = { ...DEFAULT_SETTINGS };
const volume = element<HTMLInputElement>('volume');
function render(): void { element('sound-name').textContent = settings.customSoundName ?? '默认提示音'; volume.value = String(settings.volume); element('volume-label').textContent = `${settings.volume}%`; }
async function save(patch: Partial<Settings>): Promise<void> {
  const fresh = await snapshot();
  settings = await request<Settings>('SAVE_SETTINGS', { settings: { ...fresh.settings, ...patch } }); render();
}
function success(text: string): void { const box = element('success'); box.hidden = false; box.textContent = text; }
async function action(fn: () => Promise<void>): Promise<void> { clearError(); element('success').hidden = true; try { await fn(); } catch (error) { showError(error); } }
element<HTMLInputElement>('sound-file').onchange = event => {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; if (!file) return;
  input.disabled = true;
  void action(async () => {
    if (file.size > 20 * 1024 * 1024 || !file.size) throw new Error('请选择非空且不超过 20 MB 的音乐文件。');
    if (!/\.(mp3|wav|ogg)$/i.test(file.name)) throw new Error('仅支持 MP3、WAV、OGG 文件。');
    const context = new AudioContext();
    try { const decoded = await context.decodeAudioData(await file.arrayBuffer()); if (decoded.duration <= 0) throw new Error(); }
    catch { throw new Error('无法解码此音乐文件，原有声音已保留。'); }
    finally { await context.close(); }
    const old = await readSound();
    try { await writeSound(file); await save({ customSoundName: file.name }); }
    catch (error) { if (old) await writeSound(old); throw error; }
    success('已保存到本机。点击“测试报警声音”确认实际音量。');
  }).finally(() => { input.disabled = false; input.value = ''; });
};
element('reset-sound').onclick = () => { void action(async () => { await save({ customSoundName: null }); success('已恢复默认提示音。'); }); };
volume.oninput = () => { element('volume-label').textContent = `${volume.value}%`; };
volume.onchange = () => { void action(() => save({ volume: Number(volume.value) })); };
element('test-sound').onclick = () => { void action(async () => { await request('TEST_SOUND', { play: true }); success('正在循环测试。听到后请点击“停止测试”。'); }); };
element('test-fault').onclick = () => { void action(async () => { await request('TEST_SOUND', { play: true, kind: 'fault' }); success('正在测试故障报警，请点击“停止测试”。'); }); };
element('stop-test').onclick = () => { void action(async () => { await request('TEST_SOUND', { play: false }); success('已停止测试；真实报警仍需单独消警。'); }); };
window.addEventListener('pagehide', () => { void request('TEST_SOUND', { play: false }).catch(() => undefined); });
void snapshot().then(data => { settings = data.settings; render(); }).catch(showError);
