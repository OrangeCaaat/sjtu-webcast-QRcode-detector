"""Control panel interactions, with a deterministic browser-API stub.
Run through with_server.py against Vite dev server. This is not a tabCapture test.
"""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright
from browser_runtime import executable

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'test-results' / 'ui'
OUT.mkdir(parents=True, exist_ok=True)
STUB = r"""
window.__messages=[];
window.__settings={detectionIntervalMs:500,rearmSeconds:10,volume:70,autoOpen:false,customSoundName:null};
window.__state={sessionId:null,tabId:null,title:'',health:'stopped',qrPresent:false,alarms:[],codes:[],detail:'选择直播标签页，开始监控。',region:null,lastFrameAt:0,lastHeartbeatAt:0,retrySince:null};
window.chrome={runtime:{openOptionsPage:async()=>{},sendMessage:async msg=>{
 window.__messages.push(msg);
 if(msg.type==='GET_SNAPSHOT')return{ok:true,data:{settings:window.__settings,state:window.__state}};
 if(msg.type==='SAVE_SETTINGS'){window.__settings=msg.settings;return{ok:true,data:msg.settings}};
 if(msg.type==='START'){Object.assign(window.__state,{sessionId:'test',health:'monitoring',lastFrameAt:Date.now(),detail:'正在检测直播画面。'});return{ok:true,data:{selecting:false}}};
 if(msg.type==='STOP')Object.assign(window.__state,{sessionId:null,health:'stopped',alarms:[],codes:[],qrPresent:false});
 if(msg.type==='ACK_ALARMS')window.__state.alarms=[];
 return{ok:true,data:true};
}}};
"""
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=executable(p))
    page = browser.new_page(viewport={'width': 460, 'height': 1080})
    page.add_init_script(STUB)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto('http://127.0.0.1:5173/popup.html')
    page.wait_for_load_state('networkidle')
    assert page.locator('#status').inner_text() == '已停止'
    assert page.locator('input[name=interval]:checked').input_value() == '500'
    for value in ('250', '500', '1000', '2000'):
        page.locator(f'input[name=interval][value="{value}"]').check()
        page.wait_for_function(f'window.__settings.detectionIntervalMs==={value}')
    page.locator('#rearm').fill('0')
    page.locator('#auto-open').focus()
    assert '1–300' in page.locator('#error').inner_text()
    assert page.locator('#rearm').input_value() == '10'
    page.locator('#rearm').fill('27')
    page.locator('#auto-open').focus()
    page.wait_for_function('window.__settings.rearmSeconds===27')
    page.locator('#auto-open').check()
    page.wait_for_function('window.__settings.autoOpen===true')
    page.locator('#start').click()
    page.wait_for_function("document.querySelector('#status').textContent==='监控中'")
    page.evaluate("Object.assign(window.__state,{qrPresent:true,alarms:['qr'],codes:[{id:1,text:'https://example.com/a?token=test',decoded:true,opened:false}],detail:'检测到二维码。'})")
    page.wait_for_function("document.querySelector('#status').textContent==='检测到二维码'")
    page.screenshot(path=str(OUT / 'popup.png'), full_page=True)
    page.locator('#ack').click()
    page.wait_for_function('window.__state.alarms.length===0')
    assert page.locator('#status').inner_text() == '检测到二维码'
    assert page.evaluate('window.__state.sessionId') == 'test'
    page.get_by_role('button', name='后台打开', exact=True).click()
    assert page.evaluate("window.__messages.some(m=>m.type==='OPEN_CODE'&&m.id===1)")
    page.locator('#stop').click()
    page.wait_for_function("document.querySelector('#status').textContent==='已停止'")
    page.locator('#test-sound').click()
    page.locator('#stop-test').click()
    assert page.evaluate("window.__messages.some(m=>m.type==='TEST_SOUND'&&m.play===true)")
    assert page.evaluate("window.__messages.some(m=>m.type==='TEST_SOUND'&&m.play===false)")
    settings = browser.new_page(viewport={'width': 900, 'height': 1100})
    settings.add_init_script(STUB)
    settings.on('pageerror', lambda error: errors.append(str(error)))
    settings.goto('http://127.0.0.1:5173/settings.html')
    settings.wait_for_load_state('networkidle')
    settings.screenshot(path=str(OUT / 'settings.png'), full_page=True)
    settings.locator('#sound-file').set_input_files({'name': 'bad.mp3', 'mimeType': 'audio/mpeg', 'buffer': b'invalid audio'})
    settings.wait_for_function("document.querySelector('#error').textContent.includes('无法解码')")
    assert settings.locator('#sound-name').inner_text() == '默认提示音'
    assert not errors, errors
    (OUT / 'result.json').write_text(json.dumps({'passed': True, 'checks': 16, 'page_errors': errors}, ensure_ascii=False, indent=2), encoding='utf-8')
    print('UI smoke: PASS (16 checks, no page errors)')
    browser.close()
