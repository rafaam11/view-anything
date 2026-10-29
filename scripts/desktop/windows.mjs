import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { isolated, fixtures, until, delay, run, repo } from './common.mjs';
const root = isolated(), evidence = path.join(root,'evidence'); fs.mkdirSync(evidence,{recursive:true});
const ps = (action, extra=[], options={}) => run('powershell.exe',['-NoProfile','-File',path.join(repo,'scripts/desktop/windows.ps1'),'-Action',action,'-Root',root,...extra],options);
const files = fixtures(root), original = fs.readFileSync(files.txt), config = JSON.parse(fs.readFileSync(path.join(root,'config-0.0.1.json'),'utf8'));
const pkg = version => path.join(root,'packages',version,fs.readdirSync(path.join(root,'packages',version)).find(n=>n.endsWith('.exe')));
const target = pkg('0.0.2'), signature = fs.readFileSync(target+'.sig','utf8').trim();
const exe = path.join(root,'installed app','view-anything.exe');
const binaryMatches = version => createHash('sha256').update(fs.readFileSync(exe)).digest('hex')===fs.readFileSync(path.join(root,'packages',version,'binary.sha256'),'utf8');
let mode='offline', downloads=0, browser;
const errors=[], results=[];
const server=http.createServer((req,res)=>{
  if(mode==='offline'){res.writeHead(503);res.end();return;}
  if(req.url==='/latest.json'){
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({version:'0.0.2',notes:'isolated desktop fixture',pub_date:new Date().toISOString(),platforms:{'windows-x86_64':{url:'http://127.0.0.1:18761/update.exe',signature:mode==='bad-signature'?'invalid signature':signature}}}));
  }else if(req.url==='/update.exe'){downloads++;res.setHeader('Content-Length',fs.statSync(target).size);fs.createReadStream(target).pipe(res);}else{res.writeHead(404);res.end();}
});
const env={...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9239',WEBVIEW2_USER_DATA_FOLDER:path.join(root,'webview')};
const watch=p=>{p.on('pageerror',e=>errors.push(e.message));return p;};
const state=(p,name)=>p.waitForFunction(name=>document.querySelector('.va-update')?.dataset.state===name,name,{timeout:60000});
try {
  await new Promise(resolve=>server.listen(18761,'127.0.0.1',resolve));
  ps('snapshot');ps('install',['-Installer',pkg('0.0.1')]);ps('associations');results.push('silent NSIS install and registry associations');
  assert(binaryMatches('0.0.1'));
  spawn(exe,[],{env,windowsHide:true,stdio:'ignore'});
  browser=await until(()=>chromium.connectOverCDP('http://127.0.0.1:9239',{timeout:3000}),'WebView CDP');
  const context=await until(()=>browser.contexts().find(c=>c.pages().length>0),'initial WebView page');
  const first=watch(context.pages()[0]);await first.waitForFunction(()=>window.__TAURI__?.core);
  assert.equal(await first.evaluate(()=>window.__TAURI__.app.getVersion()),'0.0.1');await state(first,'error');
  // Real native updater must reject a damaged signature before reaching install-ready.
  mode='bad-signature';await first.keyboard.press('Control+Shift+u');await until(()=>downloads>0,'signed payload download');await state(first,'error');results.push('HTTP failure and invalid update signature rejected');
  mode='valid';await first.keyboard.press('Control+Shift+u');await state(first,'downloaded');
  const pages={};
  for(const ext of ['txt','png','pdf','pcd']){
    const a=config.bundle.fileAssociations.find(a=>a.ext.includes(ext));const opened=context.waitForEvent('page');ps('open',['-File',files[ext],'-Class',a.name]);const p=watch(await opened);pages[ext]=p;
    await p.locator(({txt:'.text-source',png:'.image-area img',pdf:'.pdf-root canvas',pcd:'.va3d canvas'})[ext]).waitFor();
    if(ext==='txt')assert.equal(await p.getByLabel('텍스트 내용').inputValue(),'원문 보존\nsecond line\n');
    if(ext==='png')await p.waitForFunction(()=>document.querySelector('.image-area img')?.naturalWidth===160);
    if(ext==='pdf')await p.getByText('needle desktop test',{exact:true}).waitFor();
    if(ext==='pcd')await p.waitForFunction(()=>document.querySelector('.va3d-status')?.textContent.includes('점 8'));
    await p.screenshot({path:path.join(evidence,`installed-${ext}.png`)});
  }
  results.push('ShellExecuteEx registered Open With for spaced/Korean TXT, PNG, PDF and PCD');
  const text=pages.txt;await text.getByRole('button',{name:'편집',exact:true}).click();await text.getByLabel('텍스트 내용').fill('unsaved update test\n');
  await first.getByRole('button',{name:'재시작',exact:true}).click();const dialog=first.locator('.va-update-dialog');await dialog.waitFor();await dialog.getByText('저장하지 않은 변경과 진행 중인 작업은 사라집니다. 저장하려면 취소하세요.',{exact:true}).waitFor();
  assert.equal(await text.locator('#app').getAttribute('inert'),'');
  await first.keyboard.press('Control+s');
  await text.keyboard.press('Control+s');await delay(200);assert.deepEqual(fs.readFileSync(files.txt),original);
  await text.evaluate(()=>window.dispatchEvent(new CustomEvent('va:open')));await dialog.getByRole('button',{name:'취소',exact:true}).click();await text.waitForFunction(()=>!document.getElementById('app').hasAttribute('inert'));
  assert.equal(await text.getByLabel('텍스트 내용').inputValue(),'unsaved update test\n');await text.keyboard.press('Control+s');await text.getByText('저장됨',{exact:true}).waitFor();const saved=fs.readFileSync(files.txt);assert.deepEqual(saved,Buffer.from('\ufeffunsaved update test\r\n'));
  results.push('multiwindow dirty warning, Ctrl+S/custom open blocked while frozen, cancel restores edits and saving');
  await first.screenshot({path:path.join(evidence,'before-update.png')});
  await first.getByRole('button',{name:'재시작',exact:true}).click();await first.locator('.va-update-dialog').getByRole('button',{name:'재시작',exact:true}).click();
  await until(()=>!browser.isConnected(),'old app exit',60000);await browser.close().catch(()=>{});browser=null;
  await until(()=>binaryMatches('0.0.2'),'updated installed binary hash',120000);
  await until(()=>String(ps('probe',[],{stdio:'pipe'})).trim().length>0,'installer automatically starts updated app',60000);
  // RunAsUser may launch through Explorer without inheriting WebView2 test arguments.
  // Reopen the updated binary with instrumentation after proving automatic startup.
  ps('stop');spawn(exe,[],{env,windowsHide:true,stdio:'ignore'});
  await until(async()=>{
    const b=await chromium.connectOverCDP('http://127.0.0.1:9239',{timeout:2000});
    try{const p=b.contexts()[0].pages()[0];const v=await p.evaluate(()=>window.__TAURI__.app.getVersion());if(v!=='0.0.2'){await b.close();return false;}browser=b;return true;}catch(e){await b.close();throw e;}
  },'updated app relaunches as 0.0.2',120000);
  const updated=watch(browser.contexts()[0].pages()[0]);await updated.screenshot({path:path.join(evidence,'after-update.png')});assert.deepEqual(fs.readFileSync(files.txt),saved);ps('associations');
  results.push('real signed NSIS update, installed binary hash, automatic startup, instrumented relaunch version; saved source and associations retained');
  await browser.close();browser=null;ps('uninstall');results.push('uninstall restores previous associations and removes installed binary');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify({ok:true,results,errors,limits:['Open With class invocation is tested; Windows UserChoice default-app UI is not changed.']},null,2));console.log(results.join('\nPASS '));
}catch(error){
  if(browser)for(const [i,p] of browser.contexts()[0].pages().entries())await p.screenshot({path:path.join(evidence,`failure-${i}.png`)}).catch(()=>{});
  fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify({ok:false,results,errors,error:String(error.stack??error)},null,2));throw error;
}finally{await browser?.close().catch(()=>{});ps('stop');server.close();}
