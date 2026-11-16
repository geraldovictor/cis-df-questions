import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateMemoryAids } from '../memorization.js';
import { getMatchingQuestion, isMatchingComplete } from '../matching.js';
import { isCorrect } from '../quiz.js';

const root = new URL('../', import.meta.url);
const read = async file => JSON.parse(await readFile(new URL('data/cis-csm/' + file, root), 'utf8'));
const [questions, aids, report] = await Promise.all(['questions.json', 'memory-aids.json', 'import-report.json'].map(read));
const byNumber = number => questions.find(q => q.fonte.numero === number);

test('CIS-CSM retains all 240 source records with stable IDs and exact supplied textual answers', () => {
  assert.equal(questions.length, 240);
  assert.equal(report.original_records.length, 240);
  assert.equal(new Set(questions.map(q => q.id)).size, 240);
  assert.equal(new Set(questions.map(q => q.fonte.numero)).size, 240);
  assert.equal(byNumber(231), undefined);
  assert.ok(byNumber(241));
  for (const original of report.original_records) {
    const q = byNumber(original.source_question_number);
    assert.equal(q.id, 'csm-' + original.id);
    assert.equal(q.certification, 'cis-csm');
    assert.equal(q.fonte.resposta, original.answer);
    assert.equal(q.fonte.resposta_ET, original.answer_ET);
    if (q.tipo === 'matching') {
      assert.equal(q.fonte.enunciado_original, original.question_text);
      continue;
    }
    assert.equal(q.pergunta, original.question_text);
    const labels = Object.keys(original.choices).sort();
    assert.deepEqual(q.alternativas.map(a => a.texto), labels.map(label => original.choices[label]));
    const correctLabels = original.answer.match(/[A-Z]/g);
    assert.deepEqual(q.alternativas.map(a => a.correta), labels.map(label => correctLabels.includes(label)));
    assert.ok(q.alternativas.every(a => a.explicacao === (original.answer_description || '')));
  }
});

test('CIS-CSM retains duplicate-stem variants and primary answers when answer_ET differs', () => {
  assert.equal(report.source_metadata.available_question_count, 240);
  assert.equal(report.source_metadata.current_total_independently_verified, false);
  assert.deepEqual(report.source_metadata.missing_numbers_within_observed_source_range, [231]);
  assert.deepEqual(report.source_metadata.source_question_numbers_above_cache_reported_total, [241]);
  for (const numbers of [[9, 98], [60, 228], [66, 226], [99, 227], [116, 224]]) {
    assert.notEqual(byNumber(numbers[0]).id, byNumber(numbers[1]).id);
    for (const number of numbers) assert.match(byNumber(number).observacao, /preservados separadamente/);
  }
  for (const number of [138, 196, 235]) {
    const q = byNumber(number);
    assert.equal(q.fonte.resposta, 'B');
    assert.equal(q.fonte.resposta_ET, 'A');
    assert.equal(q.alternativas[1].correta, true);
    assert.equal(q.alternativas[0].correta, false);
    assert.match(q.observacao, /divergência/);
  }
});

test('CIS-CSM HOTSPOT mappings match the supplied answer images and require every association', () => {
  for (const [number, expected] of [[41, {1:'B', 2:'A', 3:'C', 4:'D'}], [50, {1:'B', 2:'A', 3:'D', 4:'C'}]]) {
    const q = byNumber(number);
    const model = getMatchingQuestion(q);
    assert.equal(model.items.length, 4);
    assert.equal(model.targets.length, 4);
    if (number === 41) assert.deepEqual(model.items.map(item => item.text), ['Partner', 'Account', 'Contact', 'Consumer']);
    assert.deepEqual(model.solution, expected);
    const answer = Object.entries(expected).map(([target, item]) => `match:${target}:${item}`);
    assert.equal(isMatchingComplete(q, answer), true);
    assert.equal(isCorrect(q, answer), true);
    assert.equal(isMatchingComplete(q, answer.slice(1)), false);
    assert.equal(isCorrect(q, answer.slice(1)), false);
    assert.ok(q.contexto.paragrafos[0].startsWith('Image transcript:'));
    assert.equal(q.contexto.imagens.length, 1);
    assert.equal(q.fonte.imagens_resposta.length, 1);
  }
});

test('CIS-CSM keeps every supplied image locally with the original content hash', async () => {
  assert.equal(report.images.length, 4);
  for (const image of report.images) {
    assert.match(image.local_file, /^data\/cis-csm\/images\/image-00[1-4]\.png$/);
    const bytes = await readFile(new URL(image.local_file, root));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes.length, image.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), image.sha256);
  }
});

test('CIS-CSM includes 240 distinct Portuguese mnemonics bound to current questions and all correct answers', () => {
  assert.equal(Object.keys(aids).length, 240);
  assert.deepEqual(Object.keys(aids).sort(), questions.map(q => q.id).sort());
  assert.equal(new Set(Object.values(aids).map(aid => aid.macete)).size, 240);
  assert.equal(validateMemoryAids(aids, questions), aids);
  for (const q of questions) {
    const aid = aids[q.id];
    assert.ok(aid.macete.length >= 15, q.id);
    assert.ok(aid.conexao.length >= 30, q.id);
    for (const field of ['gatilho', 'macete', 'observacao']) assert.doesNotMatch(aid[field] || '', /\?\?|\s\?\s/, `${q.id} ${field}`);
    assert.equal(aid.observacao, q.observacao);
    for (const answer of q.alternativas.filter(a => a.correta)) assert.ok(aid.conexao.includes(answer.texto), q.id);
  }
});
