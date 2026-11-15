import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { certifications, getCertification, certificationStorageKey, getRecordCertification, loadQuestionBank } from '../certification.js';
import { createAttempt, scoreAttempt } from '../quiz.js';
import { createStudy, confirmStudyAnswer, studyProgress } from '../study.js';
import { validateMemoryAids } from '../memorization.js';
import { renderQuestionContext } from '../question-content.js';

const root = new URL('../', import.meta.url);
const fetchFile = async url => ({ ok: true, json: async () => JSON.parse(await readFile(url, 'utf8')) });

test('every certification loads its complete bank, valid memory aids and independent results', async () => {
  for (const [id, size, examSize] of [['cis-df', 205, 75], ['cis-em', 118, 30], ['cis-cad', 151, 60]]) {
    const questions = await loadQuestionBank(id, fetchFile);
    assert.equal(questions.length, size);
    assert.equal(new Set(questions.map(question => question.id)).size, size);
    assert.ok(questions.every(question => question.certification === id));
    const aids = JSON.parse(await readFile(new URL(getCertification(id).memoryAids, root), 'utf8'));
    validateMemoryAids(aids, questions);
    const byId = Object.fromEntries(questions.map(question => [question.id, question]));
    const quiz = createAttempt(questions, 'user');
    assert.equal(getCertification(id).examSize, examSize);
    assert.equal(quiz.total, examSize);
    assert.equal(quiz.state.ids.length, examSize);
    assert.equal(new Set(quiz.state.ids).size, examSize);
    assert.equal(quiz.state.certification, id);
    for (const questionId of quiz.state.ids) quiz.state.answers[questionId] = byId[questionId].alternativas.flatMap((answer, i) => answer.correta ? [i] : []);
    assert.equal(scoreAttempt(quiz, byId), examSize);
    const study = createStudy(questions, 'user');
    assert.equal(study.total, size);
    const first = byId[study.state.ids[0]];
    confirmStudyAnswer(study, first, first.alternativas.flatMap((answer, i) => answer.correta ? [i] : []));
    assert.equal(studyProgress(study, byId).correct, 1);
    if (id === 'cis-df') assert.ok(byId['2-50']);
  }
});

test('legacy results belong only to CIS-DF and storage keys retain user and mode boundaries', () => {
  const records = [{ state: {} }, { state: { certification: 'cis-em' } }, { state: { certification: 'cis-cad' } }];
  assert.deepEqual(records.map(getRecordCertification), ['cis-df', 'cis-em', 'cis-cad']);
  const keys = certifications.flatMap(({ id }) => ['one', 'two'].flatMap(user => ['pending', 'study-pending', 'flashcards', 'memory-v1'].map(feature => certificationStorageKey(feature, id, user))));
  assert.equal(new Set(keys).size, 24);
  assert.equal(certificationStorageKey('pending', 'cis-df', 'one'), 'cis-df-pending-one');
  assert.throws(() => getCertification('other'));
  assert.throws(() => certificationStorageKey('pending', 'other', 'one'));
});

test('bank loading reports missing files, duplicate IDs and malformed answer keys', async () => {
  await assert.rejects(loadQuestionBank('cis-em', async () => ({ ok: false })), /carregar/);
  for (const invalid of [null, [], [{ id: 'bad', pergunta: 'Prompt', alternativas: [{ texto: 'Wrong', correta: false }] }]]) {
    await assert.rejects(loadQuestionBank('cis-em', async () => ({ ok: true, json: async () => invalid })));
  }
  const q = { id: 'duplicate', pergunta: 'Prompt', alternativas: [{ texto: 'Yes', correta: true }, { texto: 'No', correta: false }] };
  await assert.rejects(loadQuestionBank('cis-em', async () => ({ ok: true, json: async () => [q, q] })), /inválida/);
});

test('offline shell includes all course banks, hints, modules and question images', async () => {
  const scope = { self: { registration: { scope: 'http://localhost/' }, addEventListener() {} }, URL };
  runInNewContext((await readFile(new URL('sw.js', root), 'utf8')) + '\nglobalThis.assets = ASSETS;', scope);
  for (const asset of scope.assets) {
    await readFile(new URL(asset === './' ? 'index.html' : asset, root));
  }
  assert.ok(scope.assets.includes('./certification.js'));
  for (const certification of certifications) {
    for (const file of [...certification.files, certification.memoryAids]) assert.ok(scope.assets.includes('./' + file), file);
    const questions = await loadQuestionBank(certification.id, fetchFile);
    for (const question of questions) for (const image of question.contexto?.imagens || []) {
      assert.ok(scope.assets.includes('./' + image.src), image.src);
      assert.ok(renderQuestionContext(question).includes(image.src));
    }
  }
});

test('source caveats remain visible even for questions without other context and are escaped', () => {
  const html = renderQuestionContext({ observacao: 'Missing <choice>' });
  assert.ok(html.includes('Missing &lt;choice&gt;'));
  assert.ok(html.includes('Observação do material enviado'));
});
