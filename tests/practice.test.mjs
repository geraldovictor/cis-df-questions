import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { certifications, loadQuestionBank } from '../certification.js';
import { createStudy, createPractice, isPracticeStudy, confirmStudyAnswer, studyProgress } from '../study.js';

const bank = (length, certification = 'cis-df') => Array.from({ length }, (_, index) => ({
  id: `${certification}-${index}`, certification, pergunta: `Question ${index}`,
  alternativas: [{ texto: 'First correct', correta: true }, { texto: 'Incorrect', correta: false }, { texto: 'Second correct', correta: true }]
}));
const fetchFile = async url => ({ ok: true, json: async () => JSON.parse(await readFile(url, 'utf8')) });

test('practice selects the configured number of unique source questions and preserves every option for each real certification bank', async () => {
  for (const { id, examSize } of certifications) {
    const questions = await loadQuestionBank(id, fetchFile);
    const original = JSON.stringify(questions), byId = Object.fromEntries(questions.map(question => [question.id, question]));
    for (let run = 0; run < 20; run++) {
      const practice = createPractice(questions, 'student');
      assert.equal(practice.total, examSize, id);
      assert.equal(practice.state.ids.length, examSize, id);
      assert.equal(new Set(practice.state.ids).size, examSize, id);
      assert.equal(practice.state.mode, 'study');
      assert.equal(practice.state.variant, 'practice');
      assert.equal(practice.state.certification, id);
      for (const questionId of practice.state.ids) {
        assert.ok(byId[questionId], `${id}: every selected ID belongs to its source bank`);
        assert.deepEqual([...practice.state.orders[questionId]].sort((a, b) => a - b), byId[questionId].alternativas.map((_, index) => index));
      }
    }
    assert.equal(JSON.stringify(questions), original, `${id}: creating practice does not mutate its source`);
  }
});

test('practice uses DF75, EM30, CAD60 and CSM60 across different bank sizes', () => {
  assert.deepEqual(certifications.map(({ id, examSize }) => [id, examSize]), [['cis-df', 75], ['cis-em', 30], ['cis-cad', 60], ['cis-csm', 60]]);
  for (const { id, examSize } of certifications) {
    for (const length of [examSize, examSize + 1, 205]) {
      const practice = createPractice(bank(length, id), 'student');
      assert.equal(practice.total, examSize);
      assert.equal(practice.state.ids.length, examSize);
      assert.equal(practice.state.certification, id);
      assert.ok(isPracticeStudy(practice));
    }
  }
  const legacy = bank(75).map(({ certification, ...question }) => question);
  assert.equal(createPractice(legacy, 'student').state.certification, 'cis-df');
  assert.equal(createPractice(legacy, 'student', 'cis-em').state.certification, 'cis-em');
});

test('practice refuses incomplete or duplicate-ID banks instead of starting a shorter or repeated sample', () => {
  for (const { id, examSize } of certifications) {
    for (const length of [0, 1, examSize - 1]) assert.throws(() => createPractice(bank(length, id), 'student', id), new RegExp(String(examSize)));
    const duplicate = bank(examSize + 1, id); duplicate[examSize] = { ...duplicate[0] };
    assert.throws(() => createPractice(duplicate, 'student'), /repetidos/);
  }
});

test('practice requires the exact multi-answer set, gives immediate grading once and locks confirmed responses', () => {
  const questions = bank(90, 'cis-em'), byId = Object.fromEntries(questions.map(question => [question.id, question]));
  const practice = createPractice(questions, 'student');
  const first = byId[practice.state.ids[0]], second = byId[practice.state.ids[1]];
  practice.state.answers[first.id] = [0, 2];
  assert.equal(studyProgress(practice, byId).answered, 0, 'An unconfirmed draft is not graded');
  for (const invalid of [[0], [0, 0], [0, 1, 2], [0, 99]]) assert.throws(() => confirmStudyAnswer(practice, first, invalid));
  assert.equal(confirmStudyAnswer(practice, first, [2, 0]), true);
  assert.deepEqual(studyProgress(practice, byId), { answered: 1, correct: 1, wrong: 0, remaining: 29, accuracy: 100 });
  assert.equal(confirmStudyAnswer(practice, first, [0, 1]), false);
  assert.deepEqual(practice.state.answers[first.id], [2, 0]);
  assert.equal(confirmStudyAnswer(practice, second, [0, 1]), true);
  assert.deepEqual(studyProgress(practice, byId), { answered: 2, correct: 1, wrong: 1, remaining: 28, accuracy: 50 });
});

test('serialized practice resumes its chosen sample, answer order, confirmations and drafts without a timer', () => {
  const questions = bank(120, 'cis-cad'), byId = Object.fromEntries(questions.map(question => [question.id, question]));
  const practice = createPractice(questions, 'student');
  confirmStudyAnswer(practice, byId[practice.state.ids[0]], [0, 2]);
  practice.state.cursor = 7;
  practice.state.answers[practice.state.ids[7]] = [0];
  const resumed = JSON.parse(JSON.stringify(practice));
  assert.deepEqual(resumed, practice);
  assert.ok(isPracticeStudy(resumed));
  assert.equal(studyProgress(resumed, byId).correct, 1);
  assert.equal(studyProgress(resumed, byId).remaining, 59);
  assert.equal(Object.keys(resumed.state).some(key => /timer|deadline|duration|remainingTime/i.test(key)), false);
  resumed.finished_at = new Date().toISOString(); resumed.score = 1;
  assert.equal(confirmStudyAnswer(resumed, byId[resumed.state.ids[7]], [0, 2]), false);
});

test('full-bank and untagged legacy studies remain distinct from both practice variants', () => {
  for (const length of [1, 60, 118, 205]) {
    const questions = bank(length), study = createStudy(questions, 'student');
    assert.equal(study.total, length);
    assert.equal(study.state.variant, undefined);
    assert.equal(isPracticeStudy(study), false);
    assert.deepEqual([...study.state.ids].sort(), questions.map(question => question.id).sort());
  }
  for (const record of [undefined, null, {}, { state: {} }, { state: { variant: 'other' } }, { total: 60, state: { mode: 'study' } }]) {
    assert.equal(isPracticeStudy(record), false);
  }
});

test('legacy practice60 sessions keep their original total, sample and grading while new EM practice uses thirty', () => {
  const questions = bank(90, 'cis-em'), byId = Object.fromEntries(questions.map(question => [question.id, question]));
  const legacy = createStudy(questions.slice(0, 60), 'student', 'cis-em');
  legacy.state.variant = 'practice60';
  confirmStudyAnswer(legacy, byId[legacy.state.ids[0]], [0, 2]);
  legacy.state.cursor = 7;
  const resumed = JSON.parse(JSON.stringify(legacy));
  assert.ok(isPracticeStudy(resumed));
  assert.equal(resumed.total, 60);
  assert.equal(resumed.state.ids.length, 60);
  assert.deepEqual(resumed, legacy);
  assert.equal(studyProgress(resumed, byId).remaining, 59);
  assert.equal(confirmStudyAnswer(resumed, byId[resumed.state.ids[0]], [0, 1]), false);
  assert.equal(createPractice(questions, 'student').total, 30);
});
