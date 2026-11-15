import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateMemoryAids } from '../memorization.js';

const read = async name => JSON.parse(await readFile(new URL('../data/cis-cad/' + name, import.meta.url), 'utf8'));
const [questions, aids, report, supplement] = await Promise.all(['questions.json', 'memory-aids.json', 'import-report.json', 'supplemental-import-report.json'].map(read));

test('CAD imports all 150 stable records and preserves supplied text and answer sets', () => {
  assert.equal(questions.length, 151);
  assert.equal(new Set(questions.map(q => q.id)).size, 151);
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
  assert.equal(Object.keys(aids).length, 151);
  assert.equal(new Set(Object.values(aids).map(aid => aid.macete)).size, 151);
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

test('CAD supplement adds only its missing question and retains all original records and memory aids', () => {
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  assert.equal(supplement.source.records_supplied, 146);
  assert.equal(supplement.previous_total, 150);
  assert.equal(supplement.added_total, 1);
  assert.equal(supplement.duplicate_total, 145);
  assert.equal(supplement.resulting_total, questions.length);
  assert.equal(supplement.decisions.length, 146);
  assert.equal(new Set(supplement.decisions.map(item => item.source_id)).size, 146);
  const originals = questions.slice(0, 150);
  assert.equal(hash(originals), supplement.previous_questions_sha256);
  const originalIds = new Set(originals.map(question => question.id));
  const originalAids = Object.fromEntries(Object.entries(aids).filter(([id]) => originalIds.has(id)));
  assert.equal(hash(originalAids), supplement.previous_memory_aids_sha256);
  const added = supplement.decisions.filter(item => item.action === 'added');
  assert.equal(added.length, 1);
  assert.equal(added[0].source_number, 5);
  const question = questions.at(-1);
  assert.equal(question.id, 'cad-srNSvJT2oarIvswoZGsi');
  assert.equal(question.id, added[0].added_id);
  assert.equal(question.pergunta, added[0].original_question);
  const labels = Object.keys(added[0].original_choices).sort();
  assert.deepEqual(question.alternativas.map(answer => answer.texto), labels.map(label => added[0].original_choices[label]));
  assert.deepEqual(question.alternativas.flatMap((answer, index) => answer.correta ? [labels[index]] : []), ['B']);
  for (const decision of supplement.decisions.filter(item => item.action === 'duplicate')) {
    assert.ok(originalIds.has(decision.existing_id));
    assert.equal(questions.some(question => question.source_id === decision.source_id), false);
  }
  const reviewed = new Map(supplement.decisions.filter(item => item.comparison === 'reviewed-same-scenario').map(item => [item.source_number, item.existing_id]));
  assert.deepEqual([...reviewed], [[18, 'cad-QST0001018'], [117, 'cad-QST0001117'], [118, 'cad-QST0001118'], [122, 'cad-QST0001122'], [124, 'cad-QST0001124']]);
});
