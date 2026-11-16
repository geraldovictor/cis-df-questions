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

test('practice selects exactly sixty unique source questions and preserves every option for each real certification bank', async () => {
  for (const { id } of certifications) {
    const questions = await loadQuestionBank(id, fetchFile);
    const original = JSON.stringify(questions), byId = Object.fromEntries(questions.map(question => [question.id, question]));
    for (let run = 0; run < 20; run++) {
      const practice = createPractice(questions, 'student');
      assert.equal(practice.total, 60, id);
      assert.equal(practice.state.ids.length, 60, id);
      assert.equal(new Set(practice.state.ids).size, 60, id);
      assert.equal(practice.state.mode, 'study');
      assert.equal(practice.state.variant, 'practice60');
      assert.equal(practice.state.certification, id);
      for (const questionId of practice.state.ids) {
        assert.ok(byId[questionId], `${id}: every selected ID belongs to its source bank`);
        assert.deepEqual([...practice.state.orders[questionId]].sort((a, b) => a - b), byId[questionId].alternativas.map((_, index) => index));
      }
    }
    assert.equal(JSON.stringify(questions), original, `${id}: creating practice does not mutate its source`);
  }
});

test('the practice sample remains sixty for different bank sizes and all certification exam formats', () => {
  for (const certification of ['cis-df', 'cis-em', 'cis-cad', 'cis-csm']) {
    for (const length of [60, 61, 205]) {
      const practice = createPractice(bank(length, certification), 'student');
      assert.equal(practice.total, 60);
      assert.equal(practice.state.ids.length, 60);
      assert.equal(practice.state.certification, certification);
      assert.ok(isPracticeStudy(practice));
    }
  }
  const legacy = bank(60).map(({ certification, ...question }) => question);
  assert.equal(createPractice(legacy, 'student').state.certification, 'cis-df');
  assert.equal(createPractice(legacy, 'student', 'cis-em').state.certification, 'cis-em');
});

test('practice refuses incomplete or duplicate-ID banks instead of starting a shorter or repeated sample', () => {
  for (const length of [0, 1, 59]) assert.throws(() => createPractice(bank(length), 'student'), /60/);
  const duplicate = bank(61); duplicate[60] = { ...duplicate[0] };
  assert.throws(() => createPractice(duplicate, 'student'), /repetidos/);
});

test('practice requires the exact multi-answer set, gives immediate grading once and locks confirmed responses', () => {
  const questions = bank(90, 'cis-em'), byId = Object.fromEntries(questions.map(question => [question.id, question]));
  const practice = createPractice(questions, 'student');
  const first = byId[practice.state.ids[0]], second = byId[practice.state.ids[1]];
  practice.state.answers[first.id] = [0, 2];
  assert.equal(studyProgress(practice, byId).answered, 0, 'An unconfirmed draft is not graded');
  for (const invalid of [[0], [0, 0], [0, 1, 2], [0, 99]]) assert.throws(() => confirmStudyAnswer(practice, first, invalid));
  assert.equal(confirmStudyAnswer(practice, first, [2, 0]), true);
  assert.deepEqual(studyProgress(practice, byId), { answered: 1, correct: 1, wrong: 0, remaining: 59, accuracy: 100 });
  assert.equal(confirmStudyAnswer(practice, first, [0, 1]), false);
  assert.deepEqual(practice.state.answers[first.id], [2, 0]);
  assert.equal(confirmStudyAnswer(practice, second, [0, 1]), true);
  assert.deepEqual(studyProgress(practice, byId), { answered: 2, correct: 1, wrong: 1, remaining: 58, accuracy: 50 });
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

test('full-bank and legacy studies retain their behavior and are never identified as sixty-question practice', () => {
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
