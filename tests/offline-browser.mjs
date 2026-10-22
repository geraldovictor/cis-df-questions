// Run with PLAYWRIGHT_PATH pointing to an installed playwright-core entry point.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_PATH)).href);
const root=fileURLToPath(new URL('../',import.meta.url));
const server=createServer(async(req,res)=>{
  const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if (!path.startsWith(root.endsWith(sep)?root:root+sep) && path!==resolve(root)) {res.writeHead(403).end();return;}
  try {
    const target=path===resolve(root)?resolve(root,'index.html'):path;
    const bytes=await readFile(target);
    res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.mp3':'audio/mpeg','.webmanifest':'application/manifest+json','.png':'image/png'})[extname(target)]||'application/octet-stream'});res.end(bytes);
  } catch {res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/`;
let browser;
try {
  browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.route('https://**/*',route=>route.abort());
  const page=await context.newPage();
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);
  await page.locator('#enter-offline').click();
  await page.locator('[data-offline-status]').filter({hasText:'estão prontos'}).waitFor();
  await page.evaluate(async()=>{await navigator.serviceWorker.ready; if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));});
  const cdp=await context.newCDPSession(page);
  const appManifest=await cdp.send('Page.getAppManifest');
  assert.deepEqual(appManifest.errors,[]);
  const installability=await cdp.send('Page.getInstallabilityErrors');
  // Isolated Playwright contexts are private windows, which cannot install apps.
  assert.deepEqual(installability.installabilityErrors.filter(error=>error.errorId!=='in-incognito'),[]);
  await page.evaluate(()=>{
    const event=new Event('beforeinstallprompt',{cancelable:true});
    event.prompt=async()=>{window.testInstallPrompted=true;};
    event.userChoice=Promise.resolve({outcome:'dismissed'});
    window.dispatchEvent(event);
  });
  await page.locator('#install-app').click();
  assert.equal(await page.evaluate(()=>window.testInstallPrompted),true);
  assert.equal(await page.locator('#install-app').isVisible(),false);
  await page.evaluate(()=>window.dispatchEvent(new Event('appinstalled')));
  assert.equal(await page.locator('#install-panel').isVisible(),false);
  await page.locator('[data-offline-audio]').click();
  await page.locator('[data-offline-audio-status]').filter({hasText:'Todos os 205'}).waitFor();
  assert.equal(await page.evaluate(async()=>(await (await caches.open('cis-df-audio-v1')).keys()).length),205);
  await context.setOffline(true);
  await page.reload(); await page.locator('#start').waitFor();
  const offlineManifest=await page.evaluate(async()=>JSON.parse(await (await fetch('manifest.webmanifest')).text()));
  assert.equal(offlineManifest.display,'standalone');
  const audio=await page.evaluate(async()=>{const r=await fetch('audio/1-1.mp3',{headers:{range:'bytes=10-99'}});return {status:r.status,length:(await r.arrayBuffer()).byteLength};});
  assert.deepEqual(audio,{status:206,length:90});
  await page.locator('#start').click();
  await page.locator('[name=answer]').first().check();
  await page.locator('#next').click();
  const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('cis-df-offline-progress-v1')).attempts[0]);
  await page.reload(); await page.locator('#start').click();
  assert.equal(await page.locator('.question-title').count(),1);
  assert.match(await page.locator('.eyebrow').first().textContent(),/Questão 2 de 75/);
  await page.locator('#back').click();
  await page.locator('#study-start').click();
  await page.locator('[name=study-answer]').first().check();
  await page.locator('#study-check').click();
  await page.reload(); await page.locator('#study-start').click();
  assert.equal(await page.locator('.study-feedback').count(),1);
  await page.locator('#study-back').click();
  await page.locator('.flashcards summary').click();
  await page.locator('[data-fc-flip]').click();
  await page.locator('[data-fc-rate="known"]').click();
  await page.reload();
  assert.match(await page.locator('[data-fc-stats]').textContent(),/1 já sei/);
  const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('cis-df-offline-progress-v1')).attempts[0]);
  assert.deepEqual(after,before);
  await page.screenshot({path:resolve(root,'test-results/offline-mobile.png'),fullPage:true});
  const overflow=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).map(el=>({tag:el.tagName,id:el.id,class:el.className,width:el.getBoundingClientRect().width})).slice(0,12));
  assert.deepEqual(overflow,[]);
  await page.locator('#logout').click();
  await page.locator('#enter-offline').waitFor();
  await page.locator('#enter-offline').click();
  assert.match(await page.locator('#start').textContent(),/Continuar/);
  assert.deepEqual(errors,[]);
  await context.close();
  const online=await browser.newContext();
  await online.route('https://**/*',route=>route.abort());
  await online.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm',route=>route.fulfill({contentType:'text/javascript',body:`
    export function createClient() {
      let callback, session=null;
      window.testUpserts=[];
      return { auth: {
        onAuthStateChange(fn) {callback=fn;window.triggerAccount=()=>fn('SIGNED_IN',{user:{id:'account-test',email:'test@example.com'}});setTimeout(()=>fn('INITIAL_SESSION',session),0);},
        async getSession() {return {data:{session}};},
        async signInWithPassword() {session={user:{id:'account-test',email:'test@example.com'}};callback('SIGNED_IN',session);return {data:{session}};},
        async signOut() {session=null;callback('SIGNED_OUT',null);return {};}
      }, from(table) {return {select(){return {async order(){return {data:[],error:null};}};},async upsert(data){window.testUpserts.push({table,data});return {error:null};}};}};
    }` }));
  const account=await online.newPage();
  await account.goto(url);
  await account.locator('[name=email]:not([disabled])').fill('test@example.com');
  await account.locator('[name=password]').fill('password123');
  await account.locator('#auth-form button').click();
  await account.locator('#start').click();
  assert.equal(await account.evaluate(()=>window.testUpserts[0].data.user_id),'account-test');
  assert.equal(await account.evaluate(()=>localStorage.getItem('cis-df-offline-progress-v1')),null);
  await account.locator('#back').click();
  await account.locator('#logout').click();
  await account.locator('#enter-offline').click();
  await account.evaluate(()=>window.triggerAccount());
  await account.waitForTimeout(100);
  assert.match(await account.locator('.welcome .muted').textContent(),/Modo offline/);
  await account.goto(url+'?mode=offline');
  await account.locator('#start').waitFor();
  assert.match(await account.locator('.welcome .muted').textContent(),/Modo offline/);
  await online.close();
  const regular=await chromium.launchPersistentContext(resolve(root,`test-results/pwa-profile-${Date.now()}`),{executablePath:process.env.BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  try {
    await regular.route('https://**/*',route=>route.abort());
    const installPage=await regular.newPage();
    await installPage.goto(url+'?mode=offline');
    await installPage.locator('[data-offline-status]').filter({hasText:'estão prontos'}).waitFor();
    const installCDP=await regular.newCDPSession(installPage);
    assert.deepEqual((await installCDP.send('Page.getInstallabilityErrors')).installabilityErrors,[]);
  } finally {await regular.close();}
  console.log('PASS: PWA installability, install UI, offline manifest, installed start URL; offline reload, quiz/study/flashcard persistence, 205 audios, account separation');
} finally {await browser?.close(); await new Promise(resolve=>server.close(resolve));}
