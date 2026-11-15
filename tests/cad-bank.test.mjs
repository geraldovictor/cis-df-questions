import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateMemoryAids } from '../memorization.js';

const read = async name => JSON.parse(await readFile(new URL('../data/cis-cad/' + name, import.meta.url), 'utf8'));
const [questions, aids, report] = await Promise.all(['questions.json', 'memory-aids.json', 'import-report.json'].map(read));

test('CAD imports all 150 stable records and preserves supplied text and answer sets', () => {
  assert.equal(questions.length, 150);
  assert.equal(new Set(questions.map(q => q.id)).size, 150);
  assert.equal(report.original_records.length, 150);
  for (const original of report.original_records) {
    const q = questions.find(q => q.source_id === original.u_number);
    assert.equal(q.id, 'cad-' + original.u_number);
    assert.equal(q.certification, 'cis-cad');
    assert.equal(q.pergunta, original.u_question);
    const repair = report.repairs.find(item => item.source_id === original.u_number);
    const options = repair?.after || JSON.parse(original.u_options);
    const answers = original.u_correct_answer.match(/[A-Z]/g);
    assert.deepEqual(q.alternativas.map(a => a.texto), Object.values(options));
    assert.deepEqual(q.alternativas.filter(a => a.correta).map(a => a.texto), Object.entries(options).filter(([label]) => answers.includes(label)).map(([, text]) => text));
    assert.ok(q.alternativas.every(a => a.explicacao === ''));
  }
});

test('CAD explicitly reports incomplete source options and contradictory choose counts', () => {
  assert.equal(report.repairs.length, 1);
  const recovered = questions.find(q => q.source_id === 'QST0001054');
  assert.equal(recovered.alternativas.length, 4);
  assert.equal(recovered.alternativas.find(a => a.correta).texto, 'bandc');
  assert.match(recovered.observacao, /marcadores explícitos/);
  const countMismatch = questions.find(q => q.source_id === 'QST0001146');
  assert.match(countMismatch.pergunta, /Choose four/);
  assert.equal(countMismatch.alternativas.filter(a => a.correta).length, 3);
  assert.match(countMismatch.observacao, /apenas três/);
});

test('CAD has an individual usable Portuguese memory aid tied to every imported answer', () => {
  assert.equal(Object.keys(aids).length, 150);
  assert.equal(new Set(Object.values(aids).map(aid => aid.macete)).size, 150);
  assert.equal(validateMemoryAids(aids, questions), aids);
  for (const q of questions) {
    const aid = aids[q.id];
    assert.ok(aid.macete.length >= 15);
    assert.ok(aid.conexao.length >= 30);
    if (q.observacao) assert.equal(aid.observacao, q.observacao);
    for (const field of ['gatilho', 'macete', 'conexao', 'observacao']) {
      assert.doesNotMatch(aid[field] || '', /\?\?|\s\?\s/, `${q.id}: damaged Portuguese in ${field}`);
    }
  }
});
