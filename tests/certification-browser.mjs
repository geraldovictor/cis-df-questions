// Run with PLAYWRIGHT_PATH pointing to an installed playwright-core entry point.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';
import { loadQuestionBank } from '../certification.js';
import { createAttempt } from '../quiz.js';
import { createStudy } from '../study.js';

const { chromium } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_PATH)).href);
const root = fileURLToPath(new URL('../', import.meta.url));
const courses = [
  { id: 'cis-df', count: 205, examSize: 75, audio: 'audio/' },
  { id: 'cis-em', count: 118, examSize: 30, audio: 'audio/cis-em/' },
  { id: 'cis-cad', count: 151, examSize: 60, audio: 'audio/cis-cad/' }
];
const server = createServer(async (req, res) => {
  const path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!path.startsWith(root.endsWith(sep) ? root : root + sep) && path !== resolve(root)) { res.writeHead(403).end(); return; }
  const target = path === resolve(root) ? resolve(root, 'index.html') : path;
  try {
    const bytes = await readFile(target);
    res.writeHead(200, { 'Content-Type': ({ '.js': 'text/javascript', '.json': 'application/json', '.html': 'text/html', '.css': 'text/css', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json', '.png': 'image/png' })[extname(target)] || 'application/octet-stream' });
    res.end(bytes);
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/`;
const progressKey = id => `${id}-offline-progress-v1`;
const flashKey = id => `${id}-flashcards-offline-guest`;
const memoryKey = id => `${id}-memory-v1-offline-guest`;
const saved = (page, key) => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
const errors = [];
let browser;

async function selectCourse(page, course) {
  await page.locator(`[data-certification="${course.id}"]`).click();
  await page.locator('#start').waitFor();
  assert.equal(new URL(page.url()).searchParams.get('cert'), course.id);
  assert.equal(await page.locator('#certifications [aria-current="page"]').getAttribute('data-certification'), course.id);
  assert.equal(await page.locator('#audio-question option').count(), course.count);
}

async function answerCorrectly(page, course, mode) {
  const question = await page.evaluate(async ({ certification, mode }) => {
    const { loadQuestionBank } = await import('./certification.js');
    const { getMatchingQuestion } = await import('./matching.js');
    const questions = await loadQuestionBank(certification);
    const progress = JSON.parse(localStorage.getItem(`${certification}-offline-progress-v1`));
    const attempt = (mode === 'study' ? progress.studies : progress.attempts).find(item => !item.finished_at);
    const question = questions.find(item => item.id === attempt.state.ids[attempt.state.cursor]);
    const matching = getMatchingQuestion(question);
    return { id: question.id, matching: matching?.solution, correct: question.alternativas.flatMap((answer, index) => answer.correta ? [index] : []) };
  }, { certification: course.id, mode });
  if (question.matching) {
    for (const [target, item] of Object.entries(question.matching)) {
      await page.locator(`[data-match-item="${item}"]`).click();
      await page.locator(`[data-match-place="${target}"]`).click();
    }
  } else {
    const name = mode === 'study' ? 'study-answer' : 'answer';
    for (const index of question.correct) await page.locator(`[name="${name}"][value="${index}"]`).check();
  }
  return question.id;
}

async function downloadCourseAudio(page, course) {
  await selectCourse(page, course);
  await page.locator('[data-offline-audio]').click();
  await page.locator('[data-offline-audio-status]').filter({ hasText: `Todos os ${course.count} áudios` }).waitFor();
  const missing = await page.evaluate(async certification => {
    const { loadQuestionBank } = await import('./certification.js');
    const { questionAudioPath } = await import('./question-content.js');
    const { AUDIO_CACHE } = await import('./offline.js');
    const questions = await loadQuestionBank(certification), cache = await caches.open(AUDIO_CACHE);
    const saved = new Set((await cache.keys()).map(request => request.url));
    return questions.map(question => new URL(questionAudioPath(question), location.href).href).filter(url => !saved.has(url));
  }, course.id);
  assert.deepEqual(missing, [], `Every ${course.id} recording must be cached`);
}

async function assertOfflineAudio(page, course) {
  const metadata = await page.evaluate(async () => {
    const player = document.querySelector('#question-audio');
    await new Promise((resolve, reject) => {
      player.addEventListener('loadedmetadata', resolve, { once: true });
      player.addEventListener('error', () => reject(new Error('Cached audio failed to load')), { once: true });
      player.load();
    });
    await player.play();
    return { duration: player.duration, src: player.src };
  });
  assert.ok(Number.isFinite(metadata.duration) && metadata.duration > 0, `${course.id} recording should have a finite duration`);
  await page.waitForFunction(() => document.querySelector('#question-audio').currentTime > 0.05);
  await page.evaluate(() => document.querySelector('#question-audio').pause());
  const range = await page.evaluate(async src => {
    const response = await fetch(src, { headers: { Range: 'bytes=10-99' } });
    return { status: response.status, type: response.headers.get('Content-Type'), length: (await response.arrayBuffer()).byteLength };
  }, metadata.src);
  assert.deepEqual(range, { status: 206, type: 'audio/mpeg', length: 90 });
}

async function assertContextImages(page, course) {
  const imageQuestions = await page.evaluate(async certification => {
    const { loadQuestionBank } = await import('./certification.js');
    const questions = await loadQuestionBank(certification);
    return questions.filter(question => /\.png/i.test(JSON.stringify(question.contexto || {}))).map(question => question.id);
  }, course.id);
  assert.ok(imageQuestions.length > 0, 'CIS-EM should retain its source screenshots');
  await page.locator('#study-start').click();
  const state = (await saved(page, progressKey(course.id))).studies[0].state;
  for (const id of imageQuestions) {
    await page.locator(`[data-study-jump="${state.ids.indexOf(id)}"]`).click();
    await page.locator('.question-context img').first().waitFor();
    const images = await page.locator('.question-context img').evaluateAll(images => Promise.all(images.map(image => new Promise(resolve => {
      if (image.complete) resolve({ src: image.getAttribute('src'), width: image.naturalWidth });
      else { image.onload = () => resolve({ src: image.getAttribute('src'), width: image.naturalWidth }); image.onerror = () => resolve({ src: image.getAttribute('src'), width: 0 }); }
    }))));
    assert.ok(images.length > 0);
    for (const image of images) assert.ok(image.width > 0, `Context image did not load: ${image.src}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'Mobile context should fit its viewport');
  await page.screenshot({ path: resolve(root, 'test-results/certification-em-context.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.locator('[data-study-jump="1"]').click();
  await page.locator('#study-back').click();
}

async function assertAccountIsolation(browser) {
  const accountId = 'account-test', fixtures = { attempts: [], study_sessions: [] }, pending = {};
  for (const [index, course] of courses.entries()) {
    const questions = await loadQuestionBank(course.id, async file => new Response(await readFile(fileURLToPath(file))));
    for (const [table, create] of [['attempts', createAttempt], ['study_sessions', createStudy]]) {
      for (let done = 0; done <= index; done++) {
        const record = create(questions, accountId, course.id);
        record.finished_at = new Date().toISOString(); record.score = 0;
        if (course.id === 'cis-df') delete record.state.certification;
        fixtures[table].push(record);
      }
      const ongoing = create(questions, accountId, course.id);
      ongoing.state.cursor = index;
      if (course.id === 'cis-df') delete ongoing.state.certification;
      fixtures[table].push(ongoing);
      const snapshot = JSON.parse(JSON.stringify(ongoing));
      snapshot.state.cursor = index + 2;
      const feature = table === 'attempts' ? 'pending' : 'study-pending';
      pending[`${course.id}-${feature}-${accountId}`] = snapshot;
    }
  }
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 960 } });
  await context.addInitScript(({ fixtures, pending }) => {
    if (localStorage.getItem('__testInitialized')) return;
    localStorage.setItem('__testInitialized', 'true');
    for (const [table, records] of Object.entries(fixtures)) localStorage.setItem(`__testRows-${table}`, JSON.stringify(records));
    for (const [key, record] of Object.entries(pending)) localStorage.setItem(key, JSON.stringify(record));
    localStorage.setItem('__testUpserts', '[]');
  }, { fixtures, pending });
  await context.route('https://**/*', route => route.abort());
  await context.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm', route => route.fulfill({ contentType: 'text/javascript', body: `
    export function createClient() {
      const user={id:'account-test',email:'test@example.com'};
      let callback,session=localStorage.getItem('__testSession')?{user}:null;
      return {auth:{
        onAuthStateChange(fn){callback=fn;setTimeout(()=>fn('INITIAL_SESSION',session),0);},
        async getSession(){return {data:{session},error:null};},
        async signInWithPassword(){session={user};localStorage.setItem('__testSession','true');callback('SIGNED_IN',session);return {data:{session},error:null};},
        async signOut(){session=null;localStorage.removeItem('__testSession');callback('SIGNED_OUT',null);return {error:null};}
      },from(table){return {
        select(){return {async order(){return {data:JSON.parse(localStorage.getItem('__testRows-'+table)||'[]'),error:null};}};},
        async upsert(data){
          const rows=JSON.parse(localStorage.getItem('__testRows-'+table)||'[]');
          const index=rows.findIndex(row=>row.id===data.id);
          if(index<0)rows.push(data);else rows[index]=data;
          localStorage.setItem('__testRows-'+table,JSON.stringify(rows));
          const writes=JSON.parse(localStorage.getItem('__testUpserts'));
          writes.push({table,data});localStorage.setItem('__testUpserts',JSON.stringify(writes));
          return {error:null};
        }
      };}};
    }` }));
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${url}?cert=cis-df`);
  await page.locator('[name=email]:not([disabled])').fill('test@example.com');
  await page.locator('[name=password]').fill('password123');
  await page.locator('#auth-form button').click();
  await page.locator('#start').waitFor();
  for (const [index, course] of courses.entries()) {
    await selectCourse(page, course);
    assert.equal(await page.locator('[data-review]').count(), index + 1, 'Account quiz history must include only the selected course');
    assert.equal(await page.locator('[data-study-review]').count(), index + 1, 'Account study history must include only the selected course');
    assert.equal(await saved(page, `${course.id}-pending-${accountId}`), null);
    assert.equal(await saved(page, `${course.id}-study-pending-${accountId}`), null);
    assert.equal(await saved(page, progressKey(course.id)), null, 'Account synchronization must not create guest progress');
    for (const other of courses.slice(index + 1)) {
      assert.ok(await saved(page, `${other.id}-pending-${accountId}`), 'Other courses keep their pending quiz writes');
      assert.ok(await saved(page, `${other.id}-study-pending-${accountId}`), 'Other courses keep their pending study writes');
    }
    await page.locator('#start').click();
    assert.match(await page.locator('.quiz-layout .eyebrow').first().textContent(), new RegExp(`Questão ${index + 3} de ${course.examSize}`));
    await page.locator('#back').click();
    await page.locator('#study-start').click();
    assert.match(await page.locator('.quiz-layout .eyebrow').first().textContent(), new RegExp(`Questão ${index + 3} de ${course.count}`));
    await page.locator('#study-back').click();
    const writes = await saved(page, '__testUpserts');
    const visited = new Set(courses.slice(0, index + 1).map(item => item.id));
    for (const write of writes) {
      assert.equal(write.data.user_id, accountId);
      assert.ok(visited.has(write.data.state.certification || 'cis-df'), 'An unvisited course must not be synchronized');
    }
  }
  await context.close();
}

async function assertCadSupplement(browser) {
  const course = courses.find(item => item.id === 'cis-cad');
  const questions = await loadQuestionBank(course.id, async file => new Response(await readFile(fileURLToPath(file))));
  const added = questions.find(question => question.id === 'cad-srNSvJT2oarIvswoZGsi');
  const original = questions.filter(question => question.id !== added.id), lastOriginal = original.at(-1);
  assert.equal(original.length, 150);
  const quiz = createAttempt(original, 'offline-guest', course.id), study = createStudy(original, 'offline-guest', course.id);
  quiz.state.cursor = 2; study.state.cursor = 3;
  quiz.state.answers[quiz.state.ids[0]] = [0];
  const progress = { attempts: [quiz], studies: [study] };
  const knownId = original[0].id;
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
  await context.route('https://**/*', route => route.abort());
  await context.addInitScript(({ progress, knownId, ids, lastId }) => {
    if (localStorage.getItem('__supplementSeeded')) return;
    localStorage.setItem('__supplementSeeded', 'true');
    localStorage.setItem('cis-cad-offline-progress-v1', JSON.stringify(progress));
    localStorage.setItem('cis-cad-flashcards-offline-guest', JSON.stringify({ marks: { [knownId]: 'known' }, currentId: lastId }));
    localStorage.setItem('cis-cad-memory-v1-offline-guest', JSON.stringify({ marks: { [knownId]: 'known' }, order: ids, currentId: lastId, mode: 'learn', filter: 'all' }));
  }, { progress, knownId, ids: original.map(question => question.id), lastId: lastOriginal.id });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${url}?cert=cis-cad&mode=offline`);
  await page.locator('#start').waitFor();
  assert.deepEqual(await saved(page, progressKey(course.id)), progress);
  assert.equal(await page.locator('#audio-question option').count(), 151);
  await page.locator('#start').click();
  assert.match(await page.locator('.quiz-layout .eyebrow').first().textContent(), /Questão 3 de 60/);
  await page.locator('#back').click();
  assert.deepEqual((await saved(page, progressKey(course.id))).attempts[0], quiz);
  await page.locator('#study-start').click();
  assert.match(await page.locator('.quiz-layout .eyebrow').first().textContent(), /Questão 4 de 150/);
  await page.locator('#study-finish').click();
  await page.locator('#study-confirm-finish').click();
  await page.locator('#study-back').click();
  await page.locator('#study-start').click();
  const expanded = (await saved(page, progressKey(course.id))).studies.find(item => !item.finished_at);
  assert.equal(expanded.total, 151);
  assert.ok(expanded.state.ids.includes(added.id));
  await page.locator(`[data-study-jump="${expanded.state.ids.indexOf(added.id)}"]`).click();
  assert.equal(await page.locator('.question-title').textContent(), added.pergunta);
  await answerCorrectly(page, course, 'study');
  await page.locator('#study-check').click();
  assert.match(await page.locator('.study-feedback').textContent(), /Você acertou/);
  await page.locator('#study-back').click();
  await page.locator('.flashcards > summary').click();
  assert.equal(await page.locator('.flashcard-face h3').textContent(), lastOriginal.pergunta);
  assert.match(await page.locator('[data-fc-stats]').textContent(), /1 já sei/);
  await page.locator('[data-fc-next]').click();
  assert.equal(await page.locator('.flashcard-face h3').textContent(), added.pergunta);
  await page.locator('[data-fc-flip]').click();
  assert.ok((await page.locator('.flashcard-answer').textContent()).includes('Can create, Can update, and Can delete'));
  await page.locator('[data-fc-rate="known"]').click();
  assert.equal((await saved(page, flashKey(course.id))).marks[knownId], 'known');
  assert.equal((await saved(page, flashKey(course.id))).marks[added.id], 'known');
  await page.locator('#memory-start').click();
  await page.locator('[data-memory-jump]').waitFor();
  assert.equal(await page.locator('[data-memory-jump] option').count(), 151);
  assert.equal(await page.locator('[data-memory-jump]').inputValue(), lastOriginal.id);
  await page.locator('[data-memory-jump]').selectOption(added.id);
  await page.locator('[data-memory-reveal]').click();
  assert.ok((await page.locator('.memory-answer').textContent()).includes('Can create, Can update, and Can delete'));
  await page.locator('[data-memory-rate="known"]').click();
  const memory = await saved(page, memoryKey(course.id));
  assert.equal(memory.marks[knownId], 'known');
  assert.equal(memory.marks[added.id], 'known');
  assert.equal(memory.order.at(-1), added.id);
  await page.locator('[data-memory-back]').click();
  await page.locator('#audio-question').selectOption(String(questions.indexOf(added)));
  assert.ok((await page.locator('#question-audio').getAttribute('src')).endsWith(`/audio/cis-cad/${added.id}.mp3`));
  await downloadCourseAudio(page, course);
  await context.setOffline(true);
  await page.reload();
  await page.locator('#start').waitFor();
  assert.ok((await page.locator('#question-audio').getAttribute('src')).endsWith(`/audio/cis-cad/${added.id}.mp3`));
  await assertOfflineAudio(page, course);
  await context.close();
}

async function assertEmSupplements(browser) {
  const course = courses.find(item => item.id === 'cis-em');
  const questions = await loadQuestionBank(course.id, async file => new Response(await readFile(fileURLToPath(file))));
  const addedIds = ['em-user-provided-126-alert-automation', 'em-user-provided-127-pull-connector'];
  const added = addedIds.map(id => questions.find(question => question.id === id));
  assert.ok(added.every(Boolean), 'Both supplied EM questions must be available');
  const original = questions.filter(question => !addedIds.includes(question.id));
  assert.equal(original.length, 116);
  const originalIds = original.map(question => question.id), knownId = original[0].id, lastOriginal = original.at(-1);
  const quiz = createAttempt(original, 'offline-guest', course.id), study = createStudy(original, 'offline-guest', course.id);
  quiz.state.cursor = 2; study.state.cursor = 3;
  quiz.state.answers[quiz.state.ids[0]] = [0];
  const progress = { attempts: [quiz], studies: [study] };
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
  await context.route('https://**/*', route => route.abort());
  await context.addInitScript(({ progress, knownId, originalIds, lastId }) => {
    if (localStorage.getItem('__emSupplementSeeded')) return;
    localStorage.setItem('__emSupplementSeeded', 'true');
    localStorage.setItem('cis-em-offline-progress-v1', JSON.stringify(progress));
    localStorage.setItem('cis-em-flashcards-offline-guest', JSON.stringify({ marks: { [knownId]: 'known' }, currentId: lastId }));
    localStorage.setItem('cis-em-memory-v1-offline-guest', JSON.stringify({ marks: { [knownId]: 'known' }, order: originalIds, currentId: lastId, mode: 'learn', filter: 'all' }));
  }, { progress, knownId, originalIds, lastId: lastOriginal.id });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${url}?cert=cis-em&mode=offline`);
  await page.locator('#start').waitFor();
  assert.deepEqual(await saved(page, progressKey(course.id)), progress);
  assert.equal(await page.locator('#audio-question option').count(), 118);
  await page.locator('#start').click();
  assert.match(await page.locator('.quiz-layout .eyebrow').first().textContent(), /Questão 3 de 30/);
  await page.locator('#back').click();
  assert.deepEqual((await saved(page, progressKey(course.id))).attempts[0], quiz);
  await page.locator('#study-start').click();
  assert.match(await page.locator('.quiz-layout .eyebrow').first().textContent(), /Questão 4 de 116/);
  assert.equal(await page.locator('[data-study-jump]').count(), 116);
  assert.deepEqual((await saved(page, progressKey(course.id))).studies[0], study);
  await page.locator('#study-finish').click();
  await page.locator('#study-confirm-finish').click();
  await page.locator('#study-back').click();
  assert.equal((await saved(page, progressKey(course.id))).studies[0].total, 116);
  await page.locator('#study-start').click();
  const expanded = (await saved(page, progressKey(course.id))).studies.find(item => !item.finished_at);
  assert.equal(expanded.total, 118);
  assert.ok(addedIds.every(id => expanded.state.ids.includes(id)));
  const answers = [[0], [0, 1, 2, 5]];
  for (const [index, question] of added.entries()) {
    await page.locator(`[data-study-jump="${expanded.state.ids.indexOf(question.id)}"]`).click();
    assert.equal(await page.locator('.question-title').textContent(), question.pergunta);
    if (index === 1) assert.equal(await page.locator('[name="study-answer"][type="checkbox"]').count(), 6);
    for (const answer of answers[index]) await page.locator(`[name="study-answer"][value="${answer}"]`).check();
    assert.equal(await page.locator('[name="study-answer"]:checked').count(), answers[index].length);
    await page.locator('#study-check').click();
    assert.match(await page.locator('.study-feedback').textContent(), /Você acertou/);
    assert.equal(await page.locator('[name="study-answer"]:enabled').count(), 0);
    const confirmed = (await saved(page, progressKey(course.id))).studies.find(item => !item.finished_at);
    assert.equal(confirmed.state.confirmed[question.id], true);
    assert.deepEqual([...confirmed.state.answers[question.id]].sort((a, b) => a - b), answers[index]);
    assert.equal(Object.keys(confirmed.state.confirmed).length, index + 1);
  }
  await page.locator(`[data-study-jump="${expanded.state.ids.indexOf(addedIds[0])}"]`).click();
  assert.equal(await page.locator('#study-check').count(), 0, 'A confirmed answer cannot be counted again');
  assert.match(await page.locator('.study-metrics').textContent(), /2 acertos.*0 erros/s);
  await page.locator('#study-back').click();
  assert.equal(Object.keys((await saved(page, progressKey(course.id))).studies.find(item => !item.finished_at).state.confirmed).length, 2);

  await page.locator('.flashcards > summary').click();
  assert.equal(await page.locator('.flashcard-face h3').textContent(), lastOriginal.pergunta);
  for (const [index, question] of added.entries()) {
    if (index === 0) await page.locator('[data-fc-next]').click();
    assert.equal(await page.locator('.flashcard-face h3').textContent(), question.pergunta);
    await page.locator('[data-fc-flip]').click();
    for (const answer of answers[index]) assert.ok((await page.locator('.flashcard-answer').textContent()).includes(question.alternativas[answer].texto));
    assert.ok((await page.locator('.flashcard-answer audio').getAttribute('src')).endsWith(`audio/cis-em/${question.id}.mp3`));
    await page.locator('[data-fc-rate="known"]').click();
  }
  const flashcards = await saved(page, flashKey(course.id));
  for (const id of [knownId, ...addedIds]) assert.equal(flashcards.marks[id], 'known');
  await page.locator('#memory-start').click();
  await page.locator('[data-memory-reveal]').waitFor();
  await page.locator(`[data-memory-jump] option[value="${addedIds[1]}"]`).waitFor({ state: 'attached' });
  assert.equal(await page.locator('[data-memory-jump] option').count(), 118);
  assert.equal(await page.locator('[data-memory-jump]').inputValue(), lastOriginal.id);
  for (const [index, question] of added.entries()) {
    await page.locator('[data-memory-jump]').selectOption(question.id);
    await page.locator('[data-memory-reveal]').click();
    for (const answer of answers[index]) assert.ok((await page.locator('.memory-answer').textContent()).includes(question.alternativas[answer].texto));
    assert.ok((await page.locator('.memory-answer audio').getAttribute('src')).endsWith(`audio/cis-em/${question.id}.mp3`));
    await page.locator('[data-memory-rate="known"]').click();
  }
  const memory = await saved(page, memoryKey(course.id));
  for (const id of [knownId, ...addedIds]) assert.equal(memory.marks[id], 'known');
  assert.deepEqual(memory.order.slice(0, 116), originalIds);
  assert.deepEqual(memory.order.slice(116), addedIds);
  await page.locator('[data-memory-back]').click();
  await downloadCourseAudio(page, course);
  await context.setOffline(true);
  await page.reload();
  await page.locator('#start').waitFor();
  for (const question of added) {
    await page.locator('#audio-question').selectOption(String(questions.indexOf(question)));
    assert.ok((await page.locator('#question-audio').getAttribute('src')).endsWith(`/audio/cis-em/${question.id}.mp3`));
    await assertOfflineAudio(page, course);
  }
  await context.close();
}

async function assertHotspotAnswerVisibility(browser) {
  const course = courses.find(item => item.id === 'cis-em');
  const questions = await loadQuestionBank(course.id, async file => new Response(await readFile(fileURLToPath(file))));
  const question = questions.find(item => item.fonte?.imagens_resposta?.some(path => path.endsWith('/image19.png')));
  assert.ok(question, 'The source hotspot needs its original answer screenshot');
  const study = createStudy(questions, 'offline-guest', course.id);
  const quiz = createAttempt(questions, 'offline-guest', course.id);
  study.state.ids = [question.id, ...study.state.ids.filter(id => id !== question.id)];
  quiz.state.ids = [question.id, ...questions.filter(item => item.id !== question.id).map(item => item.id)].slice(0, course.examSize);
  quiz.state.orders = Object.fromEntries(questions.map(item => [item.id, item.alternativas.map((_, index) => index)]));
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 960 } });
  await context.addInitScript(({ study, quiz, questionId }) => {
    localStorage.setItem('cis-em-offline-progress-v1', JSON.stringify({ attempts: [quiz], studies: [study] }));
    localStorage.setItem('cis-em-flashcards-offline-guest', JSON.stringify({ marks: {}, currentId: questionId }));
    localStorage.setItem('cis-em-memory-v1-offline-guest', JSON.stringify({ marks: {}, currentId: questionId, mode: 'test' }));
  }, { study, quiz, questionId: question.id });
  await context.route('https://**/*', route => route.abort());
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const promptImage = page.locator('img[src$="/image18.png"]');
  const answerImage = page.locator('img[src$="/image19.png"]');
  const expandAnswer = async () => {
    assert.equal(await page.locator('.question-answer-image').count(), 1);
    assert.equal(await answerImage.isVisible(), false, 'The original answer image starts collapsed');
    await page.locator('.question-answer-image > summary').click();
    assert.equal(await answerImage.isVisible(), true);
    assert.equal(await answerImage.evaluate(image => image.complete && image.naturalWidth > 0 || image.decode().then(() => image.naturalWidth > 0)), true);
  };
  await page.goto(`${url}?cert=cis-em&mode=offline`);
  await page.locator('#study-start').click();
  assert.equal(await promptImage.isVisible(), true);
  assert.equal(await answerImage.count(), 0, 'An unanswered study must not include the answer image');
  await answerCorrectly(page, course, 'study');
  assert.equal(await answerImage.count(), 0, 'Choosing matches does not reveal the answer image');
  await page.locator('#study-check').click();
  assert.match(await page.locator('.study-feedback').textContent(), /Você acertou/);
  await expandAnswer();
  await page.locator('#study-back').click();

  await page.locator('#start').click();
  assert.equal(await promptImage.isVisible(), true);
  assert.equal(await answerImage.count(), 0, 'An active simulation must not include the answer image');
  await answerCorrectly(page, course, 'quiz');
  await page.locator('#finish').click();
  await page.locator('#confirm').click();
  await page.locator('.review-item > summary').first().click();
  await expandAnswer();
  await page.locator('#dashboard').click();

  await page.locator('.flashcards > summary').click();
  assert.equal(await promptImage.isVisible(), true);
  assert.equal(await answerImage.count(), 0, 'An unrevealed flashcard must not include the answer image');
  await page.locator('[data-fc-flip]').click();
  await expandAnswer();

  await page.locator('#memory-start').click();
  await page.locator('[data-memory-reveal]').waitFor();
  await page.locator('.memory-question > summary').click();
  assert.equal(await promptImage.isVisible(), true);
  assert.equal(await answerImage.count(), 0, 'An unrevealed memory test must not include the answer image');
  await page.locator('[data-memory-reveal]').click();
  await expandAnswer();
  await context.close();
}

try {
  await mkdir(resolve(root, 'test-results'), { recursive: true });
  browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
  await context.route('https://**/*', route => route.abort());
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${url}?cert=cis-df&mode=offline`);
  await page.locator('#start').waitFor();
  await page.locator('[data-offline-status]').filter({ hasText: 'estão prontos' }).waitFor();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(done => navigator.serviceWorker.addEventListener('controllerchange', done, { once: true }));
  });

  const snapshots = {};
  for (const [index, course] of courses.entries()) {
    await selectCourse(page, course);
    assert.equal(await page.locator('[data-review]').count(), 0);
    assert.match(await page.locator('#start').textContent(), /Começar/);
    assert.match(await page.locator('[data-fc-stats]').textContent(), /0 já sei/);
    const audio = await page.locator('#question-audio').getAttribute('src');
    assert.ok(new URL(audio).pathname.startsWith('/' + course.audio));
    if (course.id === 'cis-df') assert.match(new URL(audio).pathname, /^\/audio\/\d+-\d+\.mp3$/);

    await page.locator('.flashcards > summary').click();
    for (let mark = 0; mark <= index; mark++) {
      await page.locator('[data-fc-flip]').click();
      await page.locator('[data-fc-rate="known"]').click();
    }
    assert.match(await page.locator('[data-fc-stats]').textContent(), new RegExp(`${index + 1} já sei`));

    await page.locator('#memory-start').click();
    await page.locator('[data-memory-reveal]').waitFor();
    assert.equal(await page.locator('[data-memory-jump] option').count(), course.count);
    assert.match(await page.locator('[data-memory-stats]').textContent(), /0 decorei.*0 ainda confundo/s);
    for (let mark = 0; mark <= index; mark++) {
      await page.locator('[data-memory-reveal]').click();
      await page.locator('[data-memory-rate="review"]').click();
    }
    await page.locator('[data-memory-back]').click();

    await page.locator('#study-start').click();
    const studyId = await answerCorrectly(page, course, 'study');
    await page.locator('#study-check').click();
    assert.match(await page.locator('.study-feedback').textContent(), /Você acertou/);
    await page.locator('#study-next').click();
    await page.locator('#study-back').click();
    if (course.id === 'cis-em') await assertContextImages(page, course);

    await page.locator('#start').click();
    assert.equal(await page.locator('[data-jump]').count(), course.examSize);
    assert.match(await page.locator('.quiz-heading .tag').textContent(), new RegExp(`Simulado de ${course.examSize} questões`));
    const quizId = await answerCorrectly(page, course, 'quiz');
    await page.locator('#next').click();
    const progress = await saved(page, progressKey(course.id));
    assert.equal(progress.attempts[0].state.certification, course.id);
    assert.equal(progress.attempts[0].total, course.examSize);
    assert.equal(progress.studies[0].state.certification, course.id);
    assert.equal(progress.attempts[0].state.cursor, 1);
    assert.equal(progress.studies[0].state.cursor, 1);
    assert.equal(progress.studies[0].state.confirmed[studyId], true);
    assert.ok(progress.attempts[0].state.answers[quizId].length > 0);
    snapshots[course.id] = { progress, flashcards: await saved(page, flashKey(course.id)), memory: await saved(page, memoryKey(course.id)) };
  }

  for (const course of courses.filter(item => item.id !== 'cis-df')) await downloadCourseAudio(page, course);

  // Full navigations must keep every bank and its progress usable without a network.
  await context.setOffline(true);
  for (const [index, course] of courses.entries()) {
    await selectCourse(page, course);
    assert.equal(await page.evaluate(() => navigator.onLine), false);
    if (course.id !== 'cis-df') await assertOfflineAudio(page, course);
    assert.deepEqual(await saved(page, progressKey(course.id)), snapshots[course.id].progress);
    assert.deepEqual(await saved(page, flashKey(course.id)), snapshots[course.id].flashcards);
    assert.deepEqual(await saved(page, memoryKey(course.id)), snapshots[course.id].memory);
    assert.match(await page.locator('[data-fc-stats]').textContent(), new RegExp(`${index + 1} já sei`));
    await page.locator('#start').click();
    assert.match(await page.locator('.quiz-layout .eyebrow').first().textContent(), new RegExp(`Questão 2 de ${course.examSize}`));
    await page.locator('#back').click();
    await page.locator('#study-start').click();
    assert.match(await page.locator('.quiz-layout .eyebrow').first().textContent(), new RegExp(`Questão 2 de ${course.count}`));
    await page.locator('#study-back').click();
    await page.locator('#memory-start').click();
    await page.locator('[data-memory-reveal]').waitFor();
    assert.match(await page.locator('[data-memory-stats]').textContent(), new RegExp(`${index + 1} ainda confundo`));
    assert.equal(await page.locator('[data-memory-jump]').inputValue(), snapshots[course.id].memory.currentId);
    await page.locator('[data-memory-back]').click();
    if (course.id === 'cis-em') await assertContextImages(page, course);
  }

  // Completed histories appear only in their own certification.
  for (const [index, course] of courses.entries()) {
    await selectCourse(page, course);
    assert.equal(await page.locator('[data-review]').count(), 0);
    await page.locator('#start').click();
    if (course.id === 'cis-df') await page.locator('#finish').click();
    else {
      await page.locator(`[data-jump="${course.examSize - 1}"]`).click();
      assert.match(await page.locator('#next').textContent(), /Revisar e finalizar/);
      await page.locator('#next').click();
    }
    assert.match(await page.locator('.result-banner p').textContent(), new RegExp(`Você respondeu 1 de ${course.examSize} questões`));
    await page.locator('#confirm').click();
    assert.match(await page.locator('.result-banner p').textContent(), new RegExp(`1 acertos.*${course.examSize - 1} erros ou em branco.*${course.examSize} questões`));
    const completed = (await saved(page, progressKey(course.id))).attempts[0];
    assert.equal(completed.score, 1);
    assert.equal(completed.total, course.examSize);
    assert.ok(completed.finished_at);
    await page.locator('#dashboard').click();
    assert.equal(await page.locator('[data-review]').count(), 1);
    for (const [otherIndex, other] of courses.entries()) {
      await selectCourse(page, other);
      assert.equal(await page.locator('[data-review]').count(), otherIndex <= index ? 1 : 0);
    }
  }
  assert.deepEqual(errors, []);
  await context.close();
  await assertAccountIsolation(browser);
  await assertHotspotAnswerVisibility(browser);
  await assertCadSupplement(browser);
  await assertEmSupplements(browser);
  assert.deepEqual(errors, []);
  console.log('PASS: CIS-DF/CIS-EM/CAD banks, navigation, independent quiz/study/history/flashcard/memory progress, 269 cached EM/CAD recordings and offline playback/ranges, source images, mobile context, offline switching, mocked account history/resume/pending isolation, hotspot answer-image reveal and legacy progress after bank additions');
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
