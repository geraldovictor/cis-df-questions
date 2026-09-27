import { createStudy, studyProgress } from './study.js';
import { renderStudy } from './study-view.js';
import { config } from './config.js';
import { createAttempt, isCorrect, scoreAttempt } from './quiz.js';

const app = document.querySelector('#app');
const logout = document.querySelector('#logout');
const files = ['questoes-1-corrigida (1).json', 'questoes-2-corrigida-v2 (1).json', 'questoes-3-corrigida-v2 (1).json'];
let questions = [], byId = {}, client, user, attempts = [], active, busy = false, authMode = 'login';
let studies = [], studyError = null;
let saveQueue = Promise.resolve(), saveError = null;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = value => new Date(value).toLocaleString('pt-BR', {dateStyle:'short',timeStyle:'short'});
const pct = attempt => Math.round(attempt.score / attempt.total * 100);
function message(text) { const el = document.querySelector('#message'); el.textContent = text; el.hidden = false; }
function clearMessage() { document.querySelector('#message').hidden = true; }
function fail(error) { console.error(error); message(error.message || 'Não foi possível concluir. Tente novamente.'); }
function on(selector, event, handler) { document.querySelector(selector)?.addEventListener(event, handler); }
function cacheKey() { return `cis-df-pending-${user.id}`; }

function renderAuth() {
  active = null; logout.hidden = true;
  const configured = Boolean(client);
  app.innerHTML = `<section class="auth"><div class="auth-intro"><span class="eyebrow">Seu próximo capítulo começa aqui</span><h1>Mais prática.<br>Mais confiança.<br>Seu próximo nível.</h1><p>Prepare-se para a certificação CIS Data Foundations no seu ritmo. Resolva questões, entenda cada resposta e acompanhe sua evolução.</p><div class="auth-points"><div><strong>${questions.length}</strong>questões para explorar</div><div><strong>75</strong>por simulado</div><div><strong>100%</strong>no seu ritmo</div></div></div><div class="card"><span class="eyebrow">Bem-vindo à sua sala de estudos</span><h2>${authMode === 'signup' ? 'Crie sua conta' : 'Vamos continuar?'}</h2><p class="muted">Entre para salvar seu progresso e seus resultados.</p>${!configured ? '<div class="notice">O login está aguardando a configuração do serviço de contas pelo administrador. Assim que for conectado, você poderá criar sua conta e começar.</div>' : ''}<form id="auth-form"><label class="field">E-mail<input name="email" type="email" autocomplete="email" placeholder="voce@exemplo.com" required ${!configured?'disabled':''}></label><label class="field">Senha<input name="password" type="password" autocomplete="${authMode === 'signup' ? 'new-password' : 'current-password'}" minlength="8" placeholder="Pelo menos 8 caracteres" required ${!configured?'disabled':''}></label><button class="primary wide" ${!configured?'disabled':''}>${authMode === 'signup'?'Criar minha conta':'Entrar na minha conta'} →</button></form><p class="auth-switch">${authMode === 'signup'?'Já tem uma conta?':'Primeira vez por aqui?'} <button id="toggle-auth" class="quiet">${authMode === 'signup'?'Entrar':'Criar conta'}</button></p>${configured?'<button id="recover" class="quiet wide">Esqueci minha senha</button>':''}</div></section>`;
  on('#toggle-auth','click',()=>{authMode=authMode==='login'?'signup':'login';clearMessage();renderAuth();});
  on('#auth-form','submit',async event=>{
    event.preventDefault(); if(busy) return; busy=true; clearMessage();
    const button = event.currentTarget.querySelector('button'); button.disabled=true;
    const data = new FormData(event.currentTarget);
    try {
      const credentials = {email: data.get('email').trim(), password: data.get('password')};
      const result = authMode === 'signup' ? await client.auth.signUp({...credentials, options:{emailRedirectTo:location.origin+location.pathname}}) : await client.auth.signInWithPassword(credentials);
      if(result.error) throw result.error;
      if(!result.data.session) message('Conta criada! Confira seu e-mail para confirmar o cadastro antes de entrar.');
    } catch(error) { fail(error); } finally {busy=false;button.disabled=false;}
  });
  on('#recover','click',async()=>{
    const email=document.querySelector('[name=email]');
    if(!email.value || !email.reportValidity()) {message('Preencha seu e-mail para receber o link de recuperação.');return;}
    const {error}=await client.auth.resetPasswordForEmail(email.value.trim(),{redirectTo:location.origin+location.pathname});
    if(error) fail(error); else message('Se houver uma conta com esse e-mail, você receberá um link para redefinir a senha.');
  });
}

async function loadDashboard() {
  app.innerHTML='<p class="loading">Carregando seu progresso…</p>';
  logout.hidden=false;
  try {
    // Retry a locally preserved write before replacing it with server data.
    const pending=JSON.parse(localStorage.getItem(cacheKey()) || 'null');
    if(pending && pending.user_id===user.id) {
      const {error}=await client.from('attempts').upsert(pending);
      if(error) throw error;
      localStorage.removeItem(cacheKey());
    }
    const {data,error}=await client.from('attempts').select('*').order('started_at',{ascending:false});
    if(error) throw error;
    attempts=data; saveError=null;
    await loadStudies();
    renderDashboard();
  } catch(error) {
    app.innerHTML='<div class="card"><h2>Não conseguimos carregar seu progresso</h2><p>Verifique a conexão e se o banco de dados foi configurado. Seu progresso pendente neste navegador será preservado.</p><button id="retry" class="primary">Tentar novamente</button></div>';
    on('#retry','click',loadDashboard); fail(error);
  }
}

function renderDashboard() {
  active=null;
  const done=attempts.filter(a=>a.finished_at), ongoing=attempts.find(a=>!a.finished_at);
  const average=done.length?Math.round(done.reduce((s,a)=>s+pct(a),0)/done.length):0;
  app.innerHTML=`<div class="welcome"><div><span class="eyebrow">Seu espaço de aprendizado</span><h1>Pequenos passos. Grandes conquistas.</h1><p class="muted">Bom ter você por aqui, ${esc(user.email.split('@')[0])}. Vamos praticar?</p></div><span class="tag">● CIS-DF · Data Foundations</span></div><section class="hero"><span class="eyebrow">${ongoing?'Continue de onde parou':'Um novo desafio a cada tentativa'}</span><h2>Seu próximo simulado<br>começa aqui.</h2><p>75 questões sorteadas, alternativas embaralhadas e espaço para aprender com cada resposta.</p><button id="start" class="primary">${ongoing?'Continuar simulado':'Começar simulado'} <span aria-hidden="true">↗</span></button><div class="hero-decoration"><strong>75</strong><small>QUESTÕES / SIMULADO</small></div></section><div class="stats"><div class="stat"><span>Simulados concluídos</span><strong>${done.length.toString().padStart(2,'0')}</strong><small>Cada tentativa é um avanço</small></div><div class="stat"><span>Aproveitamento médio</span><strong>${average}%</strong><small>De todos os seus simulados</small></div><div class="stat"><span>Melhor resultado</span><strong>${done.length?Math.max(...done.map(pct)):0}%</strong><small>Seu recorde pessoal</small></div></div><div class="section-head"><h2>Sua trajetória</h2><p>${questions.length} questões disponíveis para praticar</p></div><section class="card">${done.length?done.map((a,i)=>`<div class="history-row"><span class="score">${pct(a)}%</span><div class="date">Simulado ${done.length-i}<small>${date(a.finished_at)} · ${a.score}/${a.total} acertos</small></div><button class="quiet" data-review="${esc(a.id)}">Revisar →</button></div>`).join(''):'<div class="empty"><b>Uma página em branco. Muitas possibilidades.</b>Conclua seu primeiro simulado para ver sua evolução aqui.</div>'}</section>`;
  document.querySelector('.hero').insertAdjacentHTML('afterend', '<section id="study-dashboard"></section>');
  renderStudyDashboard();
  on('#start','click',async()=>{
    if(busy) return; busy=true; clearMessage();
    try {
      active=ongoing || createAttempt(questions,user.id);
      if(!ongoing) { await persist(); attempts.unshift(active); }
      renderQuiz();
    } catch(error){fail(error);} finally{busy=false;}
  });
  document.querySelectorAll('[data-review]').forEach(el=>el.addEventListener('click',()=>renderResult(attempts.find(a=>a.id===el.dataset.review))));
}

function studyCacheKey() { return `cis-df-study-pending-${user.id}`; }

async function loadStudies() {
  studyError = null; studies = [];
  try {
    const pending = JSON.parse(localStorage.getItem(studyCacheKey()) || 'null');
    if (pending && pending.user_id === user.id) {
      const {error} = await client.from('study_sessions').upsert(pending);
      if (error) throw error;
      localStorage.removeItem(studyCacheKey());
    }
    const {data,error} = await client.from('study_sessions').select('*').order('started_at',{ascending:false});
    if (error) throw error;
    studies = data;
  } catch(error) { studyError = error; }
}

function openStudy() {
  renderStudy({app, attempt:active, byId, save:persist, back:loadDashboard, report:fail});
}

function renderStudyDashboard() {
  const container = document.querySelector('#study-dashboard');
  const ongoing = studies.find(a=>!a.finished_at), done = studies.filter(a=>a.finished_at);
  container.innerHTML = `<div class="card study-entry"><div><span class="eyebrow">Novo · Modo de estudo</span><h2>Aprenda uma questão por vez.</h2><p class="muted">Todas as ${questions.length} questões em ordem aleatória. Correção e explicações na hora, com seus acertos acompanhados ao vivo.</p></div><button id="study-start" class="primary" ${studyError?'disabled':''}>${ongoing?'Continuar estudo':'Começar estudo'} →</button></div>${studyError?`<div class="notice">${studyError.code==='PGRST205'?'O modo de estudo aguarda a criação da tabela de resultados pelo administrador. Os simulados continuam disponíveis.':'Não foi possível carregar os estudos. Verifique sua conexão e tente novamente.'} <button id="study-retry" class="quiet">Tentar carregar estudos</button></div>`:''}${done.length?`<div class="section-head"><h2>Histórico de estudos</h2><p>Separado dos resultados dos simulados</p></div><div class="card">${done.map(a=>{const p=studyProgress(a,byId);return `<div class="history-row"><span class="score">${p.accuracy}%</span><div class="date">Modo de estudo · ${p.correct}/${p.answered} acertos nas respondidas<small>${date(a.finished_at)} · ${p.answered}/${a.total} questões confirmadas</small></div><button class="quiet" data-study-review="${esc(a.id)}">Ver estudo →</button></div>`;}).join('')}</div>`:''}`;
  on('#study-retry','click',async()=>{await loadStudies();renderStudyDashboard();});
  on('#study-start','click',async()=>{
    if (busy) return; busy=true; clearMessage();
    try {
      active=ongoing || createStudy(questions,user.id);
      if(!ongoing){await persist();studies.unshift(active);}
      openStudy();
    } catch(error){fail(error);} finally{busy=false;}
  });
  container.querySelectorAll('[data-study-review]').forEach(el=>el.addEventListener('click',()=>{
    active=studies.find(a=>a.id===el.dataset.studyReview);openStudy();
  }));
}

function persist() {
  const snapshot=JSON.parse(JSON.stringify(active));
  const storageKey = snapshot.state.mode === 'study' ? studyCacheKey() : cacheKey();
  const table = snapshot.state.mode === 'study' ? 'study_sessions' : 'attempts';
  try {localStorage.setItem(storageKey,JSON.stringify(snapshot));} catch(error) {message('O navegador não permitiu salvar uma cópia local. Mantenha a conexão ativa.');}
  const pending=saveQueue.then(async()=>{
    const {error}=await client.from(table).upsert(snapshot);
    if(error) throw error;
    if(localStorage.getItem(storageKey)===JSON.stringify(snapshot)) localStorage.removeItem(storageKey);
    saveError=null;
  });
  saveQueue=pending.catch(error=>{saveError=error;message('Sem sincronização. Suas respostas estão neste navegador; tente salvar novamente antes de sair.');});
  return pending;
}

function renderQuiz() {
  const state=active.state, id=state.ids[state.cursor], q=byId[id];
  const count=q.alternativas.filter(a=>a.correta).length;
  const answered=Object.values(state.answers).filter(a=>a.length).length;
  app.innerHTML=`<div class="quiz-heading"><button id="back" class="quiet">← Salvar e voltar</button><span class="tag">Simulado de 75 questões</span></div><div class="quiz-layout"><section class="card"><span class="eyebrow">Questão ${state.cursor+1} de ${active.total}</span><div class="progress"><span style="width:${answered/active.total*100}%"></span></div><h1 class="question-title" lang="en">${esc(q.pergunta)}</h1><p class="muted">${count>1?`Selecione ${count} alternativas.`:'Selecione uma alternativa.'}</p><div class="options">${state.orders[id].map((index,position)=>`<label class="option"><input type="${count>1?'checkbox':'radio'}" name="answer" value="${index}" ${(state.answers[id]||[]).includes(index)?'checked':''}><span lang="en"><b>${String.fromCharCode(65+position)}.</b> ${esc(q.alternativas[index].texto)}</span></label>`).join('')}</div><div class="quiz-actions"><button id="prev" class="secondary" ${state.cursor===0?'disabled':''}>← Anterior</button><button id="next" class="primary">${state.cursor===74?'Revisar e finalizar':'Próxima →'}</button></div></section><aside class="card"><h3>Seu progresso</h3><p class="muted">${answered} de 75 respondidas</p><div class="number-grid">${state.ids.map((qid,i)=>`<button aria-label="Questão ${i+1}${state.answers[qid]?.length?', respondida':''}" ${state.cursor===i?'aria-current="step"':''} class="${state.answers[qid]?.length?'answered ':''}${state.cursor===i?'active':''}" data-jump="${i}">${i+1}</button>`).join('')}</div><p class="legend">Navegue livremente entre as questões. As respostas são salvas durante a prática.</p><button id="finish" class="secondary wide">Finalizar simulado</button></aside></div>`;
  document.querySelectorAll('[name=answer]').forEach(input=>input.addEventListener('change',()=>{
    state.answers[id]=Array.from(document.querySelectorAll('[name=answer]:checked'),el=>Number(el.value));
    const selectedValue=input.value;
    persist().catch(()=>{}); renderQuiz();
    document.querySelector(`[name=answer][value="${selectedValue}"]`)?.focus();
  }));
  const go=index=>{state.cursor=index;persist().catch(()=>{});renderQuiz();window.scrollTo({top:0});};
  on('#prev','click',()=>go(state.cursor-1));
  on('#next','click',()=>state.cursor===74?confirmFinish():go(state.cursor+1));
  document.querySelectorAll('[data-jump]').forEach(el=>el.addEventListener('click',()=>go(Number(el.dataset.jump))));
  on('#finish','click',confirmFinish);
  on('#back','click',async()=>{try{await persist();clearMessage();renderDashboard();}catch(error){fail(error);}});
}

function confirmFinish() {
  const answered=Object.values(active.state.answers).filter(a=>a.length).length;
  app.innerHTML=`<section class="card result-banner"><span class="eyebrow">Uma pausa para conferir</span><h1>Pronto para ver seu resultado?</h1><p>Você respondeu ${answered} de 75 questões.${answered<75?` As ${75-answered} questões em branco contarão como erro.`:''}<br>Depois de finalizar, você poderá revisar todas as respostas e explicações.</p><div class="quiz-actions"><button id="resume" class="secondary">Voltar às questões</button><button id="confirm" class="primary">Finalizar e ver resultado</button></div></section>`;
  on('#resume','click',renderQuiz);
  on('#confirm','click',async event=>{
    if(busy) return; busy=true; event.currentTarget.disabled=true;
    active.score=scoreAttempt(active,byId); active.finished_at=new Date().toISOString();
    try {await persist(); clearMessage(); renderResult(active);}catch(error){active.finished_at=null;active.score=null;fail(error); document.querySelector('#confirm').disabled=false;}finally{busy=false;}
  });
}

function renderResult(attempt) {
  app.innerHTML=`<button id="dashboard" class="quiet">← Voltar à minha trajetória</button><section class="card result-banner"><span class="eyebrow">Mais uma etapa da sua preparação</span><h1>Simulado concluído.</h1><strong>${pct(attempt)}%</strong><p>${attempt.score} acertos · ${attempt.total-attempt.score} erros ou em branco · ${attempt.total} questões<br>${date(attempt.finished_at)}</p><span class="tag">Cada revisão é uma nova oportunidade de aprender.</span></section><div class="section-head"><h2>Entenda suas respostas</h2><label class="muted"><input id="only-errors" type="checkbox"> Somente erros</label></div><div id="reviews"></div>`;
  const review=()=>{
    document.querySelector('#reviews').innerHTML=attempt.state.ids.map((id,i)=>{
      const q=byId[id], selected=attempt.state.answers[id]||[], correct=isCorrect(q,selected);
      if(document.querySelector('#only-errors').checked && correct) return '';
      return `<details class="card review-item"><summary><span>${correct?'✓ Acertou':'○ '+(selected.length?'Revisar':'Em branco')} · Questão ${i+1}</span><br><span lang="en">${esc(q.pergunta)}</span></summary><div class="options">${attempt.state.orders[id].map(index=>{const a=q.alternativas[index];return `<div class="option ${a.correta?'correct':selected.includes(index)?'wrong':''}"><span><b>${a.correta?'✓ Correta':selected.includes(index)?'✕ Sua resposta':'Alternativa'}${a.correta&&selected.includes(index)?' · Sua resposta':''}</b><br><span lang="en">${esc(a.texto)}</span><span class="explanation" lang="en">${esc(a.explicacao)}</span></span></div>`;}).join('')}</div></details>`;
    }).join('') || '<div class="card empty">Nenhum erro neste simulado. Ótimo trabalho!</div>';
  };
  review(); on('#only-errors','change',review); on('#dashboard','click',loadDashboard);
}

function renderRecovery() {
  app.innerHTML='<section class="card"><h1>Crie uma nova senha</h1><form id="new-password"><label class="field">Nova senha<input name="password" type="password" minlength="8" autocomplete="new-password" required></label><button class="primary">Salvar senha</button></form></section>';
  on('#new-password','submit',async event=>{event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;const {error}=await client.auth.updateUser({password:new FormData(event.currentTarget).get('password')});if(error){fail(error);button.disabled=false;}else{message('Senha atualizada.');loadDashboard();}});
}

logout.addEventListener('click',async()=>{
  try {
    if(active&&!active.finished_at) await persist();
    await saveQueue; if(saveError) throw saveError;
    const {error}=await client.auth.signOut(); if(error) throw error;
    user=null; attempts=[];clearMessage();renderAuth();
  } catch(error){fail(error);}
});

try {
  const sets=await Promise.all(files.map(async file=>{const response=await fetch(new URL(file,import.meta.url));if(!response.ok) throw new Error('Não foi possível carregar o banco de questões.');return response.json();}));
  questions=sets.flatMap((set,fileIndex)=>set.map((q,i)=>({...q,id:`${fileIndex+1}-${i+1}`})));
  byId=Object.fromEntries(questions.map(q=>[q.id,q]));
  if(config.supabaseUrl && config.supabaseKey) {
    const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    client=createClient(config.supabaseUrl,config.supabaseKey);
    client.auth.onAuthStateChange((event,session)=>{
      if(event==='PASSWORD_RECOVERY'){user=session.user;setTimeout(renderRecovery,0);return;}
      if(session && (!user || event==='INITIAL_SESSION')){user=session.user;setTimeout(loadDashboard,0);}
      else if(!session){user=null;setTimeout(renderAuth,0);}
    });
  } else renderAuth();
} catch(error) {app.innerHTML='<div class="card"><h1>Não foi possível abrir a sala de estudos</h1><p>Verifique sua conexão e recarregue a página.</p><button class="primary" onclick="location.reload()">Recarregar</button></div>';fail(error);}
