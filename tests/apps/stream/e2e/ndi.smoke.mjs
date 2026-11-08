import { resolveAppElectron } from '../../../../tool/app-electron.mjs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
process.chdir(fileURLToPath(new URL('../../../../', import.meta.url)));
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
if (process.env.NDI_LOCAL_LOOPBACK_TEST !== '1') { console.log('NDI UI smoke skipped: set NDI_LOCAL_LOOPBACK_TEST=1 after building the addon and installing the NDI Runtime.'); process.exit(0); }
(async () => {
 const sourceName=`LumaStream UI Pattern ${process.pid}`;
 const fixture=require('node:child_process').spawn(process.execPath,[path.resolve('tests/apps/stream/e2e/ndi-source.cjs'),sourceName],{stdio:['pipe','pipe','pipe']});
 fixture.stderr.on('data',data=>console.log('SOURCE',String(data)));
 await new Promise((resolve,reject)=>{fixture.stdout.once('data',resolve);fixture.once('error',reject);fixture.once('exit',code=>reject(new Error(`Fixture exited ${code}`)));});
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stream-ndi-ui-'));
 const bootstrap = path.join(root, 'bootstrap.cjs');
 await fs.writeFile(bootstrap, `const fs=require('node:fs');const {app,ipcMain}=require('electron');app.setPath('appData',${JSON.stringify(root)});const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(channel,listener)=>handle(channel,async(event,...args)=>{const trace=channel==='stream:ndi-start-send'||channel==='stream:ndi-stop-send';if(trace)fs.appendFileSync(${JSON.stringify(path.join(root,'ndi-ipc.log'))},JSON.stringify({phase:'request',channel,args})+'\\n');try{const result=await listener(event,...args);if(channel==='stream:ndi-start-send')fs.appendFileSync(${JSON.stringify(path.join(root,'ndi-ipc.log'))},JSON.stringify({phase:'result',channel,result})+'\\n');return result;}catch(error){if(trace)fs.appendFileSync(${JSON.stringify(path.join(root,'ndi-ipc.log'))},JSON.stringify({phase:'error',channel,error:String(error)})+'\\n');throw error;}});require(${JSON.stringify(path.resolve('apps/stream/out/main/index.js'))});`);
 const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
 const app = await electron.launch({ executablePath: resolveAppElectron('stream').binaryPath, args:[bootstrap], env, timeout:30000 }).catch(error=>{fixture.stdin.end('stop');throw error;});
 const errors=[];

 app.process().stderr.on('data',data=>console.log('APP',String(data)));
 try {
  const page = await app.firstWindow();
  const click=async(locator)=>{await locator.focus();await page.keyboard.press('Enter');};
  await page.bringToFront();
  page.on('pageerror', error => errors.push(error.message));

  await page.getByRole('button', { name:'NDI output', exact:true }).waitFor({timeout:30000});
  await page.evaluate(()=>{window.__audio=[];const Original=window.AudioContext;window.AudioContext=class extends Original{constructor(...args){super(...args);window.__audio.push(this);this.debug={starts:0,peak:0};const make=this.createBufferSource.bind(this);this.createBufferSource=()=>{const node=make();const start=node.start.bind(node);node.start=(...params)=>{this.debug.starts++;for(const n of node.buffer?.getChannelData(0)??[])this.debug.peak=Math.max(this.debug.peak,Math.abs(n));return start(...params);};return node;};}};});
  await click(page.getByRole('button', { name:'NDI output', exact:true }));
  await expect(page.getByRole('dialog')).toContainText('NDI Program output');
  await page.getByLabel('NDI name').fill(`LumaStream UI Smoke ${process.pid}`);
  await click(page.getByRole('button', { name:'Start NDI output', exact:true }));
  await page.waitForTimeout(1500);
  await expect(page.getByRole('status').filter({hasText:'Broadcasting Program over NDI'})).toBeVisible({timeout:20000});
  await page.screenshot({path:path.join(root,'output-active.png')});
  await click(page.getByRole('button', { name:'Stop NDI output', exact:true }));
  await expect(page.getByRole('status').filter({hasText:'NDI output stopped'})).toBeVisible();
  await click(page.getByRole('button', {name:'Start NDI output',exact:true}));
  await expect(page.getByRole('status').filter({hasText:'Broadcasting Program over NDI'})).toBeVisible({timeout:20000});
  await click(page.getByRole('button',{name:'Stop NDI output',exact:true}));
  await expect(page.getByRole('status').filter({hasText:'NDI output stopped'})).toBeVisible();
  await page.keyboard.press('Escape');
  await click(page.getByRole('button',{name:'Add source',exact:true}));
  await click(page.getByRole('menuitem',{name:'NDI Source',exact:true}));
  await expect(page.getByRole('dialog')).toContainText('Add NDI source');
  await page.getByRole('button',{name:'Refresh sources',exact:true}).waitFor({timeout:20000});
  await page.screenshot({path:path.join(root,'source-discovery.png')});

  console.log('IPC FRAMES',await page.evaluate(async(sourceName)=>{
    const api=window.streamApi.ndi;const source=(await api.discover()).find(s=>s.name.includes(sourceName));
    const id=await api.startReceive(source,true);const counts={video:0,audio:0,empty:0,samples:0,peak:0};const end=Date.now()+5000;
    try{while(Date.now()<end){const frame=await api.readFrame(id);if(!frame){counts.empty++;await new Promise(r=>setTimeout(r,8));}else{counts[frame.kind]++;if(frame.kind==='audio'){counts.samples+=frame.samplesPerChannel;for(const v of frame.data)counts.peak=Math.max(counts.peak,Math.abs(v));}}}}finally{await api.stopReceive(id);}return counts;
  },sourceName));
  await click(page.getByRole('button',{name:'Refresh sources',exact:true}));
  await click(page.getByRole('button',{name:new RegExp(sourceName)}));

  await expect.poll(()=>page.evaluate(()=>Array.from(document.querySelectorAll('canvas')).some(canvas=>{
    const ctx=canvas.getContext('2d');if(!ctx||!canvas.width||!canvas.height)return false;
    const p=ctx.getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data;
    return p[0]>200&&p[1]<40&&p[2]<40;
  })),{timeout:20000}).toBe(true);
  await expect.poll(()=>page.evaluate(()=>Array.from(document.querySelectorAll('video')).some(video=>video.srcObject instanceof MediaStream&&video.srcObject.getAudioTracks().some(track=>track.readyState==='live'))),{timeout:15000}).toBe(true);
  await expect.poll(()=>page.locator('.source-level-mini i').evaluateAll(elements=>elements.some(el=>parseFloat(el.style.width)>0)),{timeout:15000}).toBe(true);
  const before=await page.evaluate(()=>window.__audio.reduce((sum,ctx)=>sum+ctx.debug.starts,0));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].minimize());
  await page.waitForTimeout(4000);
  const after=await page.evaluate(()=>window.__audio.reduce((sum,ctx)=>sum+ctx.debug.starts,0));
  if(after-before<40)throw new Error(`Audio did not continue while minimized: ${after-before} buffers in 4s`);
  await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.restore();win.show();});
  fixture.stdin.write('pause\n');
  await expect(page.locator('.source-availability')).toContainText('Unavailable',{timeout:10000});
  await expect.poll(()=>page.evaluate(()=>Array.from(document.querySelectorAll('canvas.composition-canvas')).every(canvas=>{const p=canvas.getContext('2d').getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data;return !(p[0]>200&&p[1]<40&&p[2]<40);})),{timeout:10000}).toBe(true);
  fixture.stdin.write('resume\n');
  await expect.poll(()=>page.evaluate(()=>Array.from(document.querySelectorAll('canvas.composition-canvas')).some(canvas=>{const p=canvas.getContext('2d').getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data;return p[0]>200&&p[1]<40&&p[2]<40;})),{timeout:10000}).toBe(true);
  await page.screenshot({path:path.join(root,'input-active.png')});
  await page.getByRole('treeitem').filter({hasText:sourceName}).dispatchEvent('contextmenu',{button:2});
  await click(page.getByRole('menuitem',{name:'Properties',exact:true}));
  await page.getByRole('checkbox',{name:'Capture audio',exact:true}).focus();await page.keyboard.press('Space');
  await expect.poll(()=>page.evaluate(()=>Array.from(document.querySelectorAll('video')).filter(video=>video.srcObject instanceof MediaStream).every(video=>!video.srcObject.getAudioTracks().some(track=>track.readyState==='live'))),{timeout:15000}).toBe(true);
  await page.getByRole('checkbox',{name:'Capture audio',exact:true}).focus();await page.keyboard.press('Space');
  await expect.poll(()=>page.locator('.source-level-mini i').evaluateAll(elements=>elements.some(el=>parseFloat(el.style.width)>0)),{timeout:15000}).toBe(true);
  if(errors.length) throw new Error(errors.join('\n'));
  await click(page.getByRole('button',{name:'Close properties',exact:true}));
  await click(page.getByRole('button',{name:'NDI output',exact:true}));
  const outputName=`LumaStream UI Roundtrip ${process.pid}`;
  await page.getByLabel('NDI name').fill(outputName);
  await click(page.getByRole('button',{name:'Start NDI output',exact:true}));
  await expect(page.getByRole('status').filter({hasText:'Broadcasting Program over NDI'})).toBeVisible({timeout:20000});
  const localOutputSources=await page.evaluate(()=>window.streamApi.ndi.discover());
  console.log('PROGRAM LOCAL DISCOVERY',JSON.stringify(localOutputSources));
  const probe=await new Promise((resolve,reject)=>require('node:child_process').execFile(process.execPath,[path.resolve('tests/apps/stream/e2e/ndi-receiver.cjs'),outputName],{timeout:30000},(error,stdout,stderr)=>error?reject(new Error(`${error}\n${stdout}\n${stderr}`)):resolve(stdout)));
  console.log('PROGRAM ROUNDTRIP',probe.trim());
  await click(page.getByRole('button',{name:'Stop NDI output',exact:true}));
  await expect(page.getByRole('status').filter({hasText:'NDI output stopped'})).toBeVisible();
  console.log(JSON.stringify({passed:true,root,minimizedAudioBuffers:after-before,checks:['output start','output stop','output restart','source discovery','input video','input audio meter','audio disable/enable','minimized audio','signal loss/recovery','no renderer errors']}));
 } catch(error) {
  const page = (await app.windows())[0];

  if(page) { await page.screenshot({path:path.join(root,'failure.png')}); console.error((await page.locator('body').innerText()).slice(-12000)); console.log('AUDIO',JSON.stringify(await page.evaluate(()=>({contexts:window.__audio?.map(ctx=>({state:ctx.state,time:ctx.currentTime,sampleRate:ctx.sampleRate,debug:ctx.debug})),meters:Array.from(document.querySelectorAll('.source-level-mini')).map(el=>el.outerHTML)})))); }
  console.log('NDI IPC TRACE',await fs.readFile(path.join(root,'ndi-ipc.log'),'utf8').catch(()=>'<none>'));
  console.error({root,errors,error:String(error)}); throw error;
 } finally { fixture.stdin.end('stop');const child=app.process();let timer;await Promise.race([app.close(),new Promise(resolve=>{timer=setTimeout(()=>{child.kill();resolve();},5000);})]);clearTimeout(timer); }
})().catch(error=>{console.error(error);process.exitCode=1;});
