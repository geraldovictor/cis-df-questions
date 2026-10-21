import test from 'node:test';
import assert from 'node:assert/strict';
import { GUEST_ID, LOCAL_PROGRESS_KEY, readLocalProgress, saveLocalAttempt } from '../offline.js';
import { createAttempt } from '../quiz.js';
import { createStudy } from '../study.js';
import { readFile } from 'node:fs/promises';

const questions = JSON.parse(await readFile(new URL('../questoes-1-corrigida (1).json', import.meta.url))).map((q,i)=>({...q,id:`1-${i+1}`}));
function memoryStorage() {
  const data = new Map();
  return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
}
test('offline saves independent quiz and study snapshots and resumes the latest answers', () => {
  const storage = memoryStorage();
  const quiz=createAttempt(questions,GUEST_ID), study=createStudy(questions,GUEST_ID);
  saveLocalAttempt(quiz,storage); saveLocalAttempt(study,storage);
  quiz.state.answers[quiz.state.ids[0]]=[1]; quiz.state.cursor=3;
  assert.equal(readLocalProgress(storage).attempts[0].state.cursor,0);
  saveLocalAttempt(quiz,storage);
  const restored=readLocalProgress(storage);
  assert.equal(restored.attempts.length,1); assert.equal(restored.studies.length,1);
  assert.deepEqual(restored.attempts[0],quiz); assert.deepEqual(restored.studies[0],study);
  quiz.finished_at=new Date().toISOString(); quiz.score=10; saveLocalAttempt(quiz,storage);
  assert.equal(readLocalProgress(storage).attempts[0].score,10);
});
test('offline refuses account results and preserves unreadable data rather than overwriting it', () => {
  const storage=memoryStorage();
  assert.throws(()=>saveLocalAttempt(createAttempt(questions,'account-user'),storage));
  assert.deepEqual(readLocalProgress(storage),{attempts:[],studies:[]});
  storage.setItem(LOCAL_PROGRESS_KEY,'broken');
  assert.throws(()=>saveLocalAttempt(createAttempt(questions,GUEST_ID),storage));
  assert.equal(storage.getItem(LOCAL_PROGRESS_KEY),'broken');
  storage.setItem(LOCAL_PROGRESS_KEY,'{"attempts":{}}');
  assert.throws(()=>readLocalProgress(storage));
});
test('offline storage errors are surfaced instead of reporting a successful save', () => {
  const storage={getItem:()=>null,setItem:()=>{throw new Error('QuotaExceededError');}};
  assert.throws(()=>saveLocalAttempt(createStudy(questions,GUEST_ID),storage),/Quota/);
});
