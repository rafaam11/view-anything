import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { isolated, fixtures, until, delay, run } from './common.mjs';
const root=isolated(),evidence=path.join(root,'evidence');fs.mkdirSync(evidence,{recursive:true});
const files=fixtures(root),original=fs.readFileSync(files.txt),packages=path.join(root,'packages/0.0.2'),entries=fs.readdirSync(packages),deb=path.join(packages,entries.find(n=>n.endsWith('.deb'))),appimage=path.join(packages,entries.find(n=>n.endsWith('.AppImage')));
const name=run('dpkg-deb',['--field',deb,'Package'],{stdio:'pipe'}).trim(),results=[],errors=[];
let session,driver;
const request=async(method,route,body)=>{
  const response=await fetch('http://127.0.0.1:4444'+route,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
  const json=await response.json();if(!response.ok||json.value?.error)throw Error(JSON.stringify(json));return json.value;
};
const cmd=(route,body)=>request('POST',`/session/${session}`+route,body);
const js=(script,...args)=>cmd('/execute/sync',{script,args});
const asyncJs=(script,...args)=>cmd('/execute/async',{script:`const done=arguments[arguments.length-1]; Promise.resolve((async()=>{${script}})()).then(value=>done({value}),error=>done({error:String(error)}));`,args}).then(result=>{if(result.error)throw Error(result.error);return result.value;});
const wait=expression=>until(()=>js(`return ${expression}`),expression);
const click=label=>js('const b=[...document.querySelectorAll("button")].find(b=>(b.getAttribute("aria-label")??b.textContent)===arguments[0]);if(!b)throw Error("Button not found: "+arguments[0]);b.click();return true;',label);
const key=(key,extras={})=>js('const k=arguments[0],code=/^[a-z]$/i.test(k)?"Key"+k.toUpperCase():/^[0-9]$/.test(k)?"Digit"+k:k;const e=new KeyboardEvent("keydown",{key:k,code,bubbles:true,cancelable:true,...arguments[1]});(document.activeElement??window).dispatchEvent(e);return true;',key,extras);
const screenshot=async label=>{const png=await request('GET',`/session/${session}/screenshot`);fs.writeFileSync(path.join(evidence,label+'.png'),Buffer.from(png,'base64'));};
async function start(binary,file){
  const s=await request('POST','/session',{capabilities:{alwaysMatch:{'tauri:options':{application:binary,args:[file]}}}});session=s.sessionId;
  await cmd('/timeouts',{script:60000});await wait('window.__TAURI__?.core != null');
  await js('window.__desktopErrors=[];window.addEventListener("error",e=>window.__desktopErrors.push(e.message));');
}
async function stop(){if(session){await request('DELETE',`/session/${session}`).catch(()=>{});session=null;}}
async function collect(){errors.push(...await js('return window.__desktopErrors??[]'));}
try{
  run('sudo',['dpkg','-i',deb]);const installed=run('dpkg',['-L',name],{stdio:'pipe'}).split('\n').find(p=>p.startsWith('/usr/bin/')&&fs.existsSync(p)&&fs.statSync(p).isFile());assert(installed);
  driver=spawn('tauri-driver',[],{stdio:['ignore',fs.openSync(path.join(evidence,'driver.log'),'a'),fs.openSync(path.join(evidence,'driver-errors.log'),'a')]});await until(()=>request('GET','/status'),'tauri-driver startup');
  for(const [format,binary] of [['deb',installed],['appimage',appimage]]){
    if(format==='appimage')fs.chmodSync(binary,0o755);await start(binary,files.txt);await wait('document.querySelector(".text-source")?.value.includes("원문 보존")');
    await click('편집');await wait('document.querySelector(".text-source")?.readOnly === false');
    await js('const e=document.querySelector(".text-source");e.value="Linux edited\\nsecond line\\n";e.dispatchEvent(new Event("input",{bubbles:true}));');await key('s',{ctrlKey:true});await wait('document.querySelector("[role=status]")?.textContent==="저장됨"');
    assert.deepEqual(fs.readFileSync(files.txt),Buffer.from('\ufeffLinux edited\r\nsecond line\r\n'));fs.writeFileSync(files.txt,original);
    await key(',',{ctrlKey:true});await wait('document.querySelector(".va-settings[open]") != null');assert.deepEqual(await js('return [...document.querySelectorAll(".va-settings legend")].map(e=>e.textContent)'),['일반','텍스트','현재 파일']);await screenshot(`${format}-text-settings`);await click('닫기');await collect();await stop();results.push(`${format}: actual WebKit text editing, safe BOM/CRLF save and contextual settings`);
    await start(binary,files.png);await wait('document.querySelector(".image-area img")?.naturalWidth > 0');const width=await js('return document.querySelector(".image-area img").naturalWidth'),height=await js('return document.querySelector(".image-area img").naturalHeight');
    await click('이미지 편집');await click('회전');assert.equal(await js('return document.querySelector(".image-area canvas").width'),height);await key('z',{ctrlKey:true});assert.equal(await js('return document.querySelector(".image-area img").hidden'),false);await key('y',{ctrlKey:true});await click('이미지 복사');await wait('document.querySelector(".va-status")?.textContent.includes("복사했습니다")');
    const clipboard=run('xclip',['-selection','clipboard','-target','image/png','-out'],{stdio:'pipe',encoding:null});assert.equal(clipboard.readUInt32BE(16),height);assert.equal(clipboard.readUInt32BE(20),width);
    await screenshot(`${format}-image`);await key('z',{ctrlKey:true});await collect();await stop();results.push(`${format}: image rotate/undo/redo and real X11 clipboard PNG dimensions`);
    await start(binary,files.pdf);await wait('document.querySelector(".pdf-root canvas")?.width > 0');await key('f',{ctrlKey:true});await js('const s=document.querySelector("input[type=search]");s.value="needle";s.dispatchEvent(new Event("input",{bubbles:true}));');await click('다음 결과');await wait('document.querySelector("mark") != null');await screenshot(`${format}-pdf-search`);await collect();await stop();results.push(`${format}: PDF rendering and search highlight`);
    await start(binary,files.pcd);await wait('document.querySelector(".va3d-status")?.textContent.includes("점 8")');await screenshot(`${format}-cloud`);await collect();await stop();results.push(`${format}: native PCD load and GPU canvas`);
    await start(binary,files.stl);await wait('document.querySelector(".va3d-status")?.textContent.includes("삼각형")');await screenshot(`${format}-mesh`);await collect();
    // Export through the real GTK file chooser in this isolated Xvfb desktop.
    const out=path.join(root,`offline-${format}.html`);await key('E',{ctrlKey:true,shiftKey:true});
    await delay(1500);run('xdotool',['key','--clearmodifiers','ctrl+l']);run('xdotool',['type','--clearmodifiers','--delay','0',out]);run('xdotool',['key','Return']);await delay(500);run('xdotool',['key','Return']);await until(()=>fs.existsSync(out),'native GTK export save',60000);
    await cmd('/url',{url:pathToFileURL(out).href});await wait('document.querySelector("canvas") != null');await key('1');await screenshot(`${format}-offline-html`);results.push(`${format}: native save dialog and exported HTML canvas`);await stop();
  }
  run('sudo',['dpkg','--remove',name]);assert(!fs.existsSync(installed));results.push('deb uninstall removes installed binary');assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify({ok:true,results,errors,environment:{platform:process.platform,display:process.env.DISPLAY,renderer:'WebKitGTK on Xvfb, Mesa software'},limits:['Web content controls use WebDriver JS events; GTK save/clipboard use real native paths.','No physical desktop/Wayland or default-app chooser interaction.']},null,2));console.log(results.join('\nPASS '));
}catch(error){if(session)await screenshot('failure').catch(()=>{});fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify({ok:false,results,errors,error:String(error.stack??error)},null,2));throw error;
}finally{await stop();driver?.kill();}
