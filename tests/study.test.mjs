import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudy,confirmStudyAnswer,studyProgress} from '../study.js';
import {createAttempt} from '../quiz.js';
const questions=Array.from({length:205},(_,i)=>({id:String(i),alternativas:[{correta:true},{correta:false},{correta:true}]}));
const byId=Object.fromEntries(questions.map(q=>[q.id,q]));
test('study includes the complete question bank once and preserves shuffled options',()=>{
  for(const size of [1,205,215]){
    const bank=Array.from({length:size},(_,i)=>({...questions[0],id:String(i)}));
    const a=createStudy(bank,'user');
    assert.equal(a.total,size);assert.equal(new Set(a.state.ids).size,size);
    assert.deepEqual([...a.state.ids].sort(),bank.map(q=>q.id).sort());
    for(const id of a.state.ids)assert.deepEqual([...a.state.orders[id]].sort(),[0,1,2]);
  }
});
test('drafts are not graded; confirmation is exact and cannot be changed or counted twice',()=>{
  const a=createStudy(questions,'user'),q=byId[a.state.ids[0]];
  a.state.answers[q.id]=[0,2];assert.equal(studyProgress(a,byId).answered,0);
  assert.throws(()=>confirmStudyAnswer(a,q,[0]));
  assert.throws(()=>confirmStudyAnswer(a,q,[0,0]));
  assert.throws(()=>confirmStudyAnswer(a,q,[0,99]));
  assert.ok(confirmStudyAnswer(a,q,[2,0]));
  assert.equal(confirmStudyAnswer(a,q,[0,1]),false);
  assert.deepEqual(a.state.answers[q.id],[2,0]);
  assert.deepEqual(studyProgress(a,byId),{answered:1,correct:1,wrong:0,remaining:204,accuracy:100});
  assert.ok(confirmStudyAnswer(a,byId[a.state.ids[1]],[0,1]));
  assert.deepEqual(studyProgress(a,byId),{answered:2,correct:1,wrong:1,remaining:203,accuracy:50});
});
test('study resumes with order, confirmations, drafts and score intact',()=>{
  const a=createStudy(questions,'user');confirmStudyAnswer(a,byId[a.state.ids[0]],[0,2]);
  a.state.cursor=4;a.state.answers[a.state.ids[4]]=[0];
  const resumed=JSON.parse(JSON.stringify(a));
  assert.deepEqual(resumed,a);assert.equal(studyProgress(resumed,byId).answered,1);
  resumed.finished_at=new Date().toISOString();
  assert.equal(confirmStudyAnswer(resumed,byId[resumed.state.ids[1]],[0,2]),false);
});
test('study does not alter the 75-question simulation format',()=>{
  const simulation=createAttempt(questions,'user');createStudy(questions,'user');
  assert.equal(simulation.total,75);assert.equal(simulation.state.ids.length,75);
  assert.equal(simulation.state.mode,undefined);assert.equal(simulation.state.confirmed,undefined);
});
