"""Real MV3 package, storage, offscreen audio and page-selection tests.
Headless automation cannot invoke activeTab via a real toolbar click; tabCapture
and the full QR-to-alarm path are intentionally not claimed by this test.
"""
from pathlib import Path
import json, time
from playwright.sync_api import sync_playwright
from browser_runtime import executable, wait_truthy

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'test-results' / 'extension'
OUT.mkdir(parents=True, exist_ok=True)
PROFILE = ROOT / 'temp' / 'extension-smoke' / str(time.time_ns())
with sync_playwright() as p:
    context = p.chromium.launch_persistent_context(str(PROFILE), executable_path=executable(p), headless=True,
        args=['--disable-extensions-except=' + str(ROOT / 'dist'), '--load-extension=' + str(ROOT / 'dist')], viewport={'width':1280,'height':900})
    errors = []
    try:
        worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
        extension_id = worker.url.split('/')[2]
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(f'chrome-extension://{extension_id}/popup.html')
        wait_truthy(page,"document.querySelector('#status').textContent==='已停止'")
        page.wait_for_timeout(300)
        assert page.locator('#error').is_hidden(), page.locator('#error').inner_text()
        page.locator('input[name=interval][value="1000"]').check()
        wait_truthy(page, "chrome.storage.local.get('settings').then(s=>s.settings?.detectionIntervalMs===1000)")
        page.locator('#rearm').fill('3')
        page.locator('#auto-open').focus()
        wait_truthy(page, "chrome.storage.local.get('settings').then(s=>s.settings?.rearmSeconds===3)")
        page.locator('#test-sound').click()
        page.wait_for_timeout(500)
        contexts = worker.evaluate('chrome.runtime.getContexts({})')
        assert any(c['contextType'] == 'OFFSCREEN_DOCUMENT' for c in contexts), contexts
        page.locator('#stop-test').click()
        settings_page = context.new_page()
        settings_page.on('pageerror', lambda error: errors.append(str(error)))
        settings_page.goto(f'chrome-extension://{extension_id}/settings.html')
        settings_page.wait_for_load_state('networkidle')
        assert settings_page.locator('#error').is_hidden()
        settings_page.locator('#sound-file').set_input_files({'name':'broken.mp3','mimeType':'audio/mpeg','buffer':b'not audio'})
        wait_truthy(settings_page,"document.querySelector('#error').textContent.includes('无法解码')")
        assert settings_page.locator('#sound-name').inner_text() == '默认提示音'
        # Validate content-script geometry and lifecycle using a deterministic runtime shim.
        fixture = context.new_page()
        fixture.goto('http://127.0.0.1:5173/@fs/' + str(ROOT / 'tests' / 'fixtures' / 'live.html').replace('\\','/'))
        fixture.evaluate("window.__listener=null;window.__sent=[];window.chrome={runtime:{onMessage:{addListener(fn){window.__listener=fn}},sendMessage:async m=>{window.__sent.push(m);return{ok:true}}}}")
        fixture.add_script_tag(path=str(ROOT / 'dist' / 'content.js'))
        region = fixture.evaluate("new Promise(r=>window.__listener({target:'content',type:'PREPARE',sessionId:'geometry'},null,r))")['data']['region']
        assert region['valid'] and region['width'] == 1000 and region['height'] == 600, region
        fixture.evaluate("window.__listener({target:'content',type:'STATE',sessionId:'geometry',state:{health:'monitoring',qrPresent:false,alarms:[],detail:'正在检测'}},null,()=>{})")
        fixture.evaluate("window.__listener({target:'content',type:'SELECT',sessionId:'geometry'},null,()=>{})")
        fixture.mouse.move(80,110);fixture.mouse.down();fixture.mouse.move(600,500);fixture.mouse.up()
        wait_truthy(fixture,"window.__sent.some(m=>m.type==='REGION_SELECTED')")
        selected = fixture.evaluate("window.__sent.find(m=>m.type==='REGION_SELECTED').region")
        assert selected['manual'] and selected['valid'], selected
        fixture.set_viewport_size({'width':1100,'height':850})
        invalid = fixture.evaluate("new Promise(r=>window.__listener({target:'content',type:'GET_REGION',sessionId:'geometry'},null,r))")['data']
        assert not invalid['valid'] and '重新框选' in invalid['reason'], invalid
        fixture.evaluate("window.__listener({target:'content',type:'STATE',sessionId:'geometry',state:{health:'stopped',qrPresent:false,alarms:[],detail:'已停止'}},null,()=>{})")
        assert fixture.locator('#webcast-monitor-widget').is_hidden()
        assert not errors, errors
        worker.evaluate('chrome.storage.local.set({interrupted:true})')
        context.close()
        context = p.chromium.launch_persistent_context(str(PROFILE), executable_path=executable(p), headless=True,
            args=['--disable-extensions-except=' + str(ROOT / 'dist'), '--load-extension=' + str(ROOT / 'dist')], viewport={'width':1280,'height':900})
        restored = context.new_page(); restored.goto(f'chrome-extension://{extension_id}/popup.html')
        wait_truthy(restored,"document.querySelector('#status').textContent==='出现问题'")
        assert '异常结束' in restored.locator('#detail').inner_text()
        assert restored.locator('#retry').is_hidden()
        (OUT / 'result.json').write_text(json.dumps({'passed': True, 'browser': context.browser.version, 'checks': 14, 'limits':'No genuine toolbar invocation, tabCapture or authenticated SJTU test', 'page_errors':errors}, ensure_ascii=False, indent=2), encoding='utf8')
        print('Extension smoke: PASS (MV3, storage, offscreen, import, selection, restart; 14 checks)')
    finally:
        context.close()
