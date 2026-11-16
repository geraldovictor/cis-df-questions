import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttempt, scoreAttempt } from '../quiz.js';
import { createStudy, confirmStudyAnswer, studyProgress } from '../study.js';
import { GUEST_ID, LOCAL_PROGRESS_KEY, readLocalProgress, saveLocalAttempt } from '../offline.js';
import { questionAudioPath } from '../question-content.js';

const bank = certification => Array.from({ length: 75 }, (_, index) => ({
  id: `1-${index + 1}`, ...(certification ? { certification } : {}), pergunta: `Question ${index + 1}`,
  alternativas: [{ texto: 'Correct', correta: true }, { texto: 'Incorrect', correta: false }]
}));
const memoryStorage = () => {
  const items = new Map();
  return { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) };
};
const examSizes = [['cis-df', 75], ['cis-em', 30], ['cis-cad', 60], ['cis-csm', 60]];

test('new quiz and study records retain certification through serialization without changing scoring', () => {
  for (const [certification, examSize] of examSizes) {
    const questions = bank(certification), byId = Object.fromEntries(questions.map(q => [q.id, q]));
    const quiz = createAttempt(questions, GUEST_ID), study = createStudy(questions, GUEST_ID);
    assert.equal(quiz.state.certification, certification);
    assert.equal(study.state.certification, certification);
    for (const id of quiz.state.ids) quiz.state.answers[id] = [0];
    assert.equal(quiz.total, examSize);
    assert.equal(scoreAttempt(JSON.parse(JSON.stringify(quiz)), byId), examSize);
    confirmStudyAnswer(study, byId[study.state.ids[0]], [0]);
    assert.equal(studyProgress(JSON.parse(JSON.stringify(study)), byId).correct, 1);
  }
  assert.equal(createAttempt(bank(), GUEST_ID).state.certification, 'cis-df');
  assert.equal(createStudy(bank(), GUEST_ID).state.certification, 'cis-df');
  assert.equal(createAttempt(bank(), GUEST_ID, 'cis-em').state.certification, 'cis-em');
  assert.equal(createStudy(bank(), GUEST_ID, 'cis-cad').state.certification, 'cis-cad');
});

test('CIS-EM selects exactly 30 and CAD exactly 60 unique questions while preserving shuffled answer indices', () => {
  for (const [certification, examSize] of examSizes.slice(1)) {
    const questions = bank(certification).map((q, index) => ({ ...q, alternativas: [
      { texto: `First correct ${index}`, correta: true },
      { texto: `Incorrect ${index}`, correta: false },
      { texto: `Second correct ${index}`, correta: true },
      { texto: `Other incorrect ${index}`, correta: false }
    ] }));
    const original = JSON.stringify(questions);
    const byId = Object.fromEntries(questions.map(q => [q.id, q]));
    for (let run = 0; run < 50; run++) {
      const quiz = createAttempt(questions, GUEST_ID);
      assert.equal(quiz.total, examSize);
      assert.equal(quiz.state.ids.length, examSize);
      assert.equal(new Set(quiz.state.ids).size, examSize);
      assert.equal(scoreAttempt(quiz, byId), 0);
      for (const id of quiz.state.ids) {
        assert.ok(byId[id]);
        assert.deepEqual([...quiz.state.orders[id]].sort(), [0, 1, 2, 3]);
        quiz.state.answers[id] = quiz.state.orders[id].filter(index => byId[id].alternativas[index].correta);
      }
      assert.equal(scoreAttempt(quiz, byId), examSize);
    }
    assert.equal(JSON.stringify(questions), original);
    assert.equal(createAttempt(questions.slice(0, examSize), GUEST_ID).total, examSize);
    assert.throws(() => createAttempt(questions.slice(0, examSize - 1), GUEST_ID));
  }
});

test('30- and 60-question attempts preserve partial answers, cursor and final score when paused and resumed', () => {
  for (const [certification, examSize] of examSizes.slice(1)) {
    const storage = memoryStorage();
    const questions = bank(certification), byId = Object.fromEntries(questions.map(q => [q.id, q]));
    const quiz = createAttempt(questions, GUEST_ID);
    for (const id of quiz.state.ids.slice(0, 4)) quiz.state.answers[id] = [0];
    quiz.state.answers[quiz.state.ids[4]] = [1];
    quiz.state.cursor = 5;
    saveLocalAttempt(quiz, storage);
    const resumed = readLocalProgress(storage, certification).attempts[0];
    assert.deepEqual(resumed, quiz);
    assert.equal(resumed.total, examSize);
    assert.equal(resumed.state.ids.length, examSize);
    assert.equal(resumed.state.cursor, 5);
    assert.equal(resumed.finished_at, null);
    assert.equal(resumed.score, null);
    assert.equal(scoreAttempt(resumed, byId), 4);
    for (const id of resumed.state.ids) resumed.state.answers[id] = [0];
    resumed.state.cursor = examSize - 1;
    resumed.score = scoreAttempt(resumed, byId);
    resumed.finished_at = new Date().toISOString();
    saveLocalAttempt(resumed, storage);
    const finished = readLocalProgress(storage, certification).attempts[0];
    assert.equal(finished.score, examSize);
    assert.equal(finished.state.cursor, examSize - 1);
    assert.equal(finished.finished_at, resumed.finished_at);
    assert.deepEqual(finished.state.orders, quiz.state.orders);
    assert.equal(readLocalProgress(storage, certification).attempts.length, 1);
  }
});

test('offline banks with identical question and record IDs save and resume independently', () => {
  const storage = memoryStorage();
  for (const [index, certification] of examSizes.map(([certification]) => certification).entries()) {
    const questions = bank(certification);
    const quiz = createAttempt(questions, GUEST_ID), study = createStudy(questions, GUEST_ID);
    quiz.id = 'same-quiz-id'; study.id = 'same-study-id';
    quiz.state.cursor = index; study.state.cursor = index + 1;
    quiz.state.answers['1-1'] = [index % 2];
    saveLocalAttempt(quiz, storage); saveLocalAttempt(study, storage);
  }
  for (const [index, certification] of examSizes.map(([certification]) => certification).entries()) {
    const restored = readLocalProgress(storage, certification);
    assert.equal(restored.attempts.length, 1); assert.equal(restored.studies.length, 1);
    assert.equal(restored.attempts[0].state.certification, certification);
    assert.equal(restored.attempts[0].state.cursor, index);
    assert.equal(restored.studies[0].state.cursor, index + 1);
    assert.deepEqual(restored.attempts[0].state.answers['1-1'], [index % 2]);
  }
  const changed = readLocalProgress(storage, 'cis-em').attempts[0];
  changed.state.cursor = 10; saveLocalAttempt(changed, storage);
  assert.equal(readLocalProgress(storage, 'cis-em').attempts[0].state.cursor, 10);
  assert.equal(readLocalProgress(storage).attempts[0].state.cursor, 0);
  assert.equal(readLocalProgress(storage, 'cis-cad').attempts[0].state.cursor, 2);
});

test('legacy untagged CIS-DF results and original storage key stay usable', () => {
  const storage = memoryStorage(), legacy = createAttempt(bank(), GUEST_ID);
  delete legacy.state.certification;
  storage.setItem(LOCAL_PROGRESS_KEY, JSON.stringify({ attempts: [legacy], studies: [] }));
  assert.equal(LOCAL_PROGRESS_KEY, 'cis-df-offline-progress-v1');
  assert.deepEqual(readLocalProgress(storage).attempts[0], legacy);
  legacy.state.cursor = 7; saveLocalAttempt(legacy, storage);
  assert.equal(readLocalProgress(storage).attempts[0].state.cursor, 7);
  assert.deepEqual(readLocalProgress(storage, 'cis-em'), { attempts: [], studies: [] });
  assert.deepEqual(readLocalProgress(storage, 'cis-cad'), { attempts: [], studies: [] });
});

test('unreadable progress in one certification does not block saving another', () => {
  const storage = memoryStorage();
  storage.setItem('cis-em-offline-progress-v1', 'broken');
  assert.throws(() => readLocalProgress(storage, 'cis-em'));
  saveLocalAttempt(createStudy(bank('cis-cad'), GUEST_ID), storage);
  assert.equal(readLocalProgress(storage, 'cis-cad').studies.length, 1);
  assert.equal(storage.getItem('cis-em-offline-progress-v1'), 'broken');
});

test('audio URLs separate certifications while retaining legacy paths and revisions', () => {
  assert.equal(questionAudioPath({ id: '2-50' }), 'audio/2-50.mp3');
  assert.equal(questionAudioPath({ id: '2-50', certification: 'cis-df', audio_version: 2 }), 'audio/2-50.mp3?v=2');
  assert.equal(questionAudioPath({ id: '2-50', certification: 'cis-em' }), 'audio/cis-em/2-50.mp3');
  assert.equal(questionAudioPath({ id: '2-50', certification: 'cis-cad', audio_version: 'new voice' }), 'audio/cis-cad/2-50.mp3?v=new%20voice');
  assert.equal(questionAudioPath({ id: 'question/name', certification: 'cis-em' }), 'audio/cis-em/question%2Fname.mp3');
});
