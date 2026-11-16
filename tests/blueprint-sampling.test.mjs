import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {certifications,loadQuestionBank} from '../certification.js';
import {blueprintQuotas,getQuestionDomain,selectBlueprintQuestions} from '../sampling.js';
import {domainManifest} from '../question-domains.js';
import {createAttempt} from '../quiz.js';
import {createPractice,createStudy} from '../study.js';
import {renderQuestionContext} from '../question-content.js';
const fetcher=async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))});
const expected={'cis-df':[12,14,26,15,8],'cis-em':[2,3,8,9,5,3],'cis-cad':[12,12,12,12,6,6],'cis-csm':[16,23,10,5,6]};
const banks=Object.fromEntries(await Promise.all(certifications.map(async c=>[c.id,await loadQuestionBank(c.id,fetcher)])));
function counts(record,bank,c){const byId=new Map(bank.map(q=>[q.id,q]));return c.blueprint.domains.map((_,domain)=>record.state.ids.filter(id=>getQuestionDomain(byId.get(id),c.id)===domain).length);}

test('official weights apportion to the requested exact totals and deterministic fractional ties',()=>{
 for(const c of certifications){const quotas=blueprintQuotas(c.id);assert.deepEqual(quotas.map(q=>q.count),expected[c.id]);assert.equal(quotas.reduce((s,q)=>s+q.count,0),c.examSize);for(const q of quotas)assert.ok(Math.abs(q.count-c.examSize*q.weight/100)<1);}
 assert.throws(()=>blueprintQuotas('cis-df',0));
});
test('all860 questions have a current unique predominant domain, visible labels and sufficient coverage',()=>{
 let total=0;
 for(const c of certifications){const bank=banks[c.id];total+=bank.length;assert.equal(Object.keys(domainManifest.courses[c.id]).length,bank.length);for(const q of bank){assert.equal(q.blueprintDomain,getQuestionDomain(q,c.id));assert.ok(q.blueprintDomain>=0&&q.blueprintDomain<c.blueprint.domains.length);assert.ok(renderQuestionContext(q).includes(c.blueprint.domains[q.blueprintDomain][0]));assert.ok(domainManifest.courses[c.id][q.id].reason);}
 for(const quota of blueprintQuotas(c.id))assert.ok(bank.filter(q=>q.blueprintDomain===quota.domain).length>=quota.count);
 }assert.equal(total,860);
});
test('the readable classification audit and shipped offline manifest agree',async()=>{
 const readable=JSON.parse(await readFile(new URL('../data/question-domains.json',import.meta.url),'utf8'));
 assert.deepEqual(readable,domainManifest);
});
test('both modes follow every domain quota across repeated shuffled unique samples without mutating banks',()=>{
 for(const c of certifications){const bank=banks[c.id],before=JSON.stringify(bank),orders=new Set();for(let i=0;i<80;i++)for(const create of [createAttempt,createPractice]){const record=create(bank,'student',c.id);assert.equal(record.total,c.examSize);assert.equal(new Set(record.state.ids).size,c.examSize);assert.deepEqual(counts(record,bank,c),expected[c.id]);assert.deepEqual(record.state.blueprint.domains.map(d=>d.count),expected[c.id]);orders.add(record.state.ids.join(','));for(const q of bank.filter(q=>record.state.ids.includes(q.id)))assert.deepEqual([...record.state.orders[q.id]].sort((a,b)=>a-b),q.alternativas.map((_,i)=>i));}assert.ok(orders.size>140);assert.equal(JSON.stringify(bank),before);assert.equal(createStudy(bank,'student').total,bank.length);}
});
test('classification drift and domain shortages fail rather than silently replacing categories or repeating questions',async()=>{
 const bank=banks['cis-em'];const changed=bank.map((q,i)=>i? q:{...q,pergunta:q.pergunta+' changed'});
 assert.throws(()=>selectBlueprintQuestions(changed,30,'cis-em'),/classifica/);
 const short=bank.filter(q=>q.blueprintDomain!==0);assert.throws(()=>selectBlueprintQuestions(short,30,'cis-em'),/insuficiente/);
 assert.throws(()=>selectBlueprintQuestions([...bank,bank[0]],30,'cis-em'),/repetidos/);
 const source=JSON.parse(await readFile(new URL('../data/cis-em/questions.json',import.meta.url),'utf8'));source[0].pergunta+=' changed';await assert.rejects(loadQuestionBank('cis-em',async()=>({ok:true,json:async()=>source})),/classifica/);
});
test('representative contextual overlaps use the learning objective, not incidental distractor terms',()=>{
 for(const [cert,id,domain] of [['cis-df','1-4',3],['cis-df','1-36',2],['cis-em','em-ZolsrXIfajYfJp940WFr',2],['cis-cad','cad-QST0001126',4],['cis-csm','csm-XDZbkZYxMvGl54HDS4AE',4]])assert.equal(banks[cert].find(q=>q.id===id).blueprintDomain,domain);
});
