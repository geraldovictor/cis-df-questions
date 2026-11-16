import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildAttemptReport,createReviewSession,buildReviewReport,summarizeReport,saveReport,readReportHistory,saveReviewSession,readReviewSession,reportDocument} from '../reports.js';
import {loadQuestionBank} from '../certification.js';
import {getMatchingQuestion} from '../matching.js';
const question=(id,domain=0)=>({id,certification:'cis-em',blueprintDomain:domain,pergunta:`Question ${id}`,alternativas:[{texto:'Yes',correta:true},{texto:'No',correta:false}]});
const bank=[question('a'),question('b',1),question('c',1)],byId=Object.fromEntries(bank.map(q=>[q.id,q]));
function attempt(mode='quiz') {return {id:'attempt',user_id:'owner',started_at:'2026-11-16T13:00:00Z',finished_at:'2026-11-16T13:05:00Z',total:3,score:1,state:{certification:'cis-em',...(mode==='quiz'?{}:{mode:'study',...(mode==='practice'?{variant:'practice'}:{})}),ids:['a','b','c'],answers:{a:[0],b:[1],c:[0]},confirmed:{a:true,b:true}}};}
function storage(){const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};}

test('quiz reports distinguish wrong answers and unanswered items and group actual attempted domains',()=>{
 const a=attempt();delete a.state.answers.c;const r=buildAttemptReport(a,byId),s=r.summary;
 assert.equal(r.mode,'quiz');assert.deepEqual([s.total,s.answered,s.correct,s.wrong,s.unanswered,s.accuracy],[3,2,1,1,1,50]);
 assert.deepEqual(s.domains.slice(0,2).map(d=>[d.total,d.correct,d.wrong,d.unanswered]),[[1,1,0,0],[2,0,1,1]]);
 assert.throws(()=>buildAttemptReport({...a,finished_at:null},byId),/Finalize/);
});
test('study and practice reports count confirmations only and never grade drafts',()=>{
 for(const mode of ['study','practice']){const r=buildAttemptReport(attempt(mode),byId);assert.equal(r.mode,mode);assert.equal(r.summary.correct,1);assert.equal(r.summary.wrong,1);assert.equal(r.summary.unanswered,1);assert.deepEqual(r.rows[2].selection,[]);}
 const none=attempt('study');none.state.confirmed={};const r=buildAttemptReport(none,byId);assert.equal(r.summary.accuracy,null);assert.equal(r.summary.wrong,0);
});
test('reports count exact multi-answer sets and complete matching answers including legacy selections',async()=>{
 const q={...question('multi'),alternativas:[{texto:'A',correta:true},{texto:'B',correta:false},{texto:'C',correta:true}]};
 const a=attempt();a.state.ids=['multi'];a.state.answers={multi:[0]};assert.equal(buildAttemptReport(a,{multi:q}).summary.wrong,1);
 a.state.answers.multi=[2,0];assert.equal(buildAttemptReport(a,{multi:q}).summary.correct,1);
 const qs=await loadQuestionBank('cis-em',async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))}));
 const match=qs.find(q=>q.tipo==='matching'),model=getMatchingQuestion(match);a.state.ids=[match.id];
 for(const selected of [Object.entries(model.solution).map(([target,item])=>`match:${target}:${item}`),[0]]){
  a.state.answers={[match.id]:selected};const r=buildAttemptReport(a,{[match.id]:match});assert.equal(r.summary.correct,1);assert.match(reportDocument(r,{[match.id]:match}),/Processing step/);
 }
});
test('flashcard reports use only this session ratings, unique cards and honest self-assessment',()=>{
 const s=createReviewSession('flashcards',bank,'owner','cis-em');s.outcomes.a='known';s.outcomes.a='review';s.outcomes.b='known';s.finished_at=new Date().toISOString();const r=buildReviewReport(s,byId);
 assert.deepEqual([r.summary.known,r.summary.review,r.summary.unanswered],[1,1,1]);assert.equal(r.summary.correct,0);assert.match(reportDocument(r,byId),/Autoavaliação/);
 assert.throws(()=>createReviewSession('memorization',bank,'owner','cis-em'),/inválido/);
});
test('audio reports count completed unique recordings without inventing grades or equating starts with completion',()=>{
 const s=createReviewSession('audio',bank,'owner','cis-em');s.started_ids=['a','b'];s.outcomes.a='listened';s.outcomes.a='listened';s.finished_at=new Date().toISOString();const r=buildReviewReport(s,byId);
 assert.deepEqual([r.summary.listened,r.summary.unanswered,r.summary.correct,r.summary.wrong],[1,2,0,0]);assert.equal(r.summary.accuracy,null);assert.match(reportDocument(r,byId),/não avalia acertos/);
});
test('reports preserve result snapshots, expose later source changes and escape exported material',()=>{
 const r=buildAttemptReport(attempt(),byId),before=JSON.stringify(r);const updated={...byId,a:{...byId.a,pergunta:'<script>alert(1)</script>'}};
 const html=reportDocument(r,updated);assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));assert.match(html,/atualizado desde/);assert.equal(JSON.stringify(r),before);assert.equal(summarizeReport(r).correct,r.summary.correct);
});
test('standalone reports retain textual scenario context, supplied explanations and source caveats',()=>{
 const a=attempt(),questions={...byId,a:{...byId.a,contexto:{paragrafos:['Scenario <value> and threshold 9.5']},observacao:'Source caveat',alternativas:[{texto:'Yes',correta:true,explicacao:'Explanation <value>'},{texto:'No',correta:false}]}};
 const html=reportDocument(buildAttemptReport(a,questions),questions);
 assert.match(html,/Scenario &lt;value&gt; and threshold 9.5/);assert.match(html,/Explanation &lt;value&gt;/);assert.match(html,/Source caveat/);
});
test('history deduplicates each attempt, keeps all modes and isolates accounts and certifications',()=>{
 const store=storage(),r=buildAttemptReport(attempt(),byId);saveReport(r,store);saveReport(r,store);assert.equal(readReportHistory('owner','cis-em',store).length,1);
 saveReport({...r,mode:'study'},store);assert.equal(readReportHistory('owner','cis-em',store).length,2);
 assert.deepEqual(readReportHistory('other','cis-em',store),[]);assert.deepEqual(readReportHistory('owner','cis-cad',store),[]);
 const key='cis-em-reports-v1-owner';store.setItem(key,'broken');assert.throws(()=>saveReport(r,store));assert.equal(store.getItem(key),'broken');
});
test('review sessions resume independently and finished sessions start fresh while unreadable state is preserved',()=>{
 const store=storage(),s=createReviewSession('flashcards',bank,'owner','cis-em');s.outcomes.a='known';saveReviewSession(s,store);assert.deepEqual(readReviewSession('flashcards','owner','cis-em',store),s);
 assert.equal(readReviewSession('audio','owner','cis-em',store),null);assert.equal(readReviewSession('flashcards','other','cis-em',store),null);
 s.finished_at=new Date().toISOString();saveReviewSession(s,store);assert.equal(readReviewSession('flashcards','owner','cis-em',store),null);
 const key='cis-em-flashcards-report-session-owner';store.setItem(key,'broken');assert.throws(()=>saveReviewSession(s,store));assert.equal(store.getItem(key),'broken');
});
