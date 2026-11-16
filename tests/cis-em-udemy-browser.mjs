// Run with PLAYWRIGHT_PATH and, optionally, BROWSER_PATH after generating available audio.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';
import { loadQuestionBank } from '../certification.js';
import { createAttempt } from '../quiz.js';
import { createStudy, isPracticeStudy, studyProgress } from '../study.js';
import { getMatchingQuestion } from '../matching.js';

const { chromium } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_PATH)).href);
const root = fileURLToPath(new URL('../', import.meta.url));
const report = JSON.parse(await readFile(resolve(root, 'data/cis-em/udemy-import-report.json'), 'utf8'));
const questions = await loadQuestionBank('cis-em', async file => new Response(await readFile(fileURLToPath(file))));
const byId = Object.fromEntries(questions.map(q => [q.id, q]));
const added = report.added_ids.map(id => byId[id]);
const unavailableId = 'em-udemy-c503c58b3715a6aba9db';
assert.deepEqual(questions.filter(q => q.audio_disponivel === false).map(q => q.id), [unavailableId]);
assert.equal(questions.length, 137);
assert.equal(added.length, 19);
const original = questions.slice(0, 116).map(q => report.enrichments.find(entry => entry.id === q.id)?.before_question || q);
const anomalyId = 'em-6HAXF1caPVZapUmb0tqD';
const anomaly = byId[anomalyId];
const originalIds = original.map(q => q.id);
const guest = 'offline-guest', progressKey = 'cis-em-offline-progress-v1';
const flashKey = 'cis-em-flashcards-offline-guest', memoryKey = 'cis-em-memory-v1-offline-guest';
const saved = (page, key) => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
const localProgress = page => saved(page, progressKey);
const practiceRecord = local => local.studies.find(record => isPracticeStudy(record) && !record.finished_at);
const fullRecord = local => local.studies.find(record => !isPracticeStudy(record) && !record.finished_at);
const forcedOrder = (ids, first) => [first, ...ids.filter(id => id !== first)];
const legacyStudy = createStudy(original, guest, 'cis-em');
legacyStudy.state.ids = forcedOrder(legacyStudy.state.ids, anomalyId);
legacyStudy.state.answers[anomalyId] = [1]; legacyStudy.state.confirmed[anomalyId] = true;
const legacyQuiz = createAttempt(original, guest, 'cis-em');
legacyQuiz.state.ids = forcedOrder(originalIds, anomalyId).slice(0, 30);
legacyQuiz.state.orders = Object.fromEntries(legacyQuiz.state.ids.map(id => [id, original.find(q => q.id === id).alternativas.map((_, i) => i).reverse()]));
legacyQuiz.state.answers[anomalyId] = [1];
const legacyProgress = { attempts: [legacyQuiz], studies: [legacyStudy] };
const server = createServer(async (request, response) => {
  const path = resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
  if (!path.startsWith(root.endsWith(sep) ? root : root + sep) && path !== resolve(root)) { response.writeHead(403).end(); return; }
  try {
    const target = path === resolve(root) ? resolve(root, 'index.html') : path;
    const bytes = await readFile(target);
    response.writeHead(200, { 'Content-Type': ({ '.js': 'text/javascript', '.json': 'application/json', '.html': 'text/html', '.css': 'text/css', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json', '.png': 'image/png' })[extname(target)] || 'application/octet-stream' });
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/?cert=cis-em&mode=offline`;
const errors = [];
let browser;

async function selectCorrect(page, question, name) {
  const matching = getMatchingQuestion(question);
  if (matching) {
    for (const [target, item] of Object.entries(matching.solution)) {
      await page.locator(`[data-match-item="${item}"]`).click();
      await page.locator(`[data-match-place="${target}"]`).click();
    }
  } else for (const index of question.alternativas.flatMap((option, i) => option.correta ? [i] : [])) await page.locator(`[name="${name}"][value="${index}"]`).check();
}

async function seedNewQuestionsFirst(page, mode) {
  await page.evaluate(async ({ mode, mandatory }) => {
    const { loadQuestionBank } = await import('./certification.js');
    const { saveLocalAttempt } = await import('./offline.js');
    const { isPracticeStudy } = await import('./study.js');
    const questions = await loadQuestionBank('cis-em'), byId = Object.fromEntries(questions.map(q => [q.id, q]));
    const progress = JSON.parse(localStorage.getItem('cis-em-offline-progress-v1'));
    const record = mode === 'quiz' ? progress.attempts.find(row => !row.finished_at) : progress.studies.find(row => !row.finished_at && isPracticeStudy(row) === (mode === 'practice'));
    record.state.ids = [...mandatory, ...questions.map(q => q.id).filter(id => !mandatory.includes(id))].slice(0, record.total);
    record.state.orders = Object.fromEntries(record.state.ids.map(id => [id, byId[id].alternativas.map((_, i) => i).reverse()]));
    record.state.answers = {}; record.state.cursor = 0;
    if (record.state.mode === 'study') record.state.confirmed = {};
    saveLocalAttempt(record);
  }, { mode, mandatory: added.map(q => q.id) });
  await page.reload();
  await page.locator(mode === 'practice' ? '#practice-start' : mode === 'quiz' ? '#start' : '#study-start').click();
}

async function answerAllAdded(page, mode) {
  const isQuiz = mode === 'quiz';
  for (const [index, q] of added.entries()) {
    await page.locator(`[${isQuiz ? 'data-jump' : 'data-study-jump'}="${index}"]`).click();
    assert.equal(await page.locator('.question-title').textContent(), q.pergunta);
    assert.equal(await page.locator('.study-feedback').count(), 0);
    assert.equal(await page.locator('.question-answer-image').count(), 0);
    if (q.contexto) {
      const contextText = await page.locator('.question-context').textContent();
      assert.match(contextText, /Minimal Score: 9\.5/);
      assert.match(contextText, /9\.047626/);
      assert.match(contextText, /9\.985986/);
      for (const answer of q.alternativas.filter(option => option.correta)) assert.equal(contextText.includes(answer.texto), false);
      assert.equal(await page.locator('.option.correct,.option.wrong,.explanation').count(), 0);
    }
    await selectCorrect(page, q, isQuiz ? 'answer' : 'study-answer');
    if (isQuiz) continue;
    await page.locator('#study-check').click();
    assert.match(await page.locator('.study-feedback').textContent(), /Você acertou/);
    assert.equal(await page.locator('#study-check').count(), 0);
    assert.equal(await page.locator('[name="study-answer"]:enabled').count(), 0);
    const local = await localProgress(page), record = mode === 'practice' ? practiceRecord(local) : fullRecord(local);
    assert.equal(Object.keys(record.state.confirmed).length, index + 1);
    assert.equal(studyProgress(record, byId).correct, index + 1);
  }
}

try {
  await mkdir(resolve(root, 'test-results'), { recursive: true });
  browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
  await context.route('https://**/*', route => route.abort());
  await context.addInitScript(({ progress, anomalyId, originalIds }) => {
    if (localStorage.getItem('__udemySeeded')) return;
    localStorage.setItem('__udemySeeded', 'true');
    localStorage.setItem('cis-em-offline-progress-v1', JSON.stringify(progress));
    localStorage.setItem('cis-em-flashcards-offline-guest', JSON.stringify({ marks: { [anomalyId]: 'known', [originalIds[0]]: 'known' }, currentId: anomalyId }));
    localStorage.setItem('cis-em-memory-v1-offline-guest', JSON.stringify({ marks: { [anomalyId]: 'known', [originalIds[0]]: 'review' }, order: originalIds, currentId: anomalyId, mode: 'learn', filter: 'all' }));
    localStorage.setItem('cis-em-audio-index', '21');
  }, { progress: legacyProgress, anomalyId, originalIds });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.locator('#practice-start').waitFor();
  await page.locator('[data-offline-status]').filter({ hasText: 'estão prontos' }).waitFor();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(done => navigator.serviceWorker.addEventListener('controllerchange', done, { once: true }));
    const { AUDIO_CACHE } = await import('./offline.js');
    const cache = await caches.open(AUDIO_CACHE);
    await cache.put(new URL('audio/cis-em/em-6HAXF1caPVZapUmb0tqD.mp3', location.href), new Response('stale recording from before the source enrichment', { headers: { 'Content-Type': 'audio/mpeg' } }));
  });
  assert.equal(await page.locator('#audio-question option').count(), 136);
  assert.equal(await page.locator(`#audio-question option[value="${questions.findIndex(q => q.id === unavailableId)}"]`).count(), 0);
  assert.deepEqual(await localProgress(page), legacyProgress);
  assert.equal(new URL(await page.locator('#question-audio').getAttribute('src')).searchParams.get('v'), '2');
  await page.locator('#start').click();
  assert.equal(await page.locator('[name="answer"][value="1"]').isChecked(), true);
  assert.match(await page.locator('.options').textContent(), /9\.047626/);
  assert.match(await page.locator('.options').textContent(), /9\.985986/);
  await page.locator('#back').click();
  await page.locator('#study-start').click();
  assert.equal(await page.locator('[data-study-jump]').count(), 116);
  assert.match(await page.locator('.study-feedback').textContent(), /Você acertou/);
  assert.equal(await page.locator('#study-check').count(), 0);
  assert.equal(await page.locator('[name="study-answer"][value="1"]').isChecked(), true);
  assert.deepEqual(fullRecord(await localProgress(page)), legacyStudy);
  await page.locator('#study-back').click();
  await page.locator('#memory-start').click();
  await page.locator('[data-memory-reveal]').waitFor();
  assert.equal(await page.locator('[data-memory-jump] option').count(), 137);
  assert.equal(await page.locator('[data-memory-jump]').inputValue(), anomalyId);
  await page.locator('[data-memory-reveal]').click();
  assert.match(await page.locator('.memory-answer').textContent(), /9\.985986/);
  await page.locator('[data-memory-back]').click();
  await page.locator('.flashcards > summary').click();
  assert.equal(await page.locator('.flashcard-face h3').textContent(), anomaly.pergunta);
  await page.locator('[data-fc-flip]').click();
  assert.match(await page.locator('.flashcard-answer').textContent(), /9\.985986/);
  assert.match(await page.locator('.flashcard-answer audio').getAttribute('src'), /\?v=2$/);
  assert.deepEqual(await localProgress(page), legacyProgress);
  await page.locator('#study-start').click();
  await page.locator('#study-finish').click();
  await page.locator('#study-confirm-finish').click();
  await page.locator('#study-back').click();
  await page.locator('#start').click();
  await page.locator('#finish').click();
  await page.locator('#confirm').click();
  assert.equal((await localProgress(page)).attempts.find(row => row.id === legacyQuiz.id).score, 1);
  await page.locator('#dashboard').click();
  console.log('PASS: original116 saved state and enriched anomaly preserve original answer indices');
  await page.locator('#study-start').click();
  await seedNewQuestionsFirst(page, 'study');
  assert.equal(await page.locator('[data-study-jump]').count(), 137);
  await answerAllAdded(page, 'study');
  await page.locator('#study-back').click();
  const full = fullRecord(await localProgress(page));
  assert.equal(full.total, 137);
  assert.equal(studyProgress(full, byId).correct, 19);
  await page.locator('#practice-start').click();
  await seedNewQuestionsFirst(page, 'practice');
  assert.equal(await page.locator('[data-study-jump]').count(), 30);
  assert.equal(await page.locator('[role="timer"],#timer,.timer').count(), 0);
  await answerAllAdded(page, 'practice');
  await page.locator('#study-back').click();
  const practice = practiceRecord(await localProgress(page));
  assert.equal(practice.total, 30);
  assert.equal(studyProgress(practice, byId).correct, 19);
  assert.deepEqual(fullRecord(await localProgress(page)), full);
  await page.locator('#start').click();
  await seedNewQuestionsFirst(page, 'quiz');
  assert.equal(await page.locator('[data-jump]').count(), 30);
  await answerAllAdded(page, 'quiz');
  await page.locator('#finish').click();
  await page.locator('#confirm').click();
  const completed = (await localProgress(page)).attempts.find(row => row.id !== legacyQuiz.id);
  assert.equal(completed.score, 19);
  assert.equal(completed.total, 30);
  for (const [index, q] of added.entries()) {
    const review = page.locator('.review-item').nth(index);
    await review.locator(':scope > summary').click();
    assert.equal(await review.locator('.option.correct').count(), q.alternativas.filter(option => option.correta).length);
  }
  await page.locator('#dashboard').click();
  console.log('PASS: all19 additions grade correctly in full study137, practice30 and quiz30');
  await page.evaluate(({ key, id }) => { const stored = JSON.parse(localStorage.getItem(key)); stored.currentId = id; localStorage.setItem(key, JSON.stringify(stored)); }, { key: flashKey, id: added[0].id });
  await page.reload();
  await page.locator('.flashcards > summary').click();
  for (const q of added) {
    assert.equal(await page.locator('.flashcard-face h3').textContent(), q.pergunta);
    await page.locator('[data-fc-flip]').click();
    for (const answer of q.alternativas.filter(option => option.correta)) assert.ok((await page.locator('.flashcard-answer').textContent()).includes(answer.texto));
    if (q.audio_disponivel === false) {
      assert.equal(await page.locator('.flashcard-answer audio').count(), 0);
      assert.match(await page.locator('.flashcard-answer').textContent(), /Áudio indisponível/);
    } else assert.ok((await page.locator('.flashcard-answer audio').getAttribute('src')).includes(`/cis-em/${q.id}.mp3`));
    await page.locator('[data-fc-rate="known"]').click();
  }
  assert.equal((await saved(page, flashKey)).marks[anomalyId], 'known');
  for (const q of added) assert.equal((await saved(page, flashKey)).marks[q.id], 'known');
  await page.locator('#memory-start').click();
  await page.locator('[data-memory-reveal]').waitFor();
  for (const q of added) {
    await page.locator('[data-memory-jump]').selectOption(q.id);
    await page.locator('[data-memory-reveal]').click();
    for (const answer of q.alternativas.filter(option => option.correta)) assert.ok((await page.locator('.memory-answer').textContent()).includes(answer.texto));
    if (q.audio_disponivel === false) {
      assert.equal(await page.locator('.memory-answer audio').count(), 0);
      assert.match(await page.locator('.memory-answer').textContent(), /Áudio indisponível/);
    }
    await page.locator('[data-memory-rate="known"]').click();
  }
  const memory = await saved(page, memoryKey);
  assert.deepEqual(memory.order.slice(0, 116), originalIds);
  assert.equal(memory.marks[anomalyId], 'known');
  assert.equal(memory.marks[originalIds[0]], 'review');
  for (const q of added) assert.equal(memory.marks[q.id], 'known');
  await page.locator('[data-memory-back]').click();
  for (const q of added) {
    if (q.audio_disponivel === false) continue;
    await page.locator('#audio-question').selectOption(String(questions.indexOf(q)));
    assert.ok((await page.locator('#question-audio').getAttribute('src')).includes(`/cis-em/${q.id}.mp3`));
    assert.ok((await page.locator('#audio-transcript').textContent()).includes(q.pergunta));
  }
  console.log('PASS: all19 additions appear in flashcards/memory and available narrations without losing previous marks');
  await page.locator('[data-offline-audio]').click();
  await page.locator('[data-offline-audio-status]').filter({ hasText: 'Todos os 136 áudios' }).waitFor();
  assert.equal(await page.evaluate(async id => {
    const { AUDIO_CACHE } = await import('./offline.js');
    return Boolean(await (await caches.open(AUDIO_CACHE)).match(new URL(`audio/cis-em/${id}.mp3`, location.href).href));
  }, unavailableId), false);
  await context.setOffline(true);
  await page.reload();
  await page.locator('#practice-start').waitFor();
  await page.locator('#audio-question').selectOption('21');
  const playback = await page.evaluate(async () => {
    const player = document.querySelector('#question-audio');
    await new Promise((resolve, reject) => { player.onloadedmetadata = resolve; player.onerror = () => reject(new Error('Updated anomaly audio failed offline')); player.load(); });
    await player.play();
    const response = await fetch(player.src, { headers: { Range: 'bytes=10-99' } });
    player.pause();
    return { src: player.src, duration: player.duration, status: response.status, bytes: (await response.arrayBuffer()).byteLength };
  });
  assert.equal(new URL(playback.src).searchParams.get('v'), '2');
  assert.ok(playback.duration > 0 && Number.isFinite(playback.duration));
  assert.equal(playback.status, 206); assert.equal(playback.bytes, 90);
  await page.locator('#practice-start').click();
  assert.deepEqual(practiceRecord(await localProgress(page)), practice);
  const variant = added.find(q => q.fonte.indice === 28 && q.fonte.arquivo === 'cim-em-udemy4.json');
  await page.locator(`[data-study-jump="${practice.state.ids.indexOf(variant.id)}"]`).click();
  assert.equal(await page.locator('img[src="data/cis-em/images/image10.png"]').evaluate(image => image.complete && image.naturalWidth > 0 || image.decode().then(() => image.naturalWidth > 0)), true);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'Enriched anomaly context fits a mobile viewport');
  await page.screenshot({ path: resolve(root, 'test-results/cis-em-udemy-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  await context.close();
  console.log('PASS: CIS-EM Udemy19 source questions in quiz30/study137/practice30/flashcards/memory, 136 available recordings; original116 progress and anomaly answer indices; updated narration bypasses stale cache; offline resume and mobile context');
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
