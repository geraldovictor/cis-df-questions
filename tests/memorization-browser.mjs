// PLAYWRIGHT_PATH points to an installed playwright-core entry point.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';

const { chromium } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_PATH)).href);
const root = fileURLToPath(new URL('../', import.meta.url));
const server = createServer(async (req, res) => {
  const path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!path.startsWith(root.endsWith(sep) ? root : root + sep) && path !== resolve(root)) { res.writeHead(403).end(); return; }
  try {
    const bytes = await readFile(path === resolve(root) ? resolve(root, 'index.html') : path);
    res.writeHead(200, { 'Content-Type': ({ '.js': 'text/javascript', '.json': 'application/json', '.html': 'text/html', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png' })[extname(path)] || (path === resolve(root) ? 'text/html' : 'application/octet-stream') });
    res.end(bytes);
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/?mode=offline`;
const key = 'cis-df-memory-v1-offline-guest';
const errors = [];
let browser;

const saved = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
async function reveal(page) { await page.locator('[data-memory-reveal]').click(); }
async function jump(page, id) { await page.locator('[data-memory-jump]').selectOption(id); }

try {
  browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await context.route('https://**/*', route => route.abort());
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url); await page.locator('#memory-start').click();
  await page.locator('[data-memory-reveal]').waitFor();

  assert.equal(await page.locator('[data-memory-mnemonic]').count(), 1);
  assert.equal(await page.locator('.memory-answer').count(), 0);
  assert.equal(await page.locator('[data-memory-jump] option').count(), 205);
  await reveal(page);
  assert.equal(await page.locator('.memory-answer').count(), 1);
  assert.match(await page.locator('.memory-answers').textContent(), /ServiceNow Store/);
  await page.locator('[data-memory-rate="review"]').click();
  assert.equal((await saved(page)).marks['1-1'], 'review');
  assert.equal((await saved(page)).currentId, '1-2');

  await page.locator('[data-memory-mode="test"]').click();
  assert.equal(await page.locator('.memory-hook').count(), 0);
  assert.equal(await page.locator('[data-memory-mnemonic]').count(), 0);
  assert.equal(await page.locator('.memory-answer').count(), 0);
  await reveal(page);
  assert.equal(await page.locator('[data-memory-mnemonic]').count(), 1);
  assert.match(await page.locator('.memory-answers').textContent(), /Correctness/);
  await page.locator('[data-memory-rate="known"]').click();
  assert.equal((await saved(page)).marks['1-2'], 'known');
  assert.equal((await saved(page)).currentId, '1-3');

  await page.locator('[data-memory-filter]').selectOption('review');
  assert.deepEqual(await page.locator('[data-memory-jump] option').evaluateAll(options => options.map(option => option.value)), ['1-1']);
  await reveal(page); await page.locator('[data-memory-rate="known"]').click();
  assert.equal(await page.locator('[data-memory-jump]').isDisabled(), true);
  assert.match(await page.locator('[data-memory-content]').textContent(), /Nenhuma questão marcada/);
  await page.locator('[data-memory-all]').click();
  await page.locator('[data-memory-filter]').selectOption('known');
  assert.equal(await page.locator('[data-memory-jump] option').count(), 2);
  await page.locator('[data-memory-filter]').selectOption('new');
  assert.equal(await page.locator('[data-memory-jump] option').count(), 203);
  await page.locator('[data-memory-filter]').selectOption('all');

  await page.locator('[data-memory-search]').fill('2-50');
  assert.equal(await page.locator('[data-memory-jump] option').count(), 1);
  await page.locator('.memory-question summary').click();
  assert.equal(await page.locator('.question-context tbody tr').count(), 3);
  await reveal(page);
  assert.match(await page.locator('.memory-answers').textContent(), /CI1: Update the existing record\..*CI2: Insert a new record\./s);
  assert.match(await page.locator('.memory-answer audio').getAttribute('src'), /2-50\.mp3\?v=2$/);
  await page.locator('[data-memory-search]').fill('');
  await jump(page, '1-6'); await reveal(page);
  assert.equal(await page.locator('.memory-pairs > div').count(), 4);
  assert.match(await page.locator('.memory-pairs').textContent(), /ServiceNow Discovery/);
  assert.match(await page.locator('.memory-pairs').textContent(), /Agent Client Collector/);

  const beforeOrder = await page.locator('[data-memory-jump] option').evaluateAll(options => options.map(option => option.value));
  await page.locator('[data-memory-shuffle]').click();
  const shuffled = (await saved(page)).order;
  assert.equal(shuffled.length, 205);
  assert.equal(new Set(shuffled).size, 205);
  assert.deepEqual([...shuffled].sort(), [...beforeOrder].sort());
  assert.notDeepEqual(shuffled, beforeOrder);
  await jump(page, '2-50'); await reveal(page);
  await page.locator('[data-memory-rate="review"]').click();
  await page.locator('[data-memory-filter]').selectOption('review');
  assert.equal(await page.locator('[data-memory-jump]').inputValue(), '2-50');
  const beforeReload = await saved(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(done => navigator.serviceWorker.addEventListener('controllerchange', done, { once: true }));
  });
  await context.setOffline(true);
  await page.reload(); await page.locator('#memory-start').click();
  await page.locator('[data-memory-reveal]').waitFor();
  assert.deepEqual(await saved(page), beforeReload);
  assert.equal(await page.locator('[data-memory-filter]').inputValue(), 'review');
  assert.equal(await page.locator('[data-memory-mode="test"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[data-memory-mnemonic]').count(), 0);
  assert.equal(await page.locator('[data-memory-jump]').inputValue(), '2-50');
  await page.locator('[data-memory-back]').click();
  await page.locator('#memory-start').click();
  await page.locator('[data-memory-reveal]').waitFor();
  assert.equal(await page.locator('[data-memory-jump]').inputValue(), '2-50');

  // Rendering for a second account must not inherit or overwrite guest marks.
  await page.evaluate(async () => {
    const { renderMemorization } = await import('./memorization.js');
    const files = ['questoes-1-corrigida (1).json', 'questoes-2-corrigida-v2 (1).json', 'questoes-3-corrigida-v2 (1).json'];
    const sets = await Promise.all(files.map(file => fetch(file).then(response => response.json())));
    const questions = sets.flatMap((set, f) => set.map((q, i) => ({ ...q, id: `${f + 1}-${i + 1}` })));
    const aids = await fetch('memory-aids.json').then(response => response.json());
    renderMemorization({ app: document.querySelector('#app'), questions, aids, userId: 'account-test', back() {} });
  });
  assert.match(await page.locator('[data-memory-stats]').textContent(), /0 decorei.*0 ainda confundo.*205 sem marcação/s);
  assert.equal(await page.locator('[data-memory-jump]').inputValue(), '1-1');
  await reveal(page); await page.locator('[data-memory-rate="known"]').click();
  assert.deepEqual(await saved(page), beforeReload);
  const account = await page.evaluate(() => JSON.parse(localStorage.getItem('cis-df-memory-v1-account-test')));
  assert.deepEqual(account.marks, { '1-1': 'known' });
  await context.close();

  // A late response must not replace the quiz opened while the aids were loading.
  const memoryJSON = await readFile(resolve(root, 'memory-aids.json'), 'utf8');
  const loadingContext = await browser.newContext({ serviceWorkers: 'block' });
  await loadingContext.route('https://**/*', route => route.abort());
  let pendingRoute, requestStarted;
  const requested = new Promise(done => { requestStarted = done; });
  await loadingContext.route('**/memory-aids.json', route => { pendingRoute = route; requestStarted(); });
  const loading = await loadingContext.newPage();
  loading.on('pageerror', error => errors.push(error.message));
  await loading.goto(url); await loading.locator('#memory-start').click();
  await requested;
  assert.equal(await loading.locator('#memory-start').isDisabled(), true);
  await loading.locator('#start').click();
  await loading.locator('.question-title').waitFor();
  const loaded = loading.waitForResponse(response => response.url().endsWith('/memory-aids.json'));
  await pendingRoute.fulfill({ status: 200, contentType: 'application/json', body: memoryJSON });
  await (await loaded).finished();
  await loading.locator('#back').click();
  await loading.locator('#memory-start').click();
  await loading.locator('[data-memory-reveal]').waitFor();
  assert.equal(await loading.locator('[data-memory-jump] option').count(), 205);
  await loadingContext.close();

  // A failed download returns the button to a usable state and permits a retry.
  const retryContext = await browser.newContext({ serviceWorkers: 'block' });
  await retryContext.route('https://**/*', route => route.abort());
  let attempts = 0;
  await retryContext.route('**/memory-aids.json', route => route.fulfill({
    status: ++attempts === 1 ? 503 : 200, contentType: 'application/json', body: memoryJSON
  }));
  const retry = await retryContext.newPage();
  retry.on('pageerror', error => errors.push(error.message));
  await retry.goto(url); await retry.locator('#memory-start').click();
  await retry.locator('#message').filter({ hasText: 'Não foi possível carregar os macetes' }).waitFor();
  assert.equal(await retry.locator('#memory-start').isEnabled(), true);
  await retry.locator('#memory-start').click();
  await retry.locator('[data-memory-reveal]').waitFor();
  assert.equal(attempts, 2);
  await retryContext.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.route('https://**/*', route => route.abort());
  const phone = await mobile.newPage();
  phone.on('pageerror', error => errors.push(error.message));
  await phone.goto(url); await phone.locator('#memory-start').tap();
  await phone.locator('[data-memory-reveal]').waitFor();
  await phone.locator('[data-memory-mode="test"]').tap();
  await jump(phone, '2-50');
  assert.equal(await phone.locator('[data-memory-mnemonic]').count(), 0);
  await phone.locator('.memory-question summary').tap();
  await phone.locator('[data-memory-reveal]').tap();
  assert.equal(await phone.locator('.question-context tbody tr').count(), 3);
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await mkdir(resolve(root, 'test-results'), { recursive: true });
  await phone.screenshot({ path: resolve(root, 'test-results/memorization-mobile.png'), fullPage: true });
  await jump(phone, '1-35'); await phone.locator('[data-memory-reveal]').tap();
  assert.equal(await phone.locator('.memory-pairs > div').count(), 4);
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await mobile.close();
  assert.deepEqual(errors, []);
  console.log('PASS: 205 memory aids, learn/test reveal, ratings/filters/search, matching/context, shuffle, offline/account persistence, late-loading navigation, failed-load retry and mobile layout');
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
