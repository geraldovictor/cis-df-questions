import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {certifications} from '../certification.js';
const {chromium}=await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_PATH)).href);
const root=fileURLToPath(new URL('../',import.meta.url));
const server=createServer(async(req,res)=>{const file=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root.endsWith(sep)?root:root+sep)&&file!==resolve(root)){res.writeHead(403).end();return;}try{const target=file===resolve(root)?resolve(root,'index.html'):file,data=await readFile(target),type=({'.js':'text/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.png':'image/png','.mp3':'audio/mpeg','.webmanifest':'application/manifest+json'})[extname(target)]||'application/octet-stream';const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');if(range){const start=Number(range[1]),end=Math.min(range[2]?Number(range[2]):data.length-1,data.length-1),part=data.subarray(start,end+1);res.writeHead(206,{'Content-Type':type,'Content-Length':part.length,'Content-Range':`bytes ${start}-${end}/${data.length}`,'Accept-Ranges':'bytes'}).end(part);}else res.writeHead(200,{'Content-Type':type,'Content-Length':data.length,'Accept-Ranges':'bytes'}).end(data);}catch{res.writeHead(404).end();}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const url=`http://127.0.0.1:${server.address().port}/`;
const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
await mkdir(resolve(root,'test-results'),{recursive:true});
const local=async(page,c)=>page.evaluate(c=>JSON.parse(localStorage.getItem(c+'-offline-progress-v1')),c);
const histories=async(page,c)=>page.evaluate(c=>JSON.parse(localStorage.getItem(c+'-reports-v1-offline-guest')||'[]'),c);
try{
 for(const c of process.env.REPORT_SCOPE==='account'?[]:certifications){
  const context=await browser.newContext({acceptDownloads:true}),page=await context.newPage(),errors=[];
  await context.route('https://**/*',r=>r.abort());page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${url}?cert=${c.id}&mode=offline`);await page.locator('#start').waitFor();
  await page.locator('#start').click();
  await page.evaluate(async cert=>{const {loadQuestionBank}=await import('./certification.js');const {saveLocalAttempt}=await import('./offline.js');const qs=await loadQuestionBank(cert);const p=JSON.parse(localStorage.getItem(cert+'-offline-progress-v1'));const a=p.attempts.find(a=>!a.finished_at),q=qs.find(q=>q.id===a.state.ids[0]);a.state.answers[q.id]=q.alternativas.flatMap((v,i)=>v.correta?[i]:[]);saveLocalAttempt(a);},c.id);
  await page.reload();await page.locator('#start').click();await page.locator('#finish').click();await page.locator('#confirm').click();
  await page.locator('[data-attempt-report]').waitFor();let report=(await local(page,c.id)).attempts[0].state.report;
  assert.equal(report.mode,'quiz');assert.equal(report.summary.correct,1);assert.equal(report.summary.unanswered,c.examSize-1);
  await page.locator('[data-report-questions] > summary').click();await page.locator('.report-question').first().waitFor();assert.equal(await page.locator('.report-question').count(),c.examSize);
  const downloadEvent=page.waitForEvent('download');await page.locator('[data-report-download]').click();const download=await downloadEvent;
  const path=resolve(root,`test-results/report-${c.id}.html`);await download.saveAs(path);assert.match(await readFile(path,'utf8'),/Relatório da tentativa/);
  await page.locator('[data-report-questions] > summary').click();await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.locator('[data-attempt-report]').screenshot({path:resolve(root,`test-results/report-${c.id}-mobile.png`)});await page.setViewportSize({width:1280,height:900});
  await page.locator('#dashboard').click();
  for(const mode of ['study','practice']){
   await page.locator(mode==='study'?'#study-start':'#practice-start').click();
   await page.evaluate(async({cert,mode})=>{const {loadQuestionBank}=await import('./certification.js');const {saveLocalAttempt}=await import('./offline.js');const {isPracticeStudy}=await import('./study.js');const qs=await loadQuestionBank(cert);const p=JSON.parse(localStorage.getItem(cert+'-offline-progress-v1'));const a=p.studies.find(a=>!a.finished_at&&isPracticeStudy(a)===(mode==='practice')),q=qs.find(q=>q.id===a.state.ids[0]),draft=qs.find(q=>q.id===a.state.ids[1]);a.state.answers[q.id]=q.alternativas.flatMap((v,i)=>v.correta?[i]:[]);a.state.confirmed[q.id]=true;a.state.answers[draft.id]=draft.alternativas.flatMap((v,i)=>v.correta?[i]:[]);saveLocalAttempt(a);},{cert:c.id,mode});
   await page.reload();await page.locator(mode==='study'?'#study-start':'#practice-start').click();await page.locator('#study-finish').click();await page.locator('#study-confirm-finish').click();await page.locator('[data-attempt-report]').waitFor();
   report=(await local(page,c.id)).studies.find(a=>a.finished_at&&a.state.report?.mode===mode).state.report;assert.equal(report.summary.correct,1);assert.equal(report.summary.answered,1);assert.equal(report.summary.unanswered,report.rows.length-1);
   await page.locator('#study-back').click();
  }
  assert.equal((await histories(page,c.id)).length,3);
  console.log('PASS '+c.id+': graded reports and download');
  await page.evaluate(async cert=>{const {loadQuestionBank}=await import('./certification.js');const q=(await loadQuestionBank(cert)).slice(0,2);localStorage.setItem(cert+'-flashcards-offline-guest',JSON.stringify({marks:Object.fromEntries(q.map(q=>[q.id,'review'])),currentId:q[0].id}));},c.id);
  await page.reload();await page.locator('#start').waitFor();await page.locator('.flashcards > summary').click();await page.locator('[data-fc-mode]').selectOption('review');
  await page.locator('[data-fc-flip]').click();await page.locator('[data-fc-rate="known"]').click();
  await page.reload();await page.locator('#start').waitFor();await page.locator('.flashcards > summary').click();assert.equal(await page.locator('[data-fc-mode]').inputValue(),'review');
  await page.locator('[data-fc-finish-session]').click();
  let flashReports=(await histories(page,c.id)).filter(r=>r.mode==='flashcards');assert.equal(flashReports.length,1);assert.equal(flashReports[0].summary.known,1);
  await page.locator('[data-fc-flip]').click();await page.locator('[data-fc-rate="review"]').click();
  flashReports=(await histories(page,c.id)).filter(r=>r.mode==='flashcards');assert.equal(flashReports.length,2);assert.equal(flashReports[0].summary.review,1);
  await page.locator('[data-fc-flip]').click();await page.locator('[data-fc-rate="known"]').click();
  const beforeManual=(await histories(page,c.id)).length;assert.equal(await page.locator('[data-fc-finish-session]').isDisabled(),true);
  assert.ok(beforeManual>=5);
  console.log('PASS '+c.id+': flashcard manual/automatic reports and resumed session');
  await page.locator('#audio-continuous').uncheck();
  await page.evaluate(()=>document.querySelector('#question-audio').play());
  await page.waitForFunction(()=>{const p=document.querySelector('#question-audio');return Number.isFinite(p.duration)&&p.duration>0;});
  await page.evaluate(()=>{const p=document.querySelector('#question-audio');p.currentTime=Math.max(0,p.duration-0.08);});
  await page.waitForFunction(cert=>JSON.parse(localStorage.getItem(cert+'-reports-v1-offline-guest')||'[]').some(r=>r.mode==='audio'),c.id);
  let audio=(await histories(page,c.id)).find(r=>r.mode==='audio');assert.equal(audio.summary.listened,1);assert.equal(audio.summary.correct,0);
  assert.match(await page.locator('[data-audio-reports]').textContent(),/não avalia acertos/);
  if(c.id==='cis-em'){
   await page.locator('#audio-repeat').check();
   await page.evaluate(()=>document.querySelector('#question-audio').play());
   await page.waitForFunction(()=>Number.isFinite(document.querySelector('#question-audio').duration));
   await page.evaluate(()=>{const p=document.querySelector('#question-audio');p.currentTime=p.duration-0.08;});
   await page.waitForFunction(()=>{const s=JSON.parse(localStorage.getItem('cis-em-audio-report-session-offline-guest'));return !s.finished_at&&Object.keys(s.outcomes).length===1;});
   await page.waitForFunction(()=>{const p=document.querySelector('#question-audio');return Number.isFinite(p.duration)&&p.currentTime<p.duration/2;});
   await page.evaluate(()=>{const p=document.querySelector('#question-audio');p.currentTime=p.duration-0.08;});
   await page.waitForFunction(()=>{const p=document.querySelector('#question-audio');return Number.isFinite(p.duration)&&p.currentTime<p.duration/2;});
   assert.equal((await histories(page,c.id)).filter(r=>r.mode==='audio').length,1);
   await page.locator('[data-audio-finish-session]').click();audio=(await histories(page,c.id)).find(r=>r.mode==='audio');assert.equal(audio.summary.listened,1);assert.equal((await histories(page,c.id)).filter(r=>r.mode==='audio').length,2);
   await page.locator('#audio-repeat').uncheck();
  }
  await page.evaluate(()=>navigator.serviceWorker.ready);await context.setOffline(true);await page.reload();await page.locator('#start').waitFor();
  assert.equal((await histories(page,c.id)).find(r=>r.mode==='audio').id,audio.id);assert.equal(await page.locator('[data-audio-reports] [data-attempt-report]').count(),1);
  await page.locator('[data-review-report]').first().waitFor({state:'attached'});
  const beforeDecoreba=JSON.stringify(await histories(page,c.id));await page.locator('#memory-start').click();await page.locator('[data-memory-reveal]').waitFor();assert.equal(await page.locator('[data-attempt-report]').count(),0);assert.equal(JSON.stringify(await histories(page,c.id)),beforeDecoreba);
  assert.deepEqual(errors,[]);await context.close();console.log('PASS '+c.id+': quiz/study/practice reports, draft exclusion, download/mobile, flashcard sessions/history, actual audio completion, offline persistence and no decoreba reports');
 }
 const accountContext=await browser.newContext({serviceWorkers:'block'});
 await accountContext.route('https://**/*',r=>r.abort());
 await accountContext.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm',r=>r.fulfill({contentType:'text/javascript',body:`export function createClient(){const user={id:localStorage.getItem('__reportAccount')||'report-account-1',email:'reports@example.com'};return {auth:{onAuthStateChange(fn){setTimeout(()=>fn('INITIAL_SESSION',{user}),0);},async getSession(){return {data:{session:{user}},error:null};}},from(table){return {select(){return {async order(){return {data:JSON.parse(localStorage.getItem('__reportRows-'+table)||'[]').filter(r=>r.user_id===user.id),error:null};}};},async upsert(data){const key='__reportRows-'+table,rows=JSON.parse(localStorage.getItem(key)||'[]'),i=rows.findIndex(r=>r.id===data.id);if(i<0)rows.push(data);else rows[i]=data;localStorage.setItem(key,JSON.stringify(rows));return {error:null};}};}};}`}));
 const accountPage=await accountContext.newPage();await accountPage.goto(`${url}?cert=cis-em`);await accountPage.locator('#start').waitFor();
 await accountPage.locator('#start').click();await accountPage.locator('#finish').click();await accountPage.locator('#confirm').click();await accountPage.locator('[data-attempt-report]').waitFor();
 let savedReport=await accountPage.evaluate(()=>JSON.parse(localStorage.getItem('__reportRows-attempts'))[0].state.report);assert.equal(savedReport.mode,'quiz');assert.equal(savedReport.summary.unanswered,30);assert.equal(savedReport.user_id,'report-account-1');
 await accountPage.locator('#dashboard').click();await accountPage.locator('#practice-start').click();await accountPage.locator('#study-finish').click();await accountPage.locator('#study-confirm-finish').click();await accountPage.locator('[data-attempt-report]').waitFor();
 savedReport=await accountPage.evaluate(()=>JSON.parse(localStorage.getItem('__reportRows-study_sessions'))[0].state.report);assert.equal(savedReport.mode,'practice');assert.equal(savedReport.summary.answered,0);
 await accountPage.reload();await accountPage.locator('[data-review]').click();await accountPage.locator('[data-attempt-report]').waitFor();assert.equal(await accountPage.evaluate(()=>JSON.parse(localStorage.getItem('cis-em-reports-v1-report-account-1')).length),2);
 await accountPage.evaluate(()=>localStorage.setItem('__reportAccount','report-account-2'));await accountPage.reload();await accountPage.locator('#start').waitFor();assert.equal(await accountPage.locator('[data-review]').count(),0);assert.equal(await accountPage.locator('[data-attempt-report]').count(),0);
 assert.equal(await accountPage.evaluate(()=>localStorage.getItem('cis-em-reports-v1-report-account-2')),null);assert.equal(await accountPage.evaluate(()=>JSON.parse(localStorage.getItem('cis-em-reports-v1-report-account-1')).length),2);
 await accountContext.close();console.log('PASS account: graded reports saved in existing cloud state, reopened without duplication and isolated from another account');
}finally{await browser.close();await new Promise(done=>server.close(done));}
