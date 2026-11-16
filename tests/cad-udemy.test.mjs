import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const read=async n=>JSON.parse(await readFile(new URL('../data/cis-cad/'+n,import.meta.url),'utf8'));
test('CAD additions preserve the original151 and every selected supplied question and answer',async()=>{
 const [q,r]=await Promise.all([read('questions.json'),read('udemy-import-report.json')]);
 assert.equal(createHash('sha256').update(JSON.stringify(q.slice(0,151).map(q=>r.enrichments.find(e=>e.id===q.id)?.before_question || q))).digest('hex'),r.previous_questions_sha256);
 assert.equal(r.entries.length,272);assert.equal(q.length,278);assert.equal(r.added_ids.length,127);
 for(const e of r.entries.filter(e=>e.decision==='added')){
  const actual=q.find(q=>q.id===e.id);assert.equal(actual.pergunta,e.original.pergunta);
  assert.deepEqual(actual.alternativas.map(a=>[a.texto,a.correta]),e.original.alternativas.map(a=>[a.texto,a.correta]));
  assert.equal(actual.audio_disponivel,false);
 }
});
