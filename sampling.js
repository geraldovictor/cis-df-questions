import { getCertification } from './certification.js';
import { domainManifest, domainSourceKey } from './question-domains.js';

export function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Largest remainder apportionment; equal remainders use official domain order.
export function blueprintQuotas(certificationId, total = getCertification(certificationId).examSize) {
  const domains = getCertification(certificationId).blueprint.domains;
  if (!Number.isInteger(total) || total < 1 || domains.reduce((sum,[,weight])=>sum+weight,0)!==100) throw new Error('Blueprint inválido.');
  const rows = domains.map(([name,weight],domain)=>({domain,name,weight,count:Math.floor(total*weight/100),remainder:total*weight%100}));
  const remaining = total-rows.reduce((sum,row)=>sum+row.count,0);
  [...rows].sort((a,b)=>b.remainder-a.remainder||a.domain-b.domain).slice(0,remaining).forEach(row=>row.count++);
  return rows.map(({remainder,...row})=>row);
}

export function getQuestionDomain(question, certificationId) {
  const entry = domainManifest.courses[certificationId]?.[question.id];
  return entry?.signature === domainSourceKey(question) ? entry.domain : undefined;
}

export function selectBlueprintQuestions(questions, total, certificationId, random = Math.random) {
  if (!Number.isInteger(total) || total < 1 || questions.length < total) throw new Error('Quantidade de questões insuficiente para o sorteio.');
  if (new Set(questions.map(q=>q.id)).size!==questions.length) throw new Error('Identificadores de questões repetidos.');
  const mapped=questions.map(question=>({question,domain:getQuestionDomain(question,certificationId)}));
  // Standalone callers may supply their own synthetic, unclassified question bank.
  // All production banks must pass strict classification validation in loadQuestionBank.
  if (mapped.every(row=>row.domain===undefined)) return shuffle(questions,random).slice(0,total);
  if (mapped.some(row=>row.domain===undefined)) throw new Error('Há questões sem classificação de domínio atualizada.');
  const selected=[];
  for (const quota of blueprintQuotas(certificationId,total)) {
    const pool=mapped.filter(row=>row.domain===quota.domain).map(row=>row.question);
    if (pool.length<quota.count) throw new Error(`Banco insuficiente no domínio ${quota.name}: ${pool.length} disponíveis; ${quota.count} necessárias.`);
    selected.push(...shuffle(pool,random).slice(0,quota.count));
  }
  return shuffle(selected,random);
}

export function samplingSnapshot(questions, certificationId) {
  if (questions.some(q=>getQuestionDomain(q,certificationId)===undefined)) return {};
  return { blueprint: { version:domainManifest.version, source:getCertification(certificationId).blueprint.url,
    domains:blueprintQuotas(certificationId,questions.length).map(({domain,name,weight,count})=>({domain,name,weight,count})) } };
}
