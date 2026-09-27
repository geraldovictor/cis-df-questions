import { confirmStudyAnswer, studyProgress } from './study.js';
import { isCorrect } from './quiz.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function renderStudy({ app, attempt, byId, save, back, report }) {
  const state = attempt.state, id = state.ids[state.cursor], q = byId[id];
  const confirmed = Boolean(state.confirmed[id]), result = studyProgress(attempt, byId);
  const count = q.alternativas.filter(a => a.correta).length;
  const selected = state.answers[id] || [];
  const redraw = () => renderStudy({app, attempt, byId, save, back, report});
  const bind = (selector, event, action) => app.querySelector(selector)?.addEventListener(event, action);
  const metrics = `<div class="study-metrics" aria-live="polite"><span><b>${result.correct}</b> acertos</span><span><b>${result.wrong}</b> erros</span><span><b>${result.accuracy}%</b> de acerto nas respondidas</span></div>`;
  const options = (question, qid, reveal) => state.orders[qid].map((index, position) => {
    const a = question.alternativas[index], checked = (!attempt.finished_at || state.confirmed[qid]) && (state.answers[qid] || []).includes(index);
    return `<label class="option ${reveal ? a.correta ? 'correct' : checked ? 'wrong' : '' : ''}">${attempt.finished_at ? '' : `<input type="${question.alternativas.filter(a=>a.correta).length>1?'checkbox':'radio'}" name="study-answer" value="${index}" ${checked?'checked':''} ${reveal?'disabled':''}>`}<span><span lang="en"><b>${String.fromCharCode(65+position)}.</b> ${esc(a.texto)}</span>${reveal?`<span class="explanation"><b>${a.correta?'✓ Correta':''}${checked?' · Sua resposta':''}</b><span lang="en"> ${esc(a.explicacao)}</span></span>`:''}</span></label>`;
  }).join('');
  if (attempt.finished_at) {
    app.innerHTML = `<button id="study-back" class="quiet">← Voltar à minha trajetória</button><section class="card result-banner"><span class="eyebrow">Modo de estudo</span><h1>Estudo concluído.</h1><strong>${result.accuracy}%</strong><p>de acerto nas ${result.answered} questões respondidas</p>${metrics}<p>${result.remaining} não respondidas · ${attempt.total} questões no total<br>${result.correct} acertos de ${attempt.total} (${Math.round(result.correct/attempt.total*100)}% do banco)</p></section><div class="section-head"><h2>Revisão do estudo</h2><label><input id="study-errors" type="checkbox"> Somente erros</label></div><div id="study-reviews"></div>`;
    const reviews = () => {
      app.querySelector('#study-reviews').innerHTML = state.ids.map((qid, i) => {
        const question = byId[qid], answered = state.confirmed[qid];
        const correct = answered && isCorrect(question, state.answers[qid]);
        if (app.querySelector('#study-errors').checked && (!answered || correct)) return '';
        return `<details class="card review-item"><summary>${answered ? correct ? '✓ Acertou' : '✕ Errou' : 'Não respondida'} · Questão ${i+1}<br><span lang="en">${esc(question.pergunta)}</span></summary><div class="options">${options(question,qid,true)}</div></details>`;
      }).join('') || '<p class="card">Nenhum erro nas respostas confirmadas.</p>';
    };
    reviews(); bind('#study-errors','change',reviews); bind('#study-back','click',back); return;
  }
  app.innerHTML = `<div class="quiz-heading"><button id="study-back" class="quiet">← Salvar e voltar</button><span class="tag">Modo de estudo · ${attempt.total} questões</span></div>${metrics}<div class="progress" role="progressbar" aria-label="Questões confirmadas" aria-valuenow="${result.answered}" aria-valuemin="0" aria-valuemax="${attempt.total}"><span style="width:${result.answered/attempt.total*100}%"></span></div><p class="muted">${result.answered} de ${attempt.total} confirmadas · ${result.remaining} restantes</p><div class="quiz-layout"><section class="card"><span class="eyebrow">Questão ${state.cursor+1} de ${attempt.total}</span><h1 class="question-title" lang="en">${esc(q.pergunta)}</h1><p class="muted">Selecione ${count===1?'uma alternativa':`${count} alternativas`} e confirme para ver a correção.</p><div class="options">${options(q,id,confirmed)}</div>${confirmed?`<div class="study-feedback ${isCorrect(q,selected)?'correct':'wrong'}" role="status"><b>${isCorrect(q,selected)?'✓ Você acertou!':'✕ Você errou.'}</b> Confira as explicações acima. Sua resposta foi registrada.</div>`:'<button id="study-check" class="primary">Confirmar resposta</button>'}<div class="quiz-actions"><button id="study-prev" class="secondary" ${state.cursor===0?'disabled':''}>← Anterior</button><button id="study-next" class="secondary">${state.cursor===attempt.total-1?'Revisar e finalizar':'Próxima →'}</button></div></section><aside class="card"><h3>Seu estudo</h3><p class="legend">Verde: acerto · vermelho: erro.<br>As respostas confirmadas não podem ser alteradas. Você pode pausar e continuar depois.</p><div class="number-grid study-grid">${state.ids.map((qid,i)=>`<button data-study-jump="${i}" aria-label="Questão ${i+1}${state.confirmed[qid]?isCorrect(byId[qid],state.answers[qid])?', correta':', incorreta':''}" ${state.cursor===i?'aria-current="step"':''} class="${state.confirmed[qid]?isCorrect(byId[qid],state.answers[qid])?'answered':'missed':''} ${state.cursor===i?'active':''}">${i+1}</button>`).join('')}</div><button id="study-finish" class="secondary wide">Finalizar estudo</button></aside></div>`;
  app.querySelectorAll('[name=study-answer]').forEach(input => input.addEventListener('change', () => {
    if (confirmed) return;
    state.answers[id] = [...app.querySelectorAll('[name=study-answer]:checked')].map(el=>Number(el.value));
    save().catch(()=>{});
  }));
  bind('#study-check','click',()=>{
    try {confirmStudyAnswer(attempt,q,state.answers[id] || []); save().catch(()=>{}); redraw();}
    catch(error) {report(error);}
  });
  const go = index => {state.cursor=index;save().catch(()=>{});redraw();window.scrollTo({top:0});};
  bind('#study-prev','click',()=>go(state.cursor-1));
  app.querySelectorAll('[data-study-jump]').forEach(el=>el.addEventListener('click',()=>go(Number(el.dataset.studyJump))));
  bind('#study-back','click',async()=>{try{await save();back();}catch(error){report(error);}});
  const finish = () => {
    app.innerHTML=`<section class="card result-banner"><h1>Finalizar este estudo?</h1><p>${result.answered} respostas confirmadas, ${result.correct} acertos e ${result.wrong} erros.<br>${result.remaining} questões não confirmadas ficarão como não respondidas. O aproveitamento será calculado sobre as respostas confirmadas.</p><div class="quiz-actions"><button id="study-resume" class="secondary">Continuar estudando</button><button id="study-confirm-finish" class="primary">Salvar resultado</button></div></section>`;
    bind('#study-resume','click',redraw);
    bind('#study-confirm-finish','click',async event=>{
      const button=event.currentTarget;button.disabled=true;
      attempt.finished_at=new Date().toISOString();attempt.score=result.correct;
      try {await save();redraw();} catch(error) {attempt.finished_at=null;attempt.score=null;button.disabled=false;report(error);}
    });
  };
  bind('#study-next','click',()=>state.cursor===attempt.total-1?finish():go(state.cursor+1));
  bind('#study-finish','click',finish);
}
