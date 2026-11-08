import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getMatchingQuestion, getMatchingAssignments, isMatchingComplete } from '../matching.js';
import { isCorrect, scoreAttempt, createAttempt } from '../quiz.js';
import { createStudy, confirmStudyAnswer, studyProgress } from '../study.js';

const files = ['questoes-1-corrigida (1).json', 'questoes-2-corrigida-v2 (1).json', 'questoes-3-corrigida-v2 (1).json'];
const questions = (await Promise.all(files.map(async (file, fileIndex) =>
  JSON.parse(await readFile(new URL('../' + file, import.meta.url), 'utf8'))
    .map((question, i) => ({...question, id: `${fileIndex + 1}-${i + 1}`}))))).flat();
const matchingQuestions = questions.filter(getMatchingQuestion);
const tokens = (question, assignments = getMatchingQuestion(question).solution) =>
  Object.entries(assignments).map(([target, item]) => `match:${target}:${item}`);

test('all fourteen association questions parse their complete source lists and original answer keys', () => {
  assert.deepEqual(matchingQuestions.map(question => question.id), ['1-6', '1-21', '1-22', '1-35', '1-37', '1-68', '2-19', '2-24', '2-25', '2-72', '3-5', '3-7', '3-8', '3-34']);
  for (const question of matchingQuestions) {
    const matching = getMatchingQuestion(question);
    assert.ok(matching.prompt);
    assert.equal(matching.prompt.includes('A.'), false);
    assert.ok(matching.items.every(item => item.text && !item.text.includes('->')));
    assert.ok(matching.targets.every(target => target.text));
    assert.equal(Object.keys(matching.solution).length, matching.targets.length);
    assert.ok(isMatchingComplete(question, tokens(question)));
    assert.ok(isCorrect(question, tokens(question).reverse()));
    assert.deepEqual(getMatchingAssignments(question, tokens(question)), matching.solution);
  }
  assert.equal(getMatchingQuestion(questions[34]).items.length, 5);
  assert.equal(getMatchingQuestion(questions[34]).targets.length, 4);
  assert.equal(getMatchingQuestion(questions[67]).items.length, 6);
  assert.equal(getMatchingQuestion(questions[67]).targets.length, 3);
  assert.equal(getMatchingQuestion(questions[67]).items.find(item => item.id === 'B').text, 'Stability');
  assert.equal(getMatchingQuestion(questions[20]).targets[1].text.includes('all relationships to underlying technology CIs'), true);
  assert.equal(getMatchingQuestion(questions.find(question => question.id === '2-25')).prompt, 'Match each item to its description.');
});

test('CMDB team question exposes four draggable roles and retains its source answer key', () => {
  const question = questions.find(question => question.id === '3-34');
  const matching = getMatchingQuestion(question);
  assert.equal(matching.prompt, 'A new ServiceNow customer is assembling a Configuration Management team to support their CMDB.');
  assert.deepEqual(matching.items.map(item => item.text), ['CI Analyst', 'CMDB Process Owner', 'Configuration Manager/CMDB Admin', 'Service of Product Owner']);
  assert.equal(matching.targets.length, 4);
  assert.deepEqual(matching.solution, {1: 'A', 2: 'D', 3: 'C', 4: 'B'});
  assert.ok(isCorrect(question, ['match:1:A', 'match:2:D', 'match:3:C', 'match:4:B']));
  assert.equal(isCorrect(question, ['match:1:A', 'match:2:B', 'match:3:C', 'match:4:D']), false);
  assert.deepEqual(getMatchingAssignments(question, [1]), matching.solution);
});

test('all supported arrow and target-list separators parse the same associations', () => {
  const source = questions.find(question => question.id === '3-34');
  for (const arrow of ['->', '→', '=>', '⇒']) {
    for (const separator of ['. ', ' - ']) {
      const question = {
        ...source,
        pergunta: source.pergunta.replace(/(\d)\.\s*/g, `$1${separator}`),
        alternativas: source.alternativas.map(option => ({...option, texto: option.texto.replaceAll('=>', arrow)}))
      };
      assert.deepEqual(getMatchingQuestion(question)?.solution, {1: 'A', 2: 'D', 3: 'C', 4: 'B'}, `${arrow} / ${separator}`);
      assert.ok(isCorrect(question, tokens(question)));
      assert.ok(isMatchingComplete(question, [1]));
    }
  }
  const importTools = getMatchingQuestion(questions.find(question => question.id === '3-7'));
  assert.equal(importTools.items.length, 5);
  assert.equal(importTools.items.find(item => item.id === 'E').text, 'Pre-built store integration solutions that require minimal customization');
  assert.deepEqual(importTools.targets.map(target => target.text), ['Agent Client Collector', 'Import Sets', 'Service Graph Connector', 'ServiceNow Discovery']);
  assert.deepEqual(importTools.solution, {1: 'B', 2: 'A', 3: 'D', 4: 'E'});
});

test('complete wrong assignments score zero; partial, duplicate, and invalid answers cannot be confirmed', () => {
  const question = matchingQuestions[0], correct = tokens(question);
  const wrong = ['match:1:B', 'match:2:A', 'match:3:C', 'match:4:D'];
  assert.ok(isMatchingComplete(question, wrong));
  assert.equal(isCorrect(question, wrong), false);
  const invalid = [[], correct.slice(0, 3), ['match:1:A', 'match:2:A', 'match:3:C', 'match:4:D'],
    ['match:1:A', 'match:1:B', 'match:3:C', 'match:4:D'], [...correct, correct[0]],
    ['match:1:Z', ...correct.slice(1)], ['match:9:A', ...correct.slice(1)],
    ['match:1:A:extra', ...correct.slice(1)], [0, ...correct.slice(1)], [99]];
  for (const selected of invalid) {
    assert.equal(isMatchingComplete(question, selected), false, JSON.stringify(selected));
    assert.equal(isCorrect(question, selected), false, JSON.stringify(selected));
    assert.throws(() => confirmStudyAnswer(createStudy([question], 'test'), question, selected), /associações/);
  }
});

test('legacy numeric answers keep their original grade and restore their visible assignments', () => {
  const duplicateTargetOptions = new Set(['3-5:0', '3-8:3']);
  for (const question of matchingQuestions) {
    question.alternativas.forEach((option, index) => {
      assert.equal(isCorrect(question, [index]), option.correta);
      assert.ok(Object.keys(getMatchingAssignments(question, [index])).length > 0);
      assert.equal(isMatchingComplete(question, [index]), !duplicateTargetOptions.has(`${question.id}:${index}`));
    });
    const index = question.alternativas.findIndex(option => option.correta);
    assert.deepEqual(getMatchingAssignments(question, [index]), getMatchingQuestion(question).solution);
    assert.ok(confirmStudyAnswer(createStudy([question], 'test'), question, [index]));
  }
});

test('association answers survive JSON persistence, contribute one point and lock after study confirmation', () => {
  const byId = Object.fromEntries(questions.map(question => [question.id, question]));
  const simulation = createAttempt(questions, 'test');
  simulation.state.ids = matchingQuestions.map(question => question.id);
  for (const question of matchingQuestions) simulation.state.answers[question.id] = tokens(question);
  assert.equal(scoreAttempt(JSON.parse(JSON.stringify(simulation)), byId), 14);
  const question = matchingQuestions[0], selected = tokens(question), study = createStudy([question], 'test');
  assert.ok(confirmStudyAnswer(study, question, selected));
  selected.pop();
  assert.equal(study.state.answers[question.id].length, 4);
  assert.equal(confirmStudyAnswer(study, question, []), false);
  const restored = JSON.parse(JSON.stringify(study));
  assert.deepEqual(studyProgress(restored, byId), {answered: 1, correct: 1, wrong: 0, remaining: 0, accuracy: 100});
  restored.finished_at = new Date().toISOString();
  assert.equal(confirmStudyAnswer(restored, question, tokens(question)), false);
});
