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
  const questionIndex = await page.evaluate(async () => {
    const { createAttempt } = await import('./quiz.js');
    const { createStudy } = await import('./study.js');
    const files = ['questoes-1-corrigida (1).json', 'questoes-2-corrigida-v2 (1).json', 'questoes-3-corrigida-v2 (1).json'];
    const sets = await Promise.all(files.map(file => fetch(file).then(response => response.json())));
    const bank = sets.flatMap((set, f) => set.map((q, i) => ({ ...q, id: `${f + 1}-${i + 1}` })));
    const ids = ['2-50', ...bank.map(q => q.id).filter(id => id !== '2-50')];
    const quiz = createAttempt(bank, 'offline-guest');
    quiz.state.ids = ids.slice(0, 75);
    quiz.state.orders = Object.fromEntries(bank.map(q => [q.id, q.alternativas.map((_, i) => i)]));
    const study = createStudy(bank, 'offline-guest');
    study.state.ids = ids;
    localStorage.setItem('cis-df-offline-progress-v1', JSON.stringify({ attempts: [quiz], studies: [study] }));
    localStorage.setItem('cis-df-flashcards-offline-guest', JSON.stringify({ marks: {}, currentId: '2-50' }));
    return bank.findIndex(q => q.id === '2-50');
  });
  await page.reload();
  await page.locator('#start').waitFor();
  return questionIndex;
}

async function verifyTable(root) {
  const table = root.locator('table');
  assert.equal(await table.count(), 1);
  assert.ok((await table.locator('caption').textContent()).trim());
  assert.equal(await table.locator('thead th[scope="col"]').count(), 3);
  assert.equal(await table.locator('tbody tr').count(), 3);
  const rows = await table.locator('tbody tr').evaluateAll(elements => elements.map(row => [...row.querySelectorAll('td, th')].map(cell => cell.textContent.replace(/\s+/g, ''))));
  assert.deepEqual(rows, [
    ['Hardware', 'serial_number', '200'],
    ['Hardware', 'name', '300'],
    ['NetworkAdapter', 'mac_address,name', '400']
  ]);
}

async function verifyAlternatives(page, name) {
  assert.equal(await page.locator(`[name="${name}"][type=radio]`).count(), 4);
  assert.equal(await page.locator('[data-matching]').count(), 0);
  const text = await page.locator('.option [lang=en]').first().textContent();
  assert.match(text, /CI1:.*\nCI2:/s);
  assert.equal(await page.locator('.option [lang=en]').first().evaluate(element => getComputedStyle(element).whiteSpace), 'pre-line');
}

try {
  browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await context.route('https://**/*', route => route.abort());
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const questionIndex = await seed(page);

  await page.locator('#start').click();
  await verifyTable(page.locator('.quiz-layout > section'));
  await verifyAlternatives(page, 'answer');
  await page.locator('[name=answer][value="1"]').check();
  const savedQuiz = await page.evaluate(() => JSON.parse(localStorage.getItem('cis-df-offline-progress-v1')).attempts[0]);
  assert.equal(savedQuiz.state.ids[0], '2-50');
  assert.deepEqual(savedQuiz.state.answers['2-50'], [1]);
  await page.locator('#finish').click(); await page.locator('#confirm').click();
  const review = page.locator('#reviews details').first();
  assert.match(await review.locator('summary').textContent(), /Acertou/);
  await review.locator('summary').click();
  await verifyTable(review);
  assert.equal(await review.locator('.option.correct').count(), 1);
  await page.locator('#dashboard').click();

  await page.locator('#study-start').click();
  await verifyTable(page.locator('.quiz-layout > section'));
  await verifyAlternatives(page, 'study-answer');
  await page.locator('[name=study-answer][value="1"]').check();
  await page.locator('#study-check').click();
  assert.match(await page.locator('.study-feedback').textContent(), /Você acertou/);
  const explanation = await page.locator('.option.correct .explanation').textContent();
  assert.match(explanation, /name/i);
  assert.match(explanation, /IP/i);
  assert.doesNotMatch(explanation, /rule is based on IP|rule is based on the IP/i);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(done => navigator.serviceWorker.addEventListener('controllerchange', done, { once: true }));
  });
  await context.setOffline(true);
  await page.reload(); await page.locator('#study-start').click();
  await verifyTable(page.locator('.quiz-layout > section'));
  assert.match(await page.locator('.study-feedback').textContent(), /Você acertou/);
  assert.equal(await page.locator('[name=study-answer][value="1"]:checked:disabled').count(), 1);
  const savedStudy = await page.evaluate(() => JSON.parse(localStorage.getItem('cis-df-offline-progress-v1')).studies[0]);
  assert.equal(savedStudy.state.ids[0], '2-50');
  assert.equal(savedStudy.state.confirmed['2-50'], true);
  assert.deepEqual(savedStudy.state.answers['2-50'], [1]);
  await page.locator('#study-back').click();

  await page.locator('.flashcards summary').click();
  await verifyTable(page.locator('.flashcard-face'));
  await page.locator('[data-fc-flip]').click();
  assert.match(await page.locator('.flashcard-answer').textContent(), /CI1:.*CI2:/s);
  assert.match(await page.locator('.flashcard-answer audio').getAttribute('src'), /audio\/2-50\.mp3\?v=2$/);
  await page.locator('#audio-question').selectOption(String(questionIndex));
  const transcript = await page.locator('#audio-transcript').textContent();
  for (const term of ['Hardware', 'serial_number', 'name', 'Network Adapter', 'mac_address', '200', '300', '400', 'CI1', 'CI2']) {
    assert.ok(transcript.includes(term), `Missing context in audio transcript: ${term}`);
  }
  assert.match(await page.locator('#question-audio').getAttribute('src'), /audio\/2-50\.mp3\?v=2$/);
  await context.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.route('https://**/*', route => route.abort());
  const phone = await mobile.newPage();
  phone.on('pageerror', error => errors.push(error.message));
  await seed(phone); await phone.locator('#study-start').click();
  await verifyTable(phone.locator('.quiz-layout > section'));
  await verifyAlternatives(phone, 'study-answer');
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await mkdir(resolve(root, 'test-results'), { recursive: true });
  await phone.screenshot({ path: resolve(root, 'test-results/identification-mobile.png'), fullPage: true });
  await phone.locator('[name=study-answer][value="1"]').check();
  await phone.locator('#study-check').click();
  assert.match(await phone.locator('.study-feedback').textContent(), /Você acertou/);
  await mobile.close();
  assert.deepEqual(errors, []);
  console.log('PASS: Hardware identifier table and readable alternatives in quiz/study/reviews/flashcards, correct grading, offline persistence, versioned audio/transcript and mobile layout');
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
