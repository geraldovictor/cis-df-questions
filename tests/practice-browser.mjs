// Run with PLAYWRIGHT_PATH pointing to an installed playwright-core entry point.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';
import { loadQuestionBank } from '../certification.js';
import { createAttempt } from '../quiz.js';
import { createStudy, createPractice, studyProgress } from '../study.js';
import { getMatchingQuestion } from '../matching.js';

const { chromium } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_PATH)).href);
const root = fileURLToPath(new URL('../', import.meta.url));
const courses = [
  { id: 'cis-df', count: 205, examSize: 75 },
  { id: 'cis-em', count: 118, examSize: 30 },
  { id: 'cis-cad', count: 151, examSize: 60 },
  { id: 'cis-csm', count: 240, examSize: 60 }
];
const banks = Object.fromEntries(await Promise.all(courses.map(async course => [course.id,
  await loadQuestionBank(course.id, async file => new Response(await readFile(fileURLToPath(file))))])));
const maps = Object.fromEntries(courses.map(course => [course.id, Object.fromEntries(banks[course.id].map(q => [q.id, q]))]));
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
const url = `http://127.0.0.1:${server.address().port}/`;
const localKey = certification => `${certification}-offline-progress-v1`;
const saved = (page, key) => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
const progress = (page, course) => saved(page, localKey(course.id));
const isPractice = record => record.state.variant === 'practice60';
const ongoingPractice = local => local.studies.find(record => !record.finished_at && isPractice(record));
const ongoingFullStudy = local => local.studies.find(record => !record.finished_at && !isPractice(record));
const errors = [];
let browser;

async function selectCourse(page, course) {
  if (new URL(page.url()).searchParams.get('cert') !== course.id) await page.locator(`[data-certification="${course.id}"]`).click();
  await page.locator('#practice-start').waitFor();
  assert.equal(new URL(page.url()).searchParams.get('cert'), course.id);
}

async function selectAnswer(page, question, correct = true) {
  const matching = getMatchingQuestion(question);
  if (matching) {
    assert.ok(correct, 'The wrong-answer scenario uses a multiple-choice question');
    for (const [target, item] of Object.entries(matching.solution)) {
      await page.locator(`[data-match-item="${item}"]`).click();
      await page.locator(`[data-match-place="${target}"]`).click();
    }
    return;
  }
  const selected = question.alternativas.flatMap((answer, index) => answer.correta ? [index] : []);
  if (!correct) selected[0] = question.alternativas.findIndex(answer => !answer.correta);
  for (const input of await page.locator('[name="study-answer"][type="checkbox"]:checked').all()) await input.uncheck();
  for (const index of selected) await page.locator(`[name="study-answer"][value="${index}"]`).check();
}

async function assertPracticeScreen(page) {
  assert.equal(await page.locator('[data-study-jump]').count(), 60);
  assert.match(await page.locator('.quiz-heading .tag').textContent(), /Treino.*60/);
  assert.equal(await page.locator('time,[role="timer"],[data-timer],#timer,.timer').count(), 0, 'Practice has no clock');
}

async function assertOfflinePractice() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
  await context.route('https://**/*', route => route.abort());
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${url}?cert=cis-df&mode=offline`);
  await page.locator('#practice-start').waitFor();
  await page.locator('[data-offline-status]').filter({ hasText: 'estão prontos' }).waitFor();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(done => navigator.serviceWorker.addEventListener('controllerchange', done, { once: true }));
  });
  const snapshots = {};
  for (const course of courses) {
    await selectCourse(page, course);
    assert.equal(await page.locator('#practice-dashboard [data-practice-review]').count(), 0);
    await page.locator('#study-start').click();
    const full = ongoingFullStudy(await progress(page, course));
    assert.equal(full.total, course.count);
    await selectAnswer(page, maps[course.id][full.state.ids[0]]);
    await page.locator('#study-check').click();
    await page.locator('#study-next').click();
    await page.locator('#study-back').click();
    await page.locator('#start').click();
    assert.equal(await page.locator('[data-jump]').count(), course.examSize);
    await page.locator('#back').click();
    const before = await progress(page, course);
    await page.locator('#practice-start').click();
    await assertPracticeScreen(page);
    let practice = ongoingPractice(await progress(page, course));
    assert.equal(practice.state.mode, 'study');
    assert.equal(practice.state.certification, course.id);
    assert.equal(practice.total, 60);
    assert.equal(new Set(practice.state.ids).size, 60);
    for (const id of practice.state.ids) assert.deepEqual([...practice.state.orders[id]].sort((a, b) => a - b), maps[course.id][id].alternativas.map((_, index) => index));
    const first = maps[course.id][practice.state.ids[0]];
    await selectAnswer(page, first);
    assert.equal(await page.locator('.study-feedback').count(), 0, 'A draft does not reveal correction');
    assert.equal(Object.keys(ongoingPractice(await progress(page, course)).state.confirmed).length, 0);
    await page.locator('#study-check').click();
    assert.match(await page.locator('.study-feedback').textContent(), /Você acertou/);
    assert.equal(await page.locator('#study-check').count(), 0);
    assert.equal(await page.locator('[name="study-answer"]:enabled').count(), 0);
    practice = ongoingPractice(await progress(page, course));
    assert.equal(studyProgress(practice, maps[course.id]).correct, 1);
    const wrongIndex = practice.state.ids.findIndex((id, index) => index > 0 && !getMatchingQuestion(maps[course.id][id]) && maps[course.id][id].alternativas.some(option => !option.correta));
    assert.ok(wrongIndex > 0);
    await page.locator(`[data-study-jump="${wrongIndex}"]`).click();
    await selectAnswer(page, maps[course.id][practice.state.ids[wrongIndex]], false);
    await page.locator('#study-check').click();
    assert.match(await page.locator('.study-feedback').textContent(), /Você errou/);
    await page.locator('[data-study-jump="0"]').click();
    assert.equal(await page.locator('#study-check').count(), 0, 'A confirmed answer cannot be counted twice');
    practice = ongoingPractice(await progress(page, course));
    assert.deepEqual(studyProgress(practice, maps[course.id]), { answered: 2, correct: 1, wrong: 1, remaining: 58, accuracy: 50 });
    const draftIndex = practice.state.ids.findIndex((id, index) => index > wrongIndex && !practice.state.confirmed[id]);
    assert.ok(draftIndex >= 0);
    await page.locator(`[data-study-jump="${draftIndex}"]`).click();
    await selectAnswer(page, maps[course.id][practice.state.ids[draftIndex]]);
    await page.locator('#study-back').click();
    const paused = await progress(page, course);
    assert.deepEqual(paused.attempts, before.attempts, 'Practice leaves simulation progress unchanged');
    assert.deepEqual(ongoingFullStudy(paused), ongoingFullStudy(before), 'Practice leaves the full-bank study unchanged');
    assert.equal(paused.studies.length, 2);
    snapshots[course.id] = paused;
    await page.reload();
    await page.locator('#practice-start').waitFor();
    assert.deepEqual(await progress(page, course), paused);
    assert.match(await page.locator('#practice-start').textContent(), /Continuar/);
    assert.match(await page.locator('#study-start').textContent(), /Continuar/);
  }
  await context.setOffline(true);
  for (const course of courses) {
    await selectCourse(page, course);
    assert.equal(await page.evaluate(() => navigator.onLine), false);
    const paused = snapshots[course.id], expected = ongoingPractice(paused);
    assert.deepEqual(await progress(page, course), paused, 'Offline course switching preserves all three modes');
    await page.locator('#practice-start').click();
    await assertPracticeScreen(page);
    assert.match(await page.locator('.quiz-layout .eyebrow').first().textContent(), new RegExp(`Questão ${expected.state.cursor + 1} de 60`));
    assert.deepEqual(ongoingPractice(await progress(page, course)), expected);
    if (course.id === 'cis-csm') {
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'Mobile practice fits the viewport');
      await page.screenshot({ path: resolve(root, 'test-results/practice-csm-mobile.png'), fullPage: true });
      await page.setViewportSize({ width: 1280, height: 960 });
    }
    await page.locator('#study-finish').click();
    await page.locator('#study-confirm-finish').click();
    assert.match(await page.locator('.result-banner').textContent(), /60/);
    const finished = (await progress(page, course)).studies.find(record => record.id === expected.id);
    assert.ok(finished.finished_at);
    assert.equal(finished.score, 1);
    assert.equal(finished.total, 60);
    assert.equal(studyProgress(finished, maps[course.id]).answered, 2, 'An unconfirmed draft is not graded');
    await page.locator('#study-back').click();
    assert.equal(await page.locator('[data-practice-review]').count(), 1);
    assert.equal(await page.locator('[data-study-review]').count(), 0, 'A practice result is absent from full-study history');
    assert.equal(await page.locator('[data-review]').count(), 0);
    await page.locator('[data-practice-review]').click();
    assert.equal(await page.locator('#study-reviews .review-item').count(), 60);
    await page.locator('#study-back').click();
    await page.locator('#study-start').click();
    assert.equal(await page.locator('[data-study-jump]').count(), course.count);
    assert.deepEqual(ongoingFullStudy(await progress(page, course)), ongoingFullStudy(paused));
    await page.locator('#study-finish').click();
    await page.locator('#study-confirm-finish').click();
    await page.locator('#study-back').click();
    assert.equal(await page.locator('[data-study-review]').count(), 1);
    assert.equal(await page.locator('[data-practice-review]').count(), 1);
    await page.locator('#practice-start').click();
    const fresh = ongoingPractice(await progress(page, course));
    assert.equal(fresh.total, 60);
    assert.notEqual(fresh.id, expected.id);
    assert.equal(Object.keys(fresh.state.confirmed).length, 0);
    await page.locator('#study-back').click();
    const complete = await progress(page, course);
    assert.equal(complete.studies.filter(isPractice).length, 2);
    assert.equal(complete.studies.filter(record => !isPractice(record)).length, 1);
    assert.deepEqual(complete.attempts, paused.attempts);
  }
  await context.close();
}

async function assertAccountPractice() {
  const accountId = 'practice-account', fixtures = { attempts: [], study_sessions: [] }, pending = {}, guest = {};
  const ongoing = {};
  for (const [index, course] of courses.entries()) {
    const questions = banks[course.id];
    const quiz = createAttempt(questions, accountId, course.id);
    fixtures.attempts.push(quiz);
    const full = createStudy(questions, accountId, course.id), practice = createPractice(questions, accountId, course.id);
    const finishedFull = createStudy(questions, accountId, course.id), finishedPractice = createPractice(questions, accountId, course.id);
    finishedFull.finished_at = finishedPractice.finished_at = new Date().toISOString();
    finishedFull.score = finishedPractice.score = 0;
    fixtures.study_sessions.push(finishedFull, finishedPractice, full, practice);
    const fullPending = structuredClone(full), practicePending = structuredClone(practice);
    fullPending.state.cursor = index + 2;
    practicePending.state.cursor = index + 3;
    pending[`${course.id}-study-pending-${accountId}`] = fullPending;
    pending[`${course.id}-practice60-pending-${accountId}`] = practicePending;
    pending[`${course.id}-practice60-pending-another-account`] = { ...practicePending, user_id: 'another-account' };
    guest[localKey(course.id)] = { attempts: [], studies: [createPractice(questions, 'offline-guest', course.id)] };
    ongoing[course.id] = { full: fullPending, practice: practicePending };
  }
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 960 } });
  await context.addInitScript(({ fixtures, pending, guest }) => {
    if (localStorage.getItem('__practiceInitialized')) return;
    localStorage.setItem('__practiceInitialized', 'true');
    for (const [table, rows] of Object.entries(fixtures)) localStorage.setItem(`__practiceRows-${table}`, JSON.stringify(rows));
    for (const [key, value] of Object.entries({ ...pending, ...guest })) localStorage.setItem(key, JSON.stringify(value));
    localStorage.setItem('__practiceUpserts', '[]');
  }, { fixtures, pending, guest });
  await context.route('https://**/*', route => route.abort());
  await context.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm', route => route.fulfill({ contentType: 'text/javascript', body: `
    export function createClient() {
      const user={id:'${accountId}',email:'practice@example.com'};
      let callback,session=localStorage.getItem('__practiceSession')?{user}:null;
      return {auth:{
        onAuthStateChange(fn){callback=fn;setTimeout(()=>fn('INITIAL_SESSION',session),0);},
        async getSession(){return {data:{session},error:null};},
        async signInWithPassword(){session={user};localStorage.setItem('__practiceSession','true');callback('SIGNED_IN',session);return {data:{session},error:null};},
        async signOut(){session=null;localStorage.removeItem('__practiceSession');callback('SIGNED_OUT',null);return {error:null};}
      },from(table){return {
        select(){return {async order(){return {data:JSON.parse(localStorage.getItem('__practiceRows-'+table)||'[]'),error:null};}};},
        async upsert(data){
          if(data.state.variant==='practice60'&&localStorage.getItem('__practiceFail')==='true'){
            localStorage.setItem('__practiceFailedConfirmed',String(Object.keys(data.state.confirmed).length>0));
            return {error:{message:'Simulated practice write failure'}};
          }
          if(data.state.variant==='practice60'&&localStorage.getItem('__practiceHold')==='true')await new Promise(resolve=>{window.__practiceRelease=resolve;});
          const rows=JSON.parse(localStorage.getItem('__practiceRows-'+table)||'[]');
          const index=rows.findIndex(row=>row.id===data.id);
          if(index<0)rows.push(data);else rows[index]=data;
          localStorage.setItem('__practiceRows-'+table,JSON.stringify(rows));
          const writes=JSON.parse(localStorage.getItem('__practiceUpserts'));
          writes.push({table,data});localStorage.setItem('__practiceUpserts',JSON.stringify(writes));
          return {error:null};
        }
      };}};
    }` }));
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${url}?cert=cis-df`);
  await page.locator('[name=email]:not([disabled])').fill('practice@example.com');
  await page.locator('[name=password]').fill('password123');
  await page.locator('#auth-form button').click();
  await page.locator('#practice-start').waitFor();
  for (const [index, course] of courses.entries()) {
    await selectCourse(page, course);
    assert.equal(await page.locator('[data-study-review]').count(), 1);
    assert.equal(await page.locator('[data-practice-review]').count(), 1);
    assert.equal(await saved(page, `${course.id}-study-pending-${accountId}`), null);
    assert.equal(await saved(page, `${course.id}-practice60-pending-${accountId}`), null);
    assert.ok(await saved(page, `${course.id}-practice60-pending-another-account`));
    assert.deepEqual(await saved(page, localKey(course.id)), guest[localKey(course.id)], 'Account practice leaves offline-guest progress unchanged');
    for (const other of courses.slice(index + 1)) {
      assert.ok(await saved(page, `${other.id}-study-pending-${accountId}`));
      assert.ok(await saved(page, `${other.id}-practice60-pending-${accountId}`));
    }
    await page.locator('#practice-start').click();
    await assertPracticeScreen(page);
    assert.match(await page.locator('.quiz-layout .eyebrow').first().textContent(), new RegExp(`Questão ${index + 4} de 60`));
    await page.locator('#study-back').click();
    await page.locator('#study-start').click();
    assert.equal(await page.locator('[data-study-jump]').count(), course.count);
    assert.match(await page.locator('.quiz-layout .eyebrow').first().textContent(), new RegExp(`Questão ${index + 3} de ${course.count}`));
    await page.locator('#study-back').click();
    assert.equal(await saved(page, `${course.id}-practice60-pending-${accountId}`), null);
    assert.equal(await saved(page, `${course.id}-study-pending-${accountId}`), null);
    assert.deepEqual(await saved(page, `${course.id}-practice60-pending-another-account`), pending[`${course.id}-practice60-pending-another-account`]);
    for (const other of courses.slice(index + 1)) {
      assert.deepEqual(await saved(page, `${other.id}-practice60-pending-${accountId}`), pending[`${other.id}-practice60-pending-${accountId}`]);
      assert.deepEqual(await saved(page, `${other.id}-study-pending-${accountId}`), pending[`${other.id}-study-pending-${accountId}`]);
    }
    const writes = await saved(page, '__practiceUpserts');
    const visited = new Set(courses.slice(0, index + 1).map(item => item.id));
    for (const write of writes) {
      assert.equal(write.data.user_id, accountId);
      assert.ok(visited.has(write.data.state.certification));
      if (write.data.state.mode === 'study') assert.equal(write.table, 'study_sessions');
    }
  }
  const course = courses.at(-1), pendingKey = `${course.id}-practice60-pending-${accountId}`;
  await page.evaluate(() => localStorage.setItem('__practiceFail', 'true'));
  await page.locator('#practice-start').click();
  const record = ongoing[course.id].practice;
  const question = maps[course.id][record.state.ids[record.state.cursor]];
  await selectAnswer(page, question);
  await page.locator('#study-check').click();
  await page.waitForFunction(key => {
    const pending = JSON.parse(localStorage.getItem(key));
    return pending && Object.keys(pending.state.confirmed).length === 1 && localStorage.getItem('__practiceFailedConfirmed') === 'true';
  }, pendingKey);
  assert.equal(await saved(page, `${course.id}-study-pending-${accountId}`), null, 'Failed practice writes do not replace full-study pending data');
  assert.deepEqual(await saved(page, localKey(course.id)), guest[localKey(course.id)]);
  await page.evaluate(() => localStorage.removeItem('__practiceFail'));
  await page.reload();
  await page.locator('#practice-start').waitFor();
  assert.equal(await saved(page, pendingKey), null, 'Reload retries the saved practice write');
  await page.locator('#practice-start').click();
  assert.match(await page.locator('.study-feedback').textContent(), /Você acertou/);
  assert.equal(await page.locator('#study-check').count(), 0);
  const rows = await saved(page, '__practiceRows-study_sessions');
  const resumed = rows.find(row => row.id === record.id);
  assert.equal(Object.keys(resumed.state.confirmed).length, 1);
  assert.equal(studyProgress(resumed, maps[course.id]).correct, 1);
  assert.equal(rows.find(row => row.id === ongoing[course.id].full.id).state.cursor, 5);
  for (const [key, value] of Object.entries(guest)) assert.deepEqual(await saved(page, key), value);
  // Starting a new practice saves asynchronously. Opening another view during
  // that write must not be undone when the delayed request completes.
  for (const destination of ['memory', 'history']) {
    if (!await page.locator('[data-study-jump]').count()) await page.locator('#practice-start').click();
    await page.locator('#study-finish').click();
    await page.locator('#study-confirm-finish').click();
    await page.locator('#study-back').click();
    await page.evaluate(() => { localStorage.setItem('__practiceHold', 'true'); delete window.__practiceRelease; });
    await page.locator('#practice-start').click();
    await page.waitForFunction(() => typeof window.__practiceRelease === 'function');
    const starting = await saved(page, pendingKey);
    assert.equal(starting.state.variant, 'practice60');
    if (destination === 'memory') {
      await page.locator('#memory-start').click();
      await page.locator('[data-memory-reveal]').waitFor();
    } else {
      await page.locator('[data-study-review]').click();
      assert.equal(await page.locator('#study-reviews .review-item').count(), course.count);
    }
    await page.evaluate(() => { localStorage.removeItem('__practiceHold'); window.__practiceRelease(); });
    await page.waitForFunction(key => localStorage.getItem(key) === null, pendingKey);
    assert.equal(await page.locator('[data-study-jump]').count(), 0, `Delayed practice start must preserve the ${destination} view`);
    if (destination === 'memory') {
      assert.equal(await page.locator('[data-memory-reveal]').isVisible(), true);
      await page.locator('[data-memory-back]').click();
    } else {
      assert.equal(await page.locator('#study-reviews .review-item').count(), course.count);
      await page.locator('#study-back').click();
    }
    assert.match(await page.locator('#practice-start').textContent(), /Continuar/);
    const stored = await saved(page, '__practiceRows-study_sessions');
    const active = stored.filter(row => row.state.certification === course.id && isPractice(row) && !row.finished_at);
    assert.equal(active.length, 1);
    assert.equal(active[0].id, starting.id);
  }
  await context.close();
}

try {
  await mkdir(resolve(root, 'test-results'), { recursive: true });
  browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const scope = process.env.PRACTICE_BROWSER_SCOPE || 'all';
  assert.ok(['all', 'offline', 'account'].includes(scope));
  if (scope !== 'account') await assertOfflinePractice();
  if (scope !== 'offline') await assertAccountPractice();
  assert.deepEqual(errors, []);
  console.log(`PASS: practice browser checks (${scope}) for CIS-DF/CIS-EM/CAD/CIS-CSM`);
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
