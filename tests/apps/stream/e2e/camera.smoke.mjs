import { resolveAppElectron } from '../../../../tool/app-electron.mjs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
process.chdir(fileURLToPath(new URL('../../../../', import.meta.url)));
const { _electron:electron,expect }=require('@playwright/test');
const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'stream-camera-ui-'));const bootstrap=path.join(root,'bootstrap.cjs');
 await fs.writeFile(bootstrap,`const {app}=require('electron');app.setPath('appData',${JSON.stringify(root)});require(${JSON.stringify(path.resolve('apps/stream/out/main/index.js'))});`);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
 const app=await electron.launch({executablePath:resolveAppElectron('stream').binaryPath,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',bootstrap],env});
 const errors=[];
 try{
  const page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
  const click=async locator=>{await locator.focus();await page.keyboard.press('Enter');};
  await click(page.getByRole('button',{name:'Add source',exact:true}));
  await click(page.getByRole('menuitem',{name:'Video Capture Device',exact:true}));
  await expect(page.getByRole('dialog')).toContainText('Select a camera');
  await expect(page.getByRole('checkbox',{name:'Capture audio',exact:true})).toBeChecked();
  await click(page.getByRole('combobox',{name:'Audio input',exact:true}));
  const option=page.getByRole('option').filter({hasNotText:'Select an audio input'}).first();
  await click(option);
  await click(page.locator('.device-picker-list button').first());
  const tracks=()=>page.evaluate(()=>Array.from(document.querySelectorAll('video')).filter(v=>v.srcObject instanceof MediaStream).map(v=>v.srcObject.getTracks().filter(t=>t.readyState==='live').map(t=>t.kind)));
  await expect.poll(tracks,{timeout:15000}).toContainEqual(expect.arrayContaining(['audio','video']));
  await page.getByRole('treeitem').first().dispatchEvent('contextmenu',{button:2});
  await click(page.getByRole('menuitem',{name:'Properties',exact:true}));
  const toggle=page.getByRole('checkbox',{name:'Capture audio',exact:true});
  await toggle.focus();await page.keyboard.press('Space');
  await expect.poll(tracks,{timeout:15000}).toEqual([['video']]);
  await toggle.focus();await page.keyboard.press('Space');
  await expect.poll(tracks,{timeout:15000}).toContainEqual(expect.arrayContaining(['audio','video']));
  await page.screenshot({path:path.join(root,'camera-audio.png')});
  if(errors.length)throw new Error(errors.join('\n'));
  console.log(JSON.stringify({passed:true,root,checks:['fake camera add','explicit audio input','audio/video tracks','audio disable keeps video','audio re-enable','no renderer errors']}));
 }catch(error){const page=(await app.windows())[0];console.log({root,error:String(error),errors});if(page){console.log(await page.locator('body').innerText());await page.screenshot({path:path.join(root,'failure.png')});}throw error;}
 finally{const child=app.process();let timer;await Promise.race([app.close(),new Promise(resolve=>{timer=setTimeout(()=>{child.kill();resolve();},5000);})]);clearTimeout(timer);}
})().catch(error=>{console.error(error);process.exitCode=1;});
