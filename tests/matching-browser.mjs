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
  if (!path.startsWith(root.endsWith(sep) ? root : root + sep) && path !== resolve(root)) {
    res.writeHead(403).end(); return;
  }
  try {
    const target = path === resolve(root) ? resolve(root, 'index.html') : path;
    const bytes = await readFile(target);
    res.writeHead(200, { 'Content-Type': ({ '.js': 'text/javascript', '.json': 'application/json', '.html': 'text/html', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png' })[extname(target)] || 'application/octet-stream' });
    res.end(bytes);
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/?mode=offline`;
let browser;
const errors = [];

async function seed(page) {
  await page.goto(url);
  await page.locator('#start').waitFor();
  await page.evaluate(async () => {
    const { createAttempt } = await import('./quiz.js');
    const { createStudy } = await import('./study.js');
    const files = ['questoes-1-corrigida (1).json', 'questoes-2-corrigida-v2 (1).json', 'questoes-3-corrigida-v2 (1).json'];
    const sets = await Promise.all(files.map(file => fetch(file).then(r => r.json())));
    const questions = sets.flatMap((set, f) => set.map((q, i) => ({ ...q, id: `${f + 1}-${i + 1}` })));
    const first = ['1-6', '1-1', '1-35', '1-68'];
    const quiz = createAttempt(questions, 'offline-guest');
    quiz.state.ids = [...first, ...questions.map(q => q.id).filter(id => !first.includes(id))].slice(0, 75);
    quiz.state.orders = Object.fromEntries(questions.map(q => [q.id, q.alternativas.map((_, i) => i)]));
    const study = createStudy(questions, 'offline-guest');
    study.state.ids = ['1-35', '1-68', ...questions.map(q => q.id).filter(id => !['1-35', '1-68'].includes(id))];
    localStorage.setItem('cis-df-offline-progress-v1', JSON.stringify({ attempts: [quiz], studies: [study] }));
  });
  await page.reload();
  await page.locator('#start').waitFor();
}

async function assign(page, item, target, keyboard = false) {
  const card = page.locator(`[data-match-item="${item}"]`);
  const place = page.locator(`[data-match-place="${target}"]`);
  if (keyboard === 'touch') { await card.tap(); await place.tap(); }
  else if (keyboard) {
    await card.focus(); await page.keyboard.press('Enter');
    await place.focus(); await page.keyboard.press('Space');
  } else { await card.click(); await place.click(); }
}

async function answer(page, entries, keyboard = false) {
  for (const [target, item] of Object.entries(entries)) await assign(page, item, target, keyboard);
}

try {
  browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await context.route('https://**/*', route => route.abort());
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await seed(page);
  await page.locator('#start').click();
  assert.equal(await page.locator('[name=answer]').count(), 0);
  assert.equal(await page.locator('[data-match-item]').count(), 4);
  const source = await page.locator('[data-match-item="C"]').boundingBox();
  const target = await page.locator('[data-match-place="1"]').boundingBox();
  await page.mouse.move(source.x + 20, source.y + 20);
  await page.mouse.down();
  await page.mouse.move(target.x + 40, target.y + 20, { steps: 15 });
  await page.mouse.up();
  assert.equal(await page.locator('[data-match-target="1"] [data-match-item="C"]').count(), 1);
  assert.match(await page.locator('#quiz-count').textContent(), /^0 de/);
  const cancelSource = await page.locator('[data-match-item="A"]').boundingBox();
  await page.mouse.move(cancelSource.x + 20, cancelSource.y + 20);
  await page.mouse.down(); await page.mouse.move(cancelSource.x + 50, cancelSource.y + 30);
  await page.keyboard.press('Escape'); await page.mouse.up();
  assert.equal(await page.locator('.matching-ghost').count(), 0);
  await page.reload(); await page.locator('#start').click();
  assert.equal(await page.locator('[data-match-target="1"] [data-match-item="C"]').count(), 1);
  await page.locator('[data-match-remove="1"]').click();
  assert.equal(await page.locator('[data-match-bank] [data-match-item="C"]').count(), 1);
  await answer(page, { 1: 'A', 2: 'B', 3: 'C', 4: 'D' }, true);
  assert.match(await page.locator('#quiz-count').textContent(), /^1 de/);
  // Moving onto an occupied destination swaps the two cards, without duplicates.
  await assign(page, 'A', '2');
  assert.equal(await page.locator('[data-match-target="1"] [data-match-item="B"]').count(), 1);
  await assign(page, 'A', '1');
  await page.locator('#next').click();
  await page.locator('[name=answer]').first().check();
  await page.locator('#prev').click();
  assert.equal(await page.locator('[data-match-target="1"] [data-match-item="A"]').count(), 1);
  await page.locator('#finish').click(); await page.locator('#confirm').click();
  await page.locator('#reviews details').first().locator('summary').click();
  assert.equal(await page.locator('#reviews details').first().locator('.matching-target.is-correct').count(), 4);
  assert.equal(await page.locator('#reviews details').first().locator('.matching button:not([disabled])').count(), 0);
  await page.locator('#dashboard').click();

  await page.locator('#study-start').click();
  assert.equal(await page.locator('[data-match-item]').count(), 5);
  assert.equal(await page.locator('[data-match-target]').count(), 4);
  await assign(page, 'D', '1');
  await page.locator('#study-check').click();
  assert.match(await page.locator('#message').textContent(), /Complete todas/);
  assert.equal(await page.locator('.study-feedback').count(), 0);
  await answer(page, { 2: 'B', 3: 'A', 4: 'E' });
  await page.locator('#study-check').click();
  assert.match(await page.locator('.study-feedback').textContent(), /Você errou/);
  assert.equal(await page.locator('.matching-target.is-wrong').count(), 1);
  assert.equal(await page.locator('.matching button:not([disabled])').count(), 0);
  await page.locator('#study-next').click();
  assert.equal(await page.locator('[data-match-item]').count(), 6);
  await answer(page, { 1: 'C', 2: 'A', 3: 'F' }, true);
  assert.equal(await page.locator('[data-match-bank] [data-match-item]').count(), 3);
  await page.locator('#study-check').click();
  assert.match(await page.locator('.study-feedback').textContent(), /Você acertou/);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(done => navigator.serviceWorker.addEventListener('controllerchange', done, { once: true }));
  });
  await context.setOffline(true);
  await page.reload(); await page.locator('#study-start').click();
  assert.match(await page.locator('.study-feedback').textContent(), /Você acertou/);
  assert.equal(await page.locator('.matching-target.is-correct').count(), 3);
  await page.locator('#study-finish').click(); await page.locator('#study-confirm-finish').click();
  assert.match(await page.locator('.result-banner').textContent(), /1 acertos/);
  await page.locator('#study-reviews details').first().locator('summary').click();
  assert.equal(await page.locator('#study-reviews details').first().locator('.matching-target.is-wrong').count(), 1);

  // Keep every source arrow format in the interactive flow, including saved choices.
  const formats = await page.evaluate(async () => {
    const { createStudy } = await import('./study.js');
    const { getMatchingQuestion } = await import('./matching.js');
    const files = ['questoes-1-corrigida (1).json', 'questoes-2-corrigida-v2 (1).json', 'questoes-3-corrigida-v2 (1).json'];
    const sets = await Promise.all(files.map(file => fetch(file).then(response => response.json())));
    const bank = sets.flatMap((set, f) => set.map((q, i) => ({ ...q, id: `${f + 1}-${i + 1}` })));
    const ids = ['3-34', '3-5', '3-7', '3-8', '2-72'];
    const study = createStudy(bank, 'offline-guest');
    study.state.ids = [...ids, ...study.state.ids.filter(id => !ids.includes(id))];
    study.state.answers['3-34'] = [1];
    localStorage.setItem('cis-df-offline-progress-v1', JSON.stringify({ attempts: [], studies: [study] }));
    return ids.map(id => getMatchingQuestion(bank.find(q => q.id === id)));
  });
  await page.reload(); await page.locator('#study-start').click();
  assert.equal(await page.locator('[data-match-target] [data-match-item]').count(), 4);
  for (const model of formats) {
    assert.equal(await page.locator('[name=study-answer]').count(), 0);
    assert.equal(await page.locator('[data-match-target]').count(), model.targets.length);
    await answer(page, model.solution);
    await page.locator('#study-check').click();
    assert.match(await page.locator('.study-feedback').textContent(), /Você acertou/);
    assert.equal(await page.locator('.matching-target.is-correct').count(), model.targets.length);
    await page.locator('#study-next').click();
  }
  await context.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.route('https://**/*', route => route.abort());
  const phone = await mobile.newPage();
  phone.on('pageerror', error => errors.push(error.message));
  await seed(phone); await phone.locator('#study-start').click();
  const handle = phone.locator('[data-match-item="C"] [data-match-handle]');
  await handle.scrollIntoViewIfNeeded();
  const touchSource = await handle.boundingBox();
  const cdp = await mobile.newCDPSession(phone);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchSource.x + 10, y: touchSource.y + 15 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 180, y: 820 }] });
  await phone.waitForFunction(() => document.querySelector('[data-match-place="1"]').getBoundingClientRect().top < innerHeight - 150);
  const touchTarget = await phone.locator('[data-match-place="1"]').boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchTarget.x + 40, y: touchTarget.y + 20 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.equal(await phone.locator('[data-match-target="1"] [data-match-item="C"]').count(), 1);
  await answer(phone, { 2: 'B', 3: 'A', 4: 'E' }, 'touch');
  assert.equal(await phone.locator('[data-match-bank] [data-match-item]').count(), 1);
  await phone.locator('#study-check').click();
  assert.match(await phone.locator('.study-feedback').textContent(), /Você acertou/);
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await mkdir(resolve(root, 'test-results'), { recursive: true });
  await phone.screenshot({ path: resolve(root, 'test-results/matching-mobile.png'), fullPage: true });
  await mobile.close();
  assert.deepEqual(errors, []);
  console.log('PASS: all source arrow formats, reported CMDB team question, saved choices, mouse/touch/keyboard, swap/remove, scoring/review, study locking, offline reload and mobile layout');
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
