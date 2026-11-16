import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {certifications} from '../certification.js';
import {blueprintQuotas} from '../sampling.js';
const {chromium}=await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_PATH)).href);
const root=fileURLToPath(new URL('../',import.meta.url));
const server=createServer(async(req,res)=>{const file=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root.endsWith(sep)?root:root+sep)&&file!==resolve(root)){res.writeHead(403).end();return;}try{const target=file===resolve(root)?resolve(root,'index.html'):decodeURIComponent(file);const data=await readFile(target);res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json'})[extname(target)]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base=`http://127.0.0.1:${server.address().port}/`;
const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
await mkdir(resolve(root,'test-results'),{recursive:true});
try{
 for(const course of certifications){
  const context=await browser.newContext(),page=await context.newPage(),errors=[];
  await context.route('https://**/*',r=>r.abort());page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${base}?cert=${course.id}&mode=offline`);await page.locator('#start').waitFor();
  await page.locator('.blueprint > summary').click();
  const expected=blueprintQuotas(course.id).map(q=>q.count);
  assert.deepEqual(await page.locator('.blueprint tbody tr').evaluateAll(rows=>rows.map(row=>Number(row.children[2].textContent))),expected);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await page.screenshot({path:resolve(root,`test-results/blueprint-${course.id}-mobile.png`),fullPage:true});
  await page.setViewportSize({width:1280,height:900});
  const readRecord=async mode=>page.evaluate(async({cert,mode})=>{
   const {loadQuestionBank}=await import('./certification.js');const bank=await loadQuestionBank(cert),byId=Object.fromEntries(bank.map(q=>[q.id,q]));
   const p=JSON.parse(localStorage.getItem(cert+'-offline-progress-v1'));
   const record=mode==='quiz'?p.attempts.find(r=>!r.finished_at):p.studies.find(r=>r.state.variant==='practice'&&!r.finished_at);
   return {record,counts:record.state.blueprint.domains.map((_,i)=>record.state.ids.filter(id=>byId[id].blueprintDomain===i).length)};
  },{cert:course.id,mode});
  await page.locator('#start').click();let before=await readRecord('quiz');assert.deepEqual(before.counts,expected);assert.equal(before.record.total,course.examSize);assert.ok(await page.locator('.question-domain').textContent());
  await page.locator('#back').click();await page.locator('#practice-start').click();const practice=await readRecord('practice');assert.deepEqual(practice.counts,expected);assert.equal(practice.record.total,course.examSize);
  await page.locator('#study-back').click();
  await page.evaluate(()=>navigator.serviceWorker.ready);await context.setOffline(true);await page.reload();await page.locator('#start').waitFor();
  await page.locator('#start').click();assert.deepEqual((await readRecord('quiz')).record,before.record);await page.locator('#back').click();
  await page.locator('#practice-start').click();assert.deepEqual((await readRecord('practice')).record,practice.record);await page.locator('#study-back').click();
  const legacy=await page.evaluate(async cert=>{
   const {loadQuestionBank}=await import('./certification.js');const bank=await loadQuestionBank(cert);const key=cert+'-offline-progress-v1',p=JSON.parse(localStorage.getItem(key));const a=p.attempts.find(r=>!r.finished_at);
   delete a.state.blueprint;a.state.ids=bank.slice(0,a.total).map(q=>q.id);a.state.orders=Object.fromEntries(bank.slice(0,a.total).map(q=>[q.id,q.alternativas.map((_,i)=>i)]));localStorage.setItem(key,JSON.stringify(p));return a;
  },course.id);
  await page.reload();await page.locator('#start').click();assert.deepEqual((await page.evaluate(cert=>JSON.parse(localStorage.getItem(cert+'-offline-progress-v1')).attempts.find(r=>!r.finished_at),course.id)),legacy);
  assert.deepEqual(errors,[]);await context.close();console.log('PASS '+course.id+': weighted quiz/practice, displayed quotas/categories, mobile, offline resume and legacy composition');
 }
}finally{await browser.close();await new Promise(done=>server.close(done));}
