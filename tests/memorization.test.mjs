import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateMemoryAids, restoreMemoryProgress, memoryDeck } from '../memorization.js';

const files = ['questoes-1-corrigida (1).json', 'questoes-2-corrigida-v2 (1).json', 'questoes-3-corrigida-v2 (1).json'];
const questions = (await Promise.all(files.map(async (file, f) =>
  JSON.parse(await readFile(new URL('../' + file, import.meta.url), 'utf8'))
    .map((q, i) => ({ ...q, id: `${f + 1}-${i + 1}` }))))).flat();
const aids = JSON.parse(await readFile(new URL('../memory-aids.json', import.meta.url), 'utf8'));

test('every source question has its own usable memory aid tied to the original correct answers', () => {
  assert.equal(questions.length, 205);
  assert.equal(Object.keys(aids).length, 205);
  assert.deepEqual(Object.keys(aids).sort(), questions.map(q => q.id).sort());
  assert.equal(validateMemoryAids(aids, questions), aids);
  const mnemonics = new Set();
  for (const q of questions) {
    const aid = aids[q.id];
    assert.ok(aid.macete.trim().length >= 15, q.id);
    assert.ok(aid.conexao.trim().length >= 30, q.id);
    assert.deepEqual([...aid.respostas].sort((a, b) => a - b), q.alternativas.flatMap((answer, index) => answer.correta ? [index] : []), q.id);
    mnemonics.add(aid.macete.trim());
  }
  assert.equal(mnemonics.size, 205);
});

test('missing, invalid and stale memory aids cannot be shown as a complete deck', () => {
  const q = questions.find(q => q.alternativas.filter(answer => answer.correta).length > 1);
  const original = aids[q.id];
  for (const changed of [undefined, { ...original, macete: ' ' }, { ...original, gatilho: null }, { ...original, assinatura: undefined },
    { ...original, respostas: original.respostas.slice(1) }, { ...original, respostas: [99] },
    { ...original, respostas: original.respostas.map(() => original.respostas[0]) }]) {
    assert.throws(() => validateMemoryAids({ [q.id]: changed }, [q]), /incompletas|desatualizadas/);
  }
  const revised = { ...q, alternativas: q.alternativas.map((answer, i) => ({ ...answer, correta: i === q.alternativas.findIndex(item => !item.correta) })) };
  assert.throws(() => validateMemoryAids({ [q.id]: original }, [revised]), /desatualizadas/);
  for (const changedSource of [{ ...q, pergunta: q.pergunta + ' Additional condition.' },
    { ...q, alternativas: q.alternativas.map(answer => answer.correta ? { ...answer, texto: answer.texto + ' revised' } : answer) }]) {
    assert.throws(() => validateMemoryAids({ [q.id]: original }, [changedSource]), /desatualizadas/);
  }
  assert.deepEqual(aids[q.id], original);
});

test('saved progress keeps valid ratings and ordering while repairing removed or duplicated question IDs', () => {
  const bank = questions.slice(0, 3), ids = bank.map(q => q.id);
  const raw = { marks: { [ids[0]]: 'known', [ids[1]]: 'review', [ids[2]]: 'bad', removed: 'known' },
    order: [ids[1], ids[1], 'removed'], currentId: ids[1], mode: 'test', filter: 'review' };
  assert.deepEqual(restoreMemoryProgress(raw, bank), {
    marks: { [ids[0]]: 'known', [ids[1]]: 'review' }, order: [ids[1], ids[0], ids[2]],
    currentId: ids[1], mode: 'test', filter: 'review'
  });
  assert.deepEqual(raw.order, [ids[1], ids[1], 'removed']);
  const reset = restoreMemoryProgress({ order: 'bad', currentId: 'removed', mode: 'bad', filter: 'bad' }, bank);
  assert.deepEqual(reset, { marks: {}, order: ids, currentId: ids[0], mode: 'learn', filter: 'all' });
  assert.deepEqual(restoreMemoryProgress(null, []), { marks: {}, order: [], currentId: undefined, mode: 'learn', filter: 'all' });
});

test('review, known and new filters remain independent of a reordered deck', () => {
  const bank = questions.slice(0, 3), [first, second, third] = bank;
  const marks = { [first.id]: 'known', [second.id]: 'review' }, reordered = [third, second, first];
  assert.deepEqual(memoryDeck(reordered, marks, 'all'), reordered);
  assert.deepEqual(memoryDeck(reordered, marks, 'known'), [first]);
  assert.deepEqual(memoryDeck(reordered, marks, 'review'), [second]);
  assert.deepEqual(memoryDeck(reordered, marks, 'new'), [third]);
  marks[second.id] = 'known';
  assert.deepEqual(memoryDeck(reordered, marks, 'review'), []);
  assert.deepEqual(memoryDeck(reordered, marks, 'known'), [second, first]);
});

test('search ignores accents and case and finds cues, answers, context and source references', () => {
  const bank = [
    { id: 'one', pergunta: 'Texto original', alternativas: [{ texto: 'Correctness', correta: true }] },
    { id: 'two', pergunta: 'Outra questão', contexto: { introducao: 'Identificação', paragrafos: ['Prioridade regional'] }, alternativas: [{ texto: 'Wrong-only search word', correta: false }] }
  ];
  const hints = { one: { gatilho: 'Saúde dos CIs', macete: 'Órfão pede correção', conexao: 'Associação útil' } };
  assert.deepEqual(memoryDeck(bank, {}, 'all', '  SAUDE ', hints), [bank[0]]);
  assert.deepEqual(memoryDeck(bank, {}, 'all', 'orfao', hints), [bank[0]]);
  assert.deepEqual(memoryDeck(bank, {}, 'all', 'ASSOCIACAO', hints), [bank[0]]);
  assert.deepEqual(memoryDeck(bank, {}, 'all', 'correctness', hints), [bank[0]]);
  assert.deepEqual(memoryDeck(bank, {}, 'all', 'identificacao', hints), [bank[1]]);
  assert.deepEqual(memoryDeck(bank, {}, 'all', 'regional', hints), [bank[1]]);
  assert.deepEqual(memoryDeck(bank, {}, 'all', 'two', hints), [bank[1]]);
  assert.deepEqual(memoryDeck(bank, {}, 'all', 'Wrong-only search word', hints), []);
  assert.deepEqual(memoryDeck(bank, { one: 'known' }, 'review', 'saude', hints), []);
});
