import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getMatchingQuestion } from '../matching.js';
import { isCorrect } from '../quiz.js';
import { validateMemoryAids } from '../memorization.js';

const root = new URL('../', import.meta.url);
const questions = JSON.parse(await readFile(new URL('data/cis-em/questions.json', root), 'utf8'));
const aids = JSON.parse(await readFile(new URL('data/cis-em/memory-aids.json', root), 'utf8'));
const report = JSON.parse(await readFile(new URL('data/cis-em/import-report.json', root), 'utf8'));

test('EM retains all 116 unique records and the supplied primary multiple-choice answers', () => {
  assert.equal(questions.length, 116);
  assert.equal(new Set(questions.map(q => q.id)).size, 116);
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
  assert.equal(questions.filter(q => q.fonte.tipo === 'user_provided').length, 7);
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

test('source disagreements and incomplete options remain explicit in both bank and memory aids', () => {
  assert.deepEqual(report.gabaritos_divergentes_colecao, [19, 26, 56, 60, 63, 102, 104, 109]);
  for (const number of report.gabaritos_divergentes_colecao) {
    const q = questions[number - 1];
    assert.match(q.observacao, /gabaritos divergentes/);
    assert.equal(aids[q.id].observacao, q.observacao);
  }
  const incomplete = questions[21];
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
