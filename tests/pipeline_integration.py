"""Real packaged MV3 pipeline with explicitly synthetic media.
The isolated test copy has localhost host permission; tabCapture's gesture gate
and getUserMedia are substituted. It proves messaging/decoder/alarm behavior,
NOT actual browser capture or minimized-window/authenticated-site reliability.
"""
from pathlib import Path
import json, shutil, time, os
from playwright.sync_api import sync_playwright
from browser_runtime import executable, wait_truthy

ROOT = Path(__file__).resolve().parent.parent
STAMP = str(int(time.time()))
EXT = ROOT / 'temp' / 'pipeline' / STAMP / 'extension'
OUT = ROOT / 'test-results' / 'pipeline'
OUT.mkdir(parents=True, exist_ok=True)
shutil.copytree(ROOT / 'dist', EXT)
manifest_path = EXT / 'manifest.json'
manifest = json.loads(manifest_path.read_text(encoding='utf8'))
manifest['host_permissions'] = ['http://127.0.0.1/*']
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False), encoding='utf8')

with sync_playwright() as p:
    context = p.chromium.launch_persistent_context(str(EXT.parent / 'profile'), executable_path=executable(p), headless=True,
        args=['--disable-extensions-except='+str(EXT), '--load-extension='+str(EXT)], viewport={'width':1280,'height':900})
    try:
        context.route('https://example.org/**', lambda route: route.fulfill(status=200, content_type='text/html', body='<title>Synthetic QR destination</title>Fixture destination'))
        sw = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
        ext_id = sw.url.split('/')[2]
        fixture = context.pages[0]
        fixture.goto('http://127.0.0.1:5173/@fs/' + str(ROOT / 'tests' / 'fixtures' / 'live.html').replace('\\','/'))
        fixture.wait_for_function("Array.from(document.images).length===0")
        # Preload a genuine offscreen document. Only media acquisition is substituted.
        sw.evaluate("chrome.offscreen.createDocument({url:'offscreen.html',reasons:['USER_MEDIA','AUDIO_PLAYBACK','WORKERS','BLOBS'],justification:'Synthetic integration test'})")
        sw.evaluate("chrome.tabCapture.getMediaStreamId=async()=> 'synthetic-test-stream'")
        cdp = context.browser.new_browser_cdp_session()
        targets = cdp.send('Target.getTargets')['targetInfos']
        target = next(t for t in targets if t['url'] == f'chrome-extension://{ext_id}/offscreen.html')
        session = cdp.send('Target.attachToTarget', {'targetId':target['targetId'], 'flatten':False})['sessionId']
        responses = {}
        cdp.on('Target.receivedMessageFromTarget', lambda event: responses.update({json.loads(event['message']).get('id'):json.loads(event['message'])}))
        call_id = 0
        def offscreen_eval(expression):
            global call_id
            call_id += 1
            cdp.send('Target.sendMessageToTarget', {'sessionId':session, 'message':json.dumps({'id':call_id,'method':'Runtime.evaluate','params':{'expression':expression,'returnByValue':True,'awaitPromise':True}})})
            deadline = time.monotonic()+10
            while call_id not in responses and time.monotonic()<deadline:
                fixture.wait_for_timeout(50)
            assert call_id in responses, 'offscreen CDP timed out'
            response=responses.pop(call_id)
            assert 'exceptionDetails' not in response.get('result',{}), response
            return response.get('result',{}).get('result',{}).get('value')
        offscreen_eval("""window.__captureCanvas=document.createElement('canvas');__captureCanvas.width=1280;__captureCanvas.height=900;window.__sourceImage=null;window.__failCapture=false;
          setInterval(()=>{const ctx=__captureCanvas.getContext('2d');ctx.fillStyle='#eff3f0';ctx.fillRect(0,0,1280,900);if(__sourceImage)ctx.drawImage(__sourceImage,30,60,1000,600);ctx.fillStyle='#203243';ctx.fillText(Date.now(),5,890);},40);
          navigator.mediaDevices.getUserMedia=async()=>{if(__failCapture)throw new Error('synthetic fault');window.__stream=__captureCanvas.captureStream(20);return __stream;};true""")
        popup=context.new_page();popup.goto(f'chrome-extension://{ext_id}/popup.html');popup.wait_for_load_state('networkidle')
        def request(type, **payload):
            reply=popup.evaluate('m=>chrome.runtime.sendMessage({target:"background",...m})', {'type':type, **payload})
            assert reply.get('ok'), reply
            return reply.get('data')
        options=request('GET_SNAPSHOT')['settings'];options.update({'rearmSeconds':1,'autoOpen':True})
        request('SAVE_SETTINGS',settings=options)
        fixture.bring_to_front();request('SELECT_REGION')
        fixture.locator('#webcast-monitor-widget').wait_for(state='visible')
        fixture.mouse.move(30,60);fixture.mouse.down();fixture.mouse.move(1030,660);fixture.mouse.up()
        wait_truthy(popup,"chrome.storage.session.get('state').then(s=>s.state?.health==='monitoring')",timeout=10000)
        def source():
            image=fixture.locator('#screen').evaluate('(c)=>c.toDataURL()')
            offscreen_eval('new Promise(r=>{const i=new Image();i.onload=()=>{window.__sourceImage=i;r(true)};i.src='+json.dumps(image)+'})')
        source()
        # More than 30 seconds of silence verifies this USER_MEDIA document stays alive.
        quiet_start=time.monotonic()
        quiet_seconds = 2 if os.environ.get('WEBCAST_QUICK_TEST') else 35
        while time.monotonic()-quiet_start<quiet_seconds:
            fixture.wait_for_timeout(1000)
        quiet=request('GET_SNAPSHOT')['state'];assert quiet['health']=='monitoring' and not quiet['alarms'],quiet
        fixture.locator('#show').click();fixture.wait_for_timeout(100);source();start=time.monotonic()
        wait_truthy(popup,"chrome.storage.session.get('state').then(s=>s.state?.alarms.includes('qr')&&s.state?.codes.filter(c=>c.decoded).length===2)",timeout=5000)
        elapsed=round((time.monotonic()-start)*1000)
        # No tabs permission in production: inspect test-browser targets, not restricted tab URLs.
        deadline = time.monotonic() + 10
        while len([page for page in context.pages if page.url.startswith('https://example.org/course')]) < 2 and time.monotonic() < deadline:
            popup.wait_for_timeout(100)
        assert len([page for page in context.pages if page.url.startswith('https://example.org/course')]) == 2
        before=request('GET_SNAPSHOT')['state']
        print('after-open',json.dumps({k:before[k] for k in ('health','qrPresent','detail','alarms')},ensure_ascii=False),flush=True)
        assert before['qrPresent']
        request('ACK_ALARMS');assert not request('GET_SNAPSHOT')['state']['alarms']
        fixture.locator('#refresh').click();fixture.wait_for_timeout(100);source();fixture.wait_for_timeout(1800)
        assert len([page for page in context.pages if page.url.startswith('https://example.org/course')])==2
        assert not request('GET_SNAPSHOT')['state']['alarms']
        fixture.locator('#hide').click();fixture.wait_for_timeout(100);source();cooldown_start=time.monotonic()
        wait_truthy(popup,"chrome.storage.session.get('state').then(s=>s.state?.health==='monitoring'&&!s.state.qrPresent)",timeout=5000)
        cooldown_elapsed=round((time.monotonic()-cooldown_start)*1000)
        fixture.locator('#show').click();fixture.wait_for_timeout(100);source()
        wait_truthy(popup,"chrome.storage.session.get('state').then(s=>s.state?.alarms.includes('qr'))",timeout=5000)
        request('ACK_ALARMS')
        offscreen_eval("window.__failCapture=true;window.__stream.getTracks().forEach(t=>t.stop());true")
        wait_truthy(popup,"chrome.storage.session.get('state').then(s=>s.state?.health==='error'&&s.state?.alarms.includes('fault'))",timeout=18000)
        request('ACK_ALARMS');assert request('GET_SNAPSHOT')['state']['health']=='error'
        offscreen_eval('window.__failCapture=false;true');request('RETRY')
        wait_truthy(popup,"chrome.storage.session.get('state').then(s=>s.state?.health==='monitoring')",timeout=10000)
        fixture.close()
        wait_truthy(popup,"chrome.storage.session.get('state').then(s=>s.state?.fatalError&&s.state?.health==='error')",timeout=5000)
        popup.wait_for_timeout(1500);assert request('GET_SNAPSHOT')['state']['health']=='error'
        request('STOP');assert request('GET_SNAPSHOT')['state']['health']=='stopped'
        result={'passed':True,'browser':context.browser.version,'quietSeconds':quiet_seconds,'actualPipelineAlarmMs':elapsed,'cooldownRestoreMs':cooldown_elapsed,'checks':11,'scope':'Synthetic media + test-only localhost permission. No real tabCapture/occlusion/minimization/SJTU acceptance.'}
        (OUT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
        print(json.dumps(result,ensure_ascii=False))
    finally:
        context.close()
