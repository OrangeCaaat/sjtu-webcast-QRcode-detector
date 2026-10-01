from pathlib import Path
import json,base64,sys
from playwright.sync_api import sync_playwright
from browser_runtime import executable
ROOT=Path(__file__).resolve().parent.parent
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=executable(p),args=['--autoplay-policy=no-user-gesture-required']);page=browser.new_page()
 page.add_init_script('window.chrome={runtime:{onMessage:{addListener(){}},sendMessage:async()=>({ok:true})}}');page.goto('http://127.0.0.1:5173/offscreen.html');page.wait_for_load_state('networkidle')
 page.evaluate("async()=>{const {configureDecoder}=await import('/src/detection/decoder.ts');configureDecoder('/wasm/zxing_reader.wasm');}")
 outputs=[]
 private_paths=[] if '--public-only' in sys.argv else sorted((ROOT/'tests/private/regression').glob('*.png'))
 for path in private_paths:
  raw=base64.b64encode(path.read_bytes()).decode()
  result=page.evaluate(r'''async ({image,name})=>{
   const {configureDecoder,detectCodes}=await import('/src/detection/decoder.ts');configureDecoder('/wasm/zxing_reader.wasm');
   const bitmap=await createImageBitmap(await(await fetch('data:image/png;base64,'+image)).blob());
   const crops=name.startsWith('manual')?[[336,309,1365,815],[0,0,bitmap.width,bitmap.height]]:[[40,154,1710,995],[40,208,1710,924],[0,0,bitmap.width,bitmap.height]];
   const results=[];
   for(const rect of crops){const scale=Math.min(1,1920/rect[2],1200/rect[3]);const c=new OffscreenCanvas(Math.round(rect[2]*scale),Math.round(rect[3]*scale));const ctx=c.getContext('2d');ctx.drawImage(bitmap,...rect,0,0,c.width,c.height);const codes=await detectCodes(ctx.getImageData(0,0,c.width,c.height));results.push({crop:rect,decoded:codes.filter(x=>x.decoded).length,candidates:codes.filter(x=>!x.decoded).length});}return results;
  }''',{'image':raw,'name':path.name})
  assert all(r['decoded']==0 and r['candidates']==0 for r in result),(path.name,result)
  outputs.append({'name':path.name,'results':result})
 # Public synthetic PPT text, rows and decorations must also stay quiet.
 for name in ['rows','text','border']:
  result=page.evaluate(r'''async name=>{
   const {detectCodes}=await import('/src/detection/decoder.ts');const c=new OffscreenCanvas(1280,720),ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
   ctx.fillStyle=name==='text'?'#073582':'#304533';if(name==='text')ctx.fillRect(0,0,c.width,c.height);
   if(name==='rows'){ctx.fillStyle='#c6d4cc';for(let i=0;i<5;i++)ctx.fillRect(45,150+i*95,1000-i*85,20);}
   else {ctx.fillStyle=name==='text'?'#fff':'#263e55';ctx.font='48px sans-serif';ctx.fillText('新学期 新气象',100,260);ctx.fillText('欢迎回到教学楼',300,460);}
   if(name==='border'){ctx.strokeStyle='#9f8858';ctx.lineWidth=10;ctx.strokeRect(30,30,1220,660);for(let i=0;i<8;i++){ctx.beginPath();ctx.arc(90+i*50,90,30,0,Math.PI*2);ctx.stroke();}}
   const codes=await detectCodes(ctx.getImageData(0,0,c.width,c.height));return codes.length;
  }''',name)
  assert result==0,(name,result)
  outputs.append({'synthetic':name,'detections':result})
 audio=page.evaluate(r'''async()=>{
  const Native=window.AudioContext;
  window.AudioContext=class extends Native{constructor(...args){super(...args);window.__audioProbe=this;const create=this.createGain.bind(this);this.createGain=()=>{const node=create();if(!this.analyser){this.analyser=this.createAnalyser();this.analyser.fftSize=1024;node.connect(this.analyser);const mute=create();mute.gain.value=0;this.analyser.connect(mute);mute.connect(this.destination);}return node;};}};
  const {SoundPlayer}=await import('/src/audio.ts');const errors=[],sound=new SoundPlayer(error=>errors.push(error));const settings={detectionIntervalMs:500,rearmSeconds:10,volume:100,autoOpen:false,customSoundName:null};
  const pause=ms=>new Promise(r=>setTimeout(r,ms));const peak=()=>{const data=new Float32Array(1024);window.__audioProbe.analyser.getFloatTimeDomainData(data);return Math.max(...data.map(Math.abs));};
  const maximum=async()=>{let best=0;for(let i=0;i<45;i++){await pause(10);best=Math.max(best,peak());}return best;};await sound.play('qr',settings);const qr=await maximum();sound.setVolume(0);await pause(70);const silent=peak();sound.stop();await sound.play('fault',settings);const fault=await maximum();sound.stop();await pause(70);const stopped=peak();await window.__audioProbe.close();window.AudioContext=Native;return {qrPeak:qr,faultPeak:fault,silentPeak:silent,stoppedPeak:stopped,errors};
 }''')
 assert audio['qrPeak']>.65 and audio['faultPeak']>.65,audio
 assert audio['silentPeak']<.001 and audio['stoppedPeak']<.001 and not audio['errors'],audio
 target=ROOT/'test-results/regression';target.mkdir(parents=True,exist_ok=True)
 (target/'result.json').write_text(json.dumps({'passed':True,'images':outputs,'audio':audio},ensure_ascii=False,indent=2),encoding='utf8')
 print(json.dumps({'passed':True,'privateNegativeCrops':sum(len(x.get('results',[])) for x in outputs),'syntheticScenes':3,'audio':audio},ensure_ascii=False))
 browser.close()
