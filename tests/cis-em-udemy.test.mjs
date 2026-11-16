import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isCorrect } from '../quiz.js';
import { validateMemoryAids } from '../memorization.js';
import { questionAudioPath } from '../question-content.js';

const root = new URL('../', import.meta.url);
const questions = JSON.parse(await readFile(new URL('data/cis-em/questions.json', root), 'utf8'));
const aids = JSON.parse(await readFile(new URL('data/cis-em/memory-aids.json', root), 'utf8'));
const report = JSON.parse(await readFile(new URL('data/cis-em/udemy-import-report.json', root), 'utf8'));
const byId = Object.fromEntries(questions.map(question => [question.id, question]));
const enrichments = new Map(report.enrichments.map(entry => [entry.id, entry]));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const hash = value => sha256(JSON.stringify(value));
const correctIndices = question => question.alternativas.flatMap((answer, index) => answer.correta ? [index] : []);
const previousQuestionsHash = '8fe494b8d9f6d0db8f51b25e3b111db40afdad88c4f9c4ea7020afe895c0f044';
const previousMemoryHash = '163b379fb4d5d402d554bf0138030dbb2fb0a38baee10e0ee4a039f797564bc1';
const previousAudioHash = '5a6251cfa6fc0f2aea72505df99cf3a897cf2b1c3298088290ef808393316a0e';
const anomalyId = 'em-6HAXF1caPVZapUmb0tqD', orderId = 'em-lu6aEpQjhJCwCVMjUvsO';

test('the five supplied files account for every record with explicit addition, duplicate, enrichment or hold decisions', () => {
  assert.equal(report.previous_total, 118);
  assert.equal(report.input_total, 136);
  assert.equal(report.added_total, 19);
  assert.equal(report.resulting_total, 137);
  assert.equal(questions.length, 137);
  assert.equal(new Set(questions.map(question => question.id)).size, 137);
  assert.equal(report.source_files.length, 5);
  assert.deepEqual(report.source_files.map(source => source.total), [30, 30, 30, 30, 16]);
  assert.equal(report.entries.length, 136);
  assert.equal(new Set(report.entries.map(entry => `${entry.file}:${entry.index}`)).size, 136);
  for (const source of report.source_files) {
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(report.entries.filter(entry => entry.file === source.file).map(entry => entry.index).sort((a, b) => a - b),
      Array.from({ length: source.total }, (_, index) => index + 1));
  }
  const counts = {};
  for (const entry of report.entries) {
    counts[entry.decision] = (counts[entry.decision] || 0) + 1;
    assert.equal(entry.question, entry.original_record.pergunta);
    assert.ok(entry.reason.trim());
    assert.ok(entry.action.trim());
    for (const id of entry.existing_ids) assert.ok(byId[id], `${entry.file}:${entry.index} references an existing question`);
  }
  assert.deepEqual(counts, report.decision_counts);
  assert.deepEqual(questions.slice(118).map(question => question.id), report.added_ids);
  assert.deepEqual(report.entries.filter(entry => entry.added_id).map(entry => entry.added_id), report.added_ids);
});

test('the 118 previous IDs and ordering survive, with only the two documented question and memory-aid enrichments', () => {
  assert.equal(report.previous_records.length, 118);
  assert.deepEqual(questions.slice(0, 118).map(question => question.id), report.previous_records.map(record => record.id));
  assert.deepEqual([...enrichments.keys()], [anomalyId, orderId]);
  assert.equal(report.unmodified_previous_total, 116);
  const restoredQuestions = questions.slice(0, 118).map(question => enrichments.get(question.id)?.before_question || question);
  const restoredAids = Object.fromEntries(restoredQuestions.map(question => [question.id, enrichments.get(question.id)?.before_memory_aid || aids[question.id]]));
  assert.equal(report.previous_questions_sha256, previousQuestionsHash);
  assert.equal(report.previous_memory_aids_sha256, previousMemoryHash);
  assert.equal(hash(restoredQuestions), previousQuestionsHash);
  assert.equal(hash(restoredAids), previousMemoryHash);
  assert.equal(hash(report.previous_records.map(record => [record.id, record.audio_sha256])), previousAudioHash);
  for (const record of report.previous_records) {
    const enrichment = enrichments.get(record.id), question = byId[record.id];
    assert.equal(hash(enrichment?.before_question || question), record.question_sha256, record.id);
    assert.equal(hash(enrichment?.before_memory_aid || aids[record.id]), record.memory_aid_sha256, record.id);
    if (enrichment) {
      assert.equal(question.id, enrichment.before_question.id);
      assert.equal(question.pergunta, enrichment.before_question.pergunta);
      assert.deepEqual(question.alternativas.map(answer => answer.correta), enrichment.before_question.alternativas.map(answer => answer.correta));
      assert.equal(enrichment.before_audio_sha256, record.audio_sha256);
    }
  }
});

test('all nineteen additions retain source wording, option order, answer flags and explanations without invented alternatives', () => {
  for (const entry of report.entries.filter(entry => entry.added_id)) {
    const question = byId[entry.added_id], original = entry.original_record;
    assert.equal(question.pergunta, original.pergunta);
    assert.deepEqual(question.alternativas, original.alternativas.map(answer => ({
      texto: answer.texto, correta: answer.correta, explicacao: answer.explicacao || ''
    })));
    const expected = correctIndices(original);
    assert.deepEqual(correctIndices(question), expected);
    assert.deepEqual(entry.correct_indices, expected);
    assert.deepEqual(entry.correct_texts, expected.map(index => original.alternativas[index].texto));
    assert.equal(question.fonte.arquivo, entry.file);
    assert.equal(question.fonte.indice, entry.index);
    assert.equal(question.fonte.resposta, expected.map(index => String.fromCharCode(65 + index)).join(''));
    assert.ok(isCorrect(question, [...expected].reverse()));
    assert.equal(isCorrect(question, []), false);
    for (const index of expected) assert.equal(isCorrect(question, expected.filter(value => value !== index)), false);
    for (const index of question.alternativas.flatMap((answer, index) => !answer.correta ? [index] : [])) {
      assert.equal(isCorrect(question, [...expected, index]), false);
    }
  }
});

test('conflicting duplicates preserve old answers and the unresolved interval question is not published', () => {
  const conflicts = report.entries.filter(entry => entry.decision === 'duplicate_answer_conflict');
  assert.equal(conflicts.length, 6);
  for (const entry of conflicts) {
    assert.equal(entry.action, 'skip_new_record_preserve_existing_answer');
    assert.equal(entry.added_id, undefined);
    for (const id of entry.existing_ids) {
      const original = enrichments.get(id)?.before_question || byId[id];
      assert.deepEqual(correctIndices(byId[id]), correctIndices(original));
    }
  }
  const held = report.entries.filter(entry => entry.decision === 'hold_for_review');
  assert.equal(held.length, 1);
  assert.equal(held[0].file, 'cim-em-udemy4.json');
  assert.equal(held[0].index, 21);
  assert.equal(held[0].action, 'do_not_append');
  assert.equal(held[0].added_id, undefined);
  assert.equal(questions.some(question => question.pergunta === held[0].question), false);
  assert.deepEqual(held[0].correct_texts, ['5 seconds']);
  assert.match(held[0].verification_url, /^https:\/\/learning\.servicenow\.com\//);
});

test('the anomaly enrichment fills only missing A/B texts and the diagnostic variant attributes every reused context source', () => {
  const entry = report.entries.find(entry => entry.file === 'cim-em-udemy5.json' && entry.index === 14);
  const question = byId[anomalyId], before = enrichments.get(anomalyId).before_question;
  const anomalyTexts = ['A', 'B'].map(letter => entry.original_record.alternativas
    .find(answer => answer.texto.startsWith(`${letter}.\n`)).texto.replace(`${letter}.`, `Anomaly ${letter}`));
  assert.equal(entry.decision, 'enrich_existing');
  assert.equal(question.alternativas.length, 4);
  assert.deepEqual(question.alternativas.slice(0, 2).map(answer => answer.texto), anomalyTexts);
  assert.deepEqual(question.alternativas.slice(2), before.alternativas.slice(2));
  assert.deepEqual(question.contexto, before.contexto);
  assert.deepEqual(correctIndices(question), [1]);
  assert.equal(question.audio_version, 2);
  assert.match(questionAudioPath(question), /\?v=2$/);
  const diagnosticEntry = report.entries.find(entry => entry.decision === 'new_scenario_variant');
  const diagnostic = byId[diagnosticEntry.added_id];
  assert.deepEqual(diagnostic.contexto.imagens, before.contexto.imagens);
  assert.deepEqual(diagnostic.contexto.paragrafos, [...before.contexto.paragrafos, ...anomalyTexts]);
  assert.deepEqual(diagnostic.fonte.fontes_contexto, [
    { id: anomalyId, arquivo: 'data/cis-em/images/image10.png' },
    { arquivo: 'cim-em-udemy5.json', indice: 14 }
  ]);
  assert.match(diagnostic.observacao, /cim-em-udemy5\.json/);
});

test('the empty-answer source reuses the existing order question with documented verification and unchanged option indices', () => {
  const entry = report.entries.find(entry => entry.decision === 'resolved_existing_missing_answer');
  const question = byId[orderId], before = enrichments.get(orderId).before_question;
  assert.deepEqual(entry.original_record.alternativas, []);
  assert.deepEqual(entry.correct_indices, []);
  assert.equal(entry.added_id, undefined);
  assert.equal(entry.resolved_answer.id, orderId);
  assert.deepEqual(entry.resolved_answer.correct_indices, [2]);
  assert.deepEqual(question.alternativas.map(({ texto, correta }) => ({ texto, correta })),
    before.alternativas.map(({ texto, correta }) => ({ texto, correta })));
  assert.equal(question.fonte.verificacao_resposta.url, entry.resolved_answer.verification_url);
  assert.match(question.observacao, /Search for additional rules/);
  assert.match(question.observacao, /Stop search for additional rules/);
  assert.ok(question.alternativas[2].explicacao.trim());
  assert.equal(enrichments.get(orderId).audio_changed, false);
});

test('previous audio bytes remain unchanged and every available changed narration has a complete asset', async () => {
  for (const record of report.previous_records) {
    const enrichment = enrichments.get(record.id);
    const bytes = await readFile(new URL(questionAudioPath(byId[record.id]), root));
    if (enrichment?.audio_changed) assert.notEqual(sha256(bytes), record.audio_sha256, record.id);
    else assert.equal(sha256(bytes), record.audio_sha256, record.id);
  }
  const changedQuestions = [...report.added_ids, ...enrichments.keys()].map(id => byId[id]);
  assert.equal(validateMemoryAids(aids, changedQuestions), aids);
  for (const question of changedQuestions) {
    if (question.audio_disponivel === false) continue;
    const bytes = await readFile(new URL(questionAudioPath(question), root));
    assert.ok(bytes.length > 1000, question.id);
    assert.ok(bytes.subarray(0, 3).toString() === 'ID3' || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0, question.id);
  }
  assert.deepEqual(questions.filter(question => question.audio_disponivel === false).map(question => question.id), ['em-udemy-c503c58b3715a6aba9db']);
  assert.equal(questions.filter(question => question.audio_disponivel !== false).length, 136);
});
