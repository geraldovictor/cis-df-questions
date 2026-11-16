import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { getMatchingQuestion } from '../matching.js';
import { isCorrect } from '../quiz.js';
import { validateMemoryAids } from '../memorization.js';
import { questionAudioPath } from '../question-content.js';

const root = new URL('../', import.meta.url);
const questions = JSON.parse(await readFile(new URL('data/cis-em/questions.json', root), 'utf8'));
const aids = JSON.parse(await readFile(new URL('data/cis-em/memory-aids.json', root), 'utf8'));
const report = JSON.parse(await readFile(new URL('data/cis-em/import-report.json', root), 'utf8'));
const supplemental = JSON.parse(await readFile(new URL('data/cis-em/supplemental-import-report.json', root), 'utf8'));
const udemy = JSON.parse(await readFile(new URL('data/cis-em/udemy-import-report.json', root), 'utf8'));
const enrichments = new Map(udemy.enrichments.map(entry => [entry.id, entry]));
const previousQuestionsHash = 'ff8434b804a62f16a6e930afcc6ef0a58ba40d1226e1b47bb2aa5182c5e656b2';
const previousMemoryHash = '4e5e2197c47a3e15dd953b7b895bb1f599c5335605e9f6aaa16b53406c06febd';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('EM retains all 137 unique records and the supplied primary multiple-choice answers', () => {
  assert.equal(questions.length, 137);
  assert.equal(new Set(questions.map(q => q.id)).size, 137);
  for (const q of questions) {
    assert.equal(q.certification, 'cis-em');
    assert.ok(q.id.startsWith('em-'));
    assert.ok(q.pergunta.trim());
    if (q.tipo === 'matching') continue;
    assert.ok(q.alternativas.length > 1, q.id);
    const expected = [...q.fonte.resposta].map(letter => letter.charCodeAt(0) - 65);
    assert.deepEqual(q.alternativas.flatMap((option, index) => option.correta ? [index] : []), expected, q.id);
    assert.ok(isCorrect(q, expected), q.id);
    assert.equal(isCorrect(q, []), false, q.id);
  }
  assert.equal(questions.slice(0, 118).filter(q => q.fonte.tipo === 'user_provided').length, 9);
});

test('appending user questions 126 and 127 preserves all previous questions and memory aids', () => {
  assert.equal(supplemental.previous_total, 116);
  assert.equal(supplemental.added_total, 2);
  assert.equal(supplemental.resulting_total, 118);
  assert.equal(supplemental.previous_questions_sha256, previousQuestionsHash);
  assert.equal(supplemental.previous_memory_aids_sha256, previousMemoryHash);
  const previousQuestions = questions.slice(0, 116).map(q => enrichments.get(q.id)?.before_question || q);
  const previousIds = new Set(previousQuestions.map(q => q.id));
  const previousAids = Object.fromEntries(Object.entries(aids).filter(([id]) => previousIds.has(id))
    .map(([id, aid]) => [id, enrichments.get(id)?.before_memory_aid || aid]));
  assert.equal(hash(previousQuestions), previousQuestionsHash);
  assert.equal(hash(previousAids), previousMemoryHash);
  assert.deepEqual(questions.slice(116, 118).map(q => q.id), [
    'em-user-provided-126-alert-automation',
    'em-user-provided-127-pull-connector'
  ]);
});

test('both appended questions preserve the supplied wording, options and answer sets', () => {
  assert.equal(supplemental.entries.length, 2);
  assert.deepEqual(supplemental.entries.map(entry => entry.number), [126, 127]);
  assert.deepEqual(supplemental.entries.map(entry => entry.answer), [['A'], ['A', 'B', 'C', 'F']]);
  for (const entry of supplemental.entries) {
    const q = questions.find(question => question.id === entry.id);
    assert.ok(q, entry.id);
    assert.equal(q.pergunta, entry.question);
    const letters = Object.keys(entry.options).sort();
    assert.deepEqual(q.alternativas.map(option => option.texto), letters.map(letter => entry.options[letter]));
    assert.deepEqual(q.alternativas.flatMap((option, index) => option.correta ? [letters[index]] : []), entry.answer);
    assert.equal(q.fonte.resposta, entry.answer.join(''));
    assert.equal(q.fonte.numero, entry.number);
    assert.equal(q.fonte.tipo, 'user_provided');
  }
  const connector = questions.find(q => q.id === 'em-user-provided-127-pull-connector');
  assert.match(connector.observacao, /nota[çc][ãa]o|grafia|origem|original/i);
  assert.ok(connector.pergunta.includes('M.0 Server'));
  assert.ok(connector.alternativas[3].texto.includes('credentials la '));
  assert.ok(connector.alternativas[5].texto.includes('credentials lo '));
});

test('the pull-connector question requires all four supplied answers and rejects omissions and extras', () => {
  const connector = questions.find(q => q.id === 'em-user-provided-127-pull-connector');
  assert.equal(connector.alternativas.length, 6);
  const correct = [0, 1, 2, 5];
  assert.ok(isCorrect(connector, correct));
  assert.ok(isCorrect(connector, [...correct].reverse()));
  assert.equal(isCorrect(connector, []), false);
  for (const omitted of correct) assert.equal(isCorrect(connector, correct.filter(index => index !== omitted)), false);
  for (const extra of [3, 4]) assert.equal(isCorrect(connector, [...correct, extra]), false);
  const automation = questions.find(q => q.id === 'em-user-provided-126-alert-automation');
  assert.ok(isCorrect(automation, [0]));
  assert.equal(isCorrect(automation, []), false);
  assert.equal(isCorrect(automation, [0, 1]), false);
});

test('both appended questions have current memory aids and playable-size MP3 assets', async () => {
  const added = questions.slice(116, 118);
  assert.equal(validateMemoryAids(aids, added), aids);
  for (const q of added.filter(question => question.audio_disponivel !== false)) {
    const bytes = await readFile(new URL(questionAudioPath(q), root));
    assert.ok(bytes.length > 1000, q.id);
    assert.ok(bytes.subarray(0, 3).toString() === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0), q.id);
  }
});

test('the image-only processing sequence uses every supplied position without invented distractors', () => {
  const q = questions.find(q => q.tipo === 'matching');
  assert.equal(q.fonte.numero, 41);
  assert.equal(q.alternativas.length, 1);
  assert.deepEqual(getMatchingQuestion(q).solution, { 1: 'A', 2: 'C', 3: 'D', 4: 'E', 5: 'B' });
  assert.ok(isCorrect(q, ['match:1:A', 'match:2:C', 'match:3:D', 'match:4:E', 'match:5:B']));
  assert.equal(isCorrect(q, ['match:1:A', 'match:2:B', 'match:3:C', 'match:4:D', 'match:5:E']), false);
  assert.ok(q.fonte.enunciado_original.includes('//IMG//'));
  assert.equal(q.pergunta.includes('//IMG//'), false);
  assert.equal(q.contexto.imagens.some(image => q.fonte.imagens_resposta.includes(image.src)), false);
});

test('all source figures are local PNGs and image questions have accessible textual context', async () => {
  assert.equal(report.imagens.length, 6);
  for (const path of report.imagens) {
    const bytes = await readFile(new URL(path, root));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', path);
  }
  for (const q of questions.filter(q => q.contexto?.imagens)) {
    for (const figure of q.contexto.imagens) {
      assert.ok(report.imagens.includes(figure.src), q.id);
      assert.ok(figure.alt.length > 30, q.id);
    }
    assert.ok(q.contexto.paragrafos?.length || q.contexto.tabela, q.id);
  }
});

test('historical source disagreements and missing options stay traceable while current aids retain current observations', () => {
  assert.deepEqual(report.gabaritos_divergentes_colecao, [19, 26, 56, 60, 63, 102, 104, 109]);
  for (const number of report.gabaritos_divergentes_colecao) {
    const q = questions[number - 1];
    assert.match((enrichments.get(q.id)?.before_question || q).observacao, /gabaritos divergentes/);
    assert.equal(aids[q.id].observacao, q.observacao);
  }
  const incomplete = enrichments.get(questions[21].id).before_question;
  assert.ok(incomplete.alternativas.slice(0, 2).every(option => /content absent/.test(option.texto)));
  assert.equal(incomplete.fonte.resposta, 'B');
  assert.match(incomplete.observacao, /não foi incluído/);
  const variant = questions[115];
  assert.equal(variant.fonte.variante_de_colecao, 37);
});

test('all EM memory aids match their question context and supplied correct answers', () => {
  assert.equal(Object.keys(aids).length, questions.length);
  assert.equal(validateMemoryAids(aids, questions), aids);
  assert.equal(new Set(Object.values(aids).map(aid => aid.macete)).size, questions.length);
});
