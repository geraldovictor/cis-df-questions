import { getCertification, certificationStorageKey, getRecordCertification } from './certification.js';
import { isCorrect } from './quiz.js';
import { isPracticeStudy } from './study.js';
import { domainSourceKey } from './question-domains.js';
import { getMatchingQuestion, getMatchingAssignments } from './matching.js';
import { questionPlainText } from './question-content.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names = {quiz:'Simulado',practice:'Correção imediata',study:'Estudo completo',flashcards:'Flashcards',audio:'Áudio'};
const date = value => new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});

function rowFor(question, id, status, selection = []) {
  return {id,domain:Number.isInteger(question?.blueprintDomain)?question.blueprintDomain:-1,status,
    selection:[...selection],signature:question?domainSourceKey(question):null};
}

export function buildAttemptReport(attempt, byId) {
  if (!attempt.finished_at) throw new Error('Finalize a tentativa antes de gerar o relatório.');
  const study = attempt.state.mode === 'study';
  const mode = study ? isPracticeStudy(attempt)?'practice':'study' : 'quiz';
  const rows = attempt.state.ids.map(id=>{
    const q=byId[id], selection=attempt.state.answers[id]||[];
    const answered=study ? Boolean(attempt.state.confirmed?.[id]) : selection.length>0;
    return rowFor(q,id,!answered?'unanswered':q&&isCorrect(q,selection)?'correct':'wrong',answered?selection:[]);
  });
  return finishReport({id:attempt.id,user_id:attempt.user_id,certification:getRecordCertification(attempt),mode,
    started_at:attempt.started_at,finished_at:attempt.finished_at,rows});
}

export function createReviewSession(mode, questions, userId, certification) {
  if (!['flashcards','audio'].includes(mode)) throw new Error('Modo de relatório inválido.');
  return {id:crypto.randomUUID(),mode,user_id:userId,certification,started_at:new Date().toISOString(),
    ids:questions.map(q=>q.id),outcomes:{},started_ids:[]};
}

export function buildReviewReport(session, byId) {
  if (!session.finished_at) throw new Error('Encerre a sessão antes de gerar o relatório.');
  if (!['flashcards','audio'].includes(session.mode)) throw new Error('Modo de relatório inválido.');
  const allowed=session.mode==='audio'?['listened']:['known','review'];
  const rows=session.ids.map(id=>rowFor(byId[id],id,allowed.includes(session.outcomes[id])?session.outcomes[id]:'unanswered'));
  return finishReport({...session,rows});
}

function finishReport(input) {
  const certification=getCertification(input.certification);
  const report={version:1,id:input.id,user_id:input.user_id,certification:input.certification,mode:input.mode,
    started_at:input.started_at,finished_at:input.finished_at,domains:certification.blueprint.domains.map(([name])=>name),
    rows:input.rows.map(row=>({...row,domain:row.domain>=0&&row.domain<certification.blueprint.domains.length?row.domain:-1}))};
  report.summary=summarizeReport(report);
  return report;
}

export function summarizeReport(report) {
  const count=rows=>({total:rows.length,correct:rows.filter(r=>r.status==='correct').length,
    wrong:rows.filter(r=>r.status==='wrong').length,unanswered:rows.filter(r=>r.status==='unanswered').length,
    known:rows.filter(r=>r.status==='known').length,review:rows.filter(r=>r.status==='review').length,
    listened:rows.filter(r=>r.status==='listened').length});
  const total=count(report.rows);
  return {...total,answered:total.correct+total.wrong,
    accuracy:total.correct+total.wrong?Math.round(total.correct/(total.correct+total.wrong)*100):null,
    domains:[...report.domains.map((name,domain)=>({domain,name,...count(report.rows.filter(r=>r.domain===domain))})),
      ...(report.rows.some(r=>r.domain===-1)?[{domain:-1,name:'Sem classificação',...count(report.rows.filter(r=>r.domain===-1))}]:[])]};
}

function historyKey(userId,certification) { return certificationStorageKey('reports-v1',certification,userId); }
export function readReportHistory(userId,certification,storage=localStorage) {
  const reports=JSON.parse(storage.getItem(historyKey(userId,certification))||'[]');
  if(!Array.isArray(reports)) throw new Error('Não foi possível ler o histórico de relatórios.');
  return reports.filter(r=>r?.version===1&&r.user_id===userId&&r.certification===certification&&Object.hasOwn(names,r.mode)&&Array.isArray(r.rows)&&Array.isArray(r.domains));
}
export function saveReport(report,storage=localStorage) {
  const reports=readReportHistory(report.user_id,report.certification,storage);
  const existing=reports.findIndex(r=>r.id===report.id&&r.mode===report.mode);
  if(existing<0) reports.unshift(report); else reports[existing]=report;
  storage.setItem(historyKey(report.user_id,report.certification),JSON.stringify(reports));
}

function sessionKey(mode,userId,certification) {return certificationStorageKey(mode+'-report-session',certification,userId);}
export function readReviewSession(mode,userId,certification,storage=localStorage) {
  const session=JSON.parse(storage.getItem(sessionKey(mode,userId,certification))||'null');
  return session?.mode===mode&&session.user_id===userId&&session.certification===certification&&Array.isArray(session.ids)&&session.outcomes&&!session.finished_at?session:null;
}
export function saveReviewSession(session,storage=localStorage) {
  const previous=storage.getItem(sessionKey(session.mode,session.user_id,session.certification));
  if(previous)JSON.parse(previous);
  storage.setItem(sessionKey(session.mode,session.user_id,session.certification),JSON.stringify(session));
}

function overview(report) {
  const s=summarizeReport(report), graded=['quiz','practice','study'].includes(report.mode);
  const headers=graded?['Confirmadas','Acertos','Erros','Não respondidas']:report.mode==='flashcards'?['Avaliados','Já sei','Para revisar','Sem marcação']:['Na seleção','Reproduções concluídas','Não concluídos'];
  const values=graded?[s.answered,s.correct,s.wrong,s.unanswered]:report.mode==='flashcards'?[s.known+s.review,s.known,s.review,s.unanswered]:[s.total,s.listened,s.total-s.listened];
  const columns=graded?['Acertos','Erros','Não respondidas','Acerto nas respondidas']:report.mode==='flashcards'?['Já sei','Para revisar','Sem marcação']:['Concluídos','Não concluídos'];
  const cells=d=>graded?[d.correct,d.wrong,d.unanswered,d.correct+d.wrong?Math.round(d.correct/(d.correct+d.wrong)*100)+'%':'—']:report.mode==='flashcards'?[d.known,d.review,d.unanswered]:[d.listened,d.total-d.listened];
  let priorities=s.domains.filter(d=>graded?d.wrong>0:report.mode==='flashcards'?d.review>0:d.total>d.listened);
  priorities.sort((a,b)=>graded?(b.wrong-a.wrong)||((a.correct/(a.correct+a.wrong))-(b.correct/(b.correct+b.wrong))):report.mode==='flashcards'?b.review-a.review:(a.listened/a.total)-(b.listened/b.total));
  const recommendation=priorities.length?`<p>${report.mode==='audio'?'Próximos domínios para ouvir':'Priorize a revisão de'}: <b>${priorities.slice(0,3).map(d=>esc(d.name)).join('; ')}</b>.</p>`:graded&&s.unanswered?'<p>Não houve erros nas respostas registradas. Complete os itens não respondidos para ampliar sua revisão.</p>':report.mode==='flashcards'&&s.unanswered?'<p>Nenhum cartão foi marcado para revisão nesta tentativa. Ainda há cartões sem autoavaliação.</p>':'<p>Revisão concluída para os itens registrados nesta tentativa.</p>';
  return `<h2>Relatório da tentativa</h2><p><b>${esc(getCertification(report.certification).label)} · ${names[report.mode]}</b><br>Início: ${esc(date(report.started_at))}<br>Conclusão: ${esc(date(report.finished_at))}</p><div class="report-metrics">${headers.map((name,i)=>`<div><strong>${values[i]}</strong><span>${name}</span></div>`).join('')}</div>${graded?`<p>${s.accuracy===null?'Nenhuma resposta foi confirmada.':`<b>${s.accuracy}%</b> de acerto ${s.answered===1?'na':'nas'} ${s.answered} ${s.answered===1?'resposta registrada':'respostas registradas'}. ${s.correct} ${s.correct===1?'acerto':'acertos'} em ${s.total} questões da tentativa.`}</p>`:`<p class="muted">${report.mode==='flashcards'?'Autoavaliação: “Já sei” e “Para revisar” refletem suas marcações nesta tentativa.':'Este relatório mede a conclusão da escuta; não avalia acertos ou compreensão.'}</p>`}<h3>Desempenho por domínio</h3><p class="muted report-table-hint">Deslize a tabela para ver todas as colunas.</p><div class="report-table-wrap" tabindex="0" role="region" aria-label="Resultados por domínio"><table><thead><tr><th scope="col">Domínio</th><th scope="col">Itens</th>${columns.map(c=>`<th scope="col">${c}</th>`).join('')}</tr></thead><tbody>${s.domains.filter(d=>d.total).map(d=>`<tr><td>${esc(d.name)}</td><td>${d.total}</td>${cells(d).map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${recommendation}`;
}

function answerTexts(q,selection) {
  const model=getMatchingQuestion(q);
  if(model){const assignments=getMatchingAssignments(q,selection);return model.targets.map(t=>{
    const item=model.items.find(item=>item.id===assignments[t.id]);return item?`${item.text} → ${t.text}`:null;
  }).filter(Boolean);}
  return selection.map(i=>q.alternativas[i]?.texto).filter(Boolean);
}

function questionDetails(report,byId) {
  const labels={correct:'Acertou',wrong:'Errou',unanswered:report.mode==='flashcards'?'Sem marcação':report.mode==='audio'?'Não concluído':'Não respondida',known:'Já sei',review:'Para revisar',listened:'Reprodução concluída'};
  return report.rows.map((row,i)=>{
    const q=byId[row.id];
    if(!q)return `<p>${i+1}. ${esc(row.id)} · ${labels[row.status]} · Questão indisponível no banco atual.</p>`;
    const model=getMatchingQuestion(q);
    const correct=model?model.targets.map(t=>`${model.items.find(item=>item.id===model.solution[t.id])?.text} → ${t.text}`):q.alternativas.filter(a=>a.correta).map(a=>a.texto);
    const selected=['quiz','practice','study'].includes(report.mode)&&row.selection.length?answerTexts(q,row.selection):[];
    const explanations=[...new Set(q.alternativas.filter(a=>a.correta&&a.explicacao?.trim()).map(a=>a.explicacao))];
    return `<details class="report-question"><summary>${i+1}. ${labels[row.status]} · ${esc(q.pergunta)}</summary><p>Domínio: ${esc(report.domains[row.domain]||'Sem classificação')}</p>${row.signature!==domainSourceKey(q)?'<p class="notice">O material desta questão foi atualizado desde a tentativa. O resultado registrado foi preservado; os textos abaixo são do banco atual.</p>':''}${q.observacao?`<p class="notice">${esc(q.observacao)}</p>`:''}${q.contexto?`<div class="report-context"><b>Contexto do enunciado:</b><p>${esc(questionPlainText(q))}</p></div>`:''}${selected.length?`<p><b>Sua resposta:</b></p><ul>${selected.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>`:''}<p><b>Gabarito do banco:</b></p><ul>${correct.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>${explanations.length?`<div class="report-context"><b>Explicação do material:</b>${explanations.map(t=>`<p>${esc(t)}</p>`).join('')}</div>`:''}</details>`;
  }).join('');
}

export function reportDocument(report,byId) {
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Relatório ${esc(getCertification(report.certification).label)} · ${names[report.mode]}</title><style>body{font:16px/1.6 system-ui;color:#153e36;max-width:1000px;margin:30px auto;padding:20px}table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid #ccc;text-align:left}.report-metrics{display:flex;flex-wrap:wrap;gap:24px}.report-metrics strong{display:block;font-size:26px}.report-question{margin:16px 0;overflow-wrap:anywhere}.report-question summary{cursor:pointer}.report-context p,li{white-space:pre-wrap;overflow-wrap:anywhere}@media print{summary{font-weight:bold}details{display:block}details>*{display:block!important}}</style><body>${overview(report)}<h3>Detalhes das questões</h3>${questionDetails(report,byId).replaceAll('<details class="report-question">','<details class="report-question" open>')}</body></html>`;
}

export function mountReport(container,report,byId,{persist=true}={}) {
  let warning='';
  if(persist)try{saveReport(report);}catch{warning='Não foi possível salvar o histórico neste navegador. Baixe o relatório para guardar uma cópia.';}
  container.innerHTML=`<section class="card attempt-report" data-attempt-report>${overview(report)}<div class="report-actions"><button type="button" class="secondary" data-report-download>Baixar relatório</button><button type="button" class="quiet" data-report-print>Imprimir / Salvar PDF</button></div><p class="muted" data-report-status role="status">${warning}</p><details data-report-questions><summary>Ver detalhes das ${report.rows.length} questões</summary><div data-report-question-list></div></details></section>`;
  container.querySelector('[data-report-questions]').addEventListener('toggle',event=>{
    const list=container.querySelector('[data-report-question-list]');
    if(event.currentTarget.open&&!list.childElementCount)list.innerHTML=questionDetails(report,byId);
  });
  container.querySelector('[data-report-download]').onclick=()=>{
    const url=URL.createObjectURL(new Blob([reportDocument(report,byId)],{type:'text/html;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download=`relatorio-${report.certification}-${report.mode}-${report.id}.html`;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  };
  container.querySelector('[data-report-print]').onclick=()=>{
    const win=window.open('','_blank');
    if(!win){container.querySelector('[data-report-status]').textContent='Permita a janela de impressão ou use Baixar relatório.';return;}
    win.opener=null;win.document.open();win.onload=()=>win.print();win.document.write(reportDocument(report,byId));win.document.close();
  };
}

export function mountReviewHistory(container,mode,userId,certification,byId,latest=null) {
  let reports=[],warning='';
  try{if(latest)saveReport(latest);reports=readReportHistory(userId,certification).filter(r=>r.mode===mode);}catch{warning='O histórico não pôde ser salvo. Baixe o relatório atual.';}
  const selected=latest||reports[0];
  container.innerHTML=`<p class="muted">Relatórios deste modo ficam neste navegador, separados por conta.</p>${warning?`<p class="notice">${warning}</p>`:''}<div data-review-report></div>${reports.length?`<details><summary>Histórico de relatórios (${reports.length})</summary><div class="report-history">${reports.map(r=>`<button type="button" class="quiet" data-open-report="${esc(r.id)}">${esc(date(r.finished_at))} · ${names[r.mode]}</button>`).join('')}</div></details>`:''}`;
  const panel=container.querySelector('[data-review-report]');
  if(selected)mountReport(panel,selected,byId,{persist:false});
  container.querySelectorAll('[data-open-report]').forEach(button=>button.onclick=()=>mountReport(panel,reports.find(r=>r.id===button.dataset.openReport),byId,{persist:false}));
}
