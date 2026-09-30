"""Run the actual packaged ZXing WASM + candidate detector on private screenshots.
Never writes payloads to reports. Pass optional two screenshot paths as arguments.
Requires Vite running on localhost:5173.
"""
from pathlib import Path
import sys, json, base64
from playwright.sync_api import sync_playwright
from browser_runtime import executable

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'test-results' / 'detection'
OUT.mkdir(parents=True, exist_ok=True)
DEFAULTS = [
    ROOT / 'tests' / 'private' / 'sample1.png',
    ROOT / 'tests' / 'private' / 'sample2.png',
]
paths = [Path(x) for x in sys.argv[1:]] or DEFAULTS
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=executable(p))
    page = browser.new_page(viewport={'width': 900, 'height': 700})
    page.add_init_script('window.chrome={runtime:{onMessage:{addListener(){}},sendMessage:async()=>({ok:true})}}')
    page.goto('http://127.0.0.1:5173/offscreen.html')
    # offscreen module expects chrome APIs; use an independent detector import instead.
    page.wait_for_load_state('networkidle')
    reports = []
    for index, path in enumerate(paths):
        if not path.exists():
            raise FileNotFoundError('Private sample missing: pass screenshot paths explicitly')
        value = base64.b64encode(path.read_bytes()).decode('ascii')
        result = page.evaluate(r"""async ({image,index})=>{
          const {configureDecoder,detectCodes}=await import('/@fs/'+%ROOT%+'/src/detection/decoder.ts');
          const {EpisodeTracker}=await import('/@fs/'+%ROOT%+'/src/detection/episode.ts');
          configureDecoder('http://127.0.0.1:5173/wasm/zxing_reader.wasm');
          const bitmap=await createImageBitmap(await (await fetch('data:image/png;base64,'+image)).blob());
          const canvas=new OffscreenCanvas(1520,880),ctx=canvas.getContext('2d');
          ctx.drawImage(bitmap,32,126,1520,822,0,0,1520,822);
          const frame=ctx.getImageData(0,0,1520,822);
          const start=performance.now(),codes=await detectCodes(frame),duration=performance.now()-start;
          const tracker=new EpisodeTracker();
          let alarmAt=null;
          for(let time=0;time<=5000;time+=500){const r=tracker.update(codes,time,500,10,false);if(r.alarm&&alarmAt===null)alarmAt=time;}
          return{sample:index+1,decoded:codes.filter(c=>c.decoded).length,candidates:codes.filter(c=>!c.decoded).length,hosts:codes.filter(c=>c.decoded).map(c=>new URL(c.text).hostname),processingMs:Math.round(duration),alarmAtMs:alarmAt};
        }""".replace('%ROOT%', json.dumps(str(ROOT).replace('\\','/'))), {'image':value,'index':index})
        reports.append(result)
        print(json.dumps(result, ensure_ascii=False))
        assert result['decoded'] >= (2 if index == 0 else 1), result
        assert result['alarmAtMs'] is not None and result['alarmAtMs'] <= 5000, result
    (OUT / 'samples.json').write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding='utf-8')
    browser.close()
    print('Screenshot decoder: PASS (WASM, actual samples; timing is simulated frame cadence)')
