import { questionPlainText, questionAudioPath } from './question-content.js';
import { DEFAULT_CERTIFICATION, certificationStorageKey } from './certification.js';
import { createReviewSession, readReviewSession, saveReviewSession, buildReviewReport, mountReviewHistory } from './reports.js';

export function renderAudioStudy(root, questions, certificationId = DEFAULT_CERTIFICATION, userId = 'offline-guest') {
  const key = certificationStorageKey('audio-index', certificationId);
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const available = questions.flatMap((question, index) => question.audio_disponivel === false ? [] : [{ question, index }]);
  if (!available.length) {
    root.innerHTML = '<section class="card audio-study"><span class="eyebrow">Revisão diária em áudio</span><h2>Ouvir questões</h2><p role="status">Áudio indisponível. Nenhuma gravação está disponível neste banco.</p></section>';
    return;
  }
  const missing = questions.length - available.length;
  root.innerHTML = `<section class="card audio-study"><span class="eyebrow">Revisão diária em áudio</span><h2>Ouvir questões</h2><p>Pergunta e respostas corretas em inglês. Escolha uma questão ou ouça a sequência completa.</p>${missing ? `<p class="muted">Áudio indisponível para ${missing} ${missing === 1 ? 'questão' : 'questões'}. As ${available.length} gravações disponíveis estão na lista abaixo.</p>` : ''}<label class="field">Questão<select id="audio-question">${available.map(({ question: q, index: i })=>`<option value="${i}">${i+1}. ${escape(q.pergunta)}</option>`).join('')}</select></label><p id="audio-transcript" lang="en"></p><audio id="question-audio" controls preload="none" aria-label="Pergunta e resposta correta"></audio><div class="audio-actions"><button type="button" id="audio-prev" class="quiet">← Anterior</button><button type="button" id="audio-next" class="quiet">Próxima →</button><a id="audio-download" download>Baixar áudio</a></div><div class="audio-actions"><label><input id="audio-continuous" type="checkbox" checked> Tocar próximas automaticamente</label><label><input id="audio-repeat" type="checkbox"> Repetir questão</label><label>Velocidade <select id="audio-speed"><option value="0.75">0,75×</option><option value="1" selected>1×</option><option value="1.25">1,25×</option><option value="1.5">1,5×</option></select></label></div><p id="audio-status" role="status"></p></section>`;
  const find = selector => root.querySelector(selector);
  const byId=Object.fromEntries(questions.map(q=>[q.id,q]));
  let session=null,playingId=null;
  try {session=readReviewSession('audio',userId,certificationId);}catch{}
  root.querySelector('.audio-study').insertAdjacentHTML('beforeend','<div class="audio-actions"><button type="button" class="secondary" data-audio-finish-session>Encerrar escuta e ver relatório</button></div><p class="muted" data-audio-session-status role="status"></p><div data-audio-reports></div>');
  function sessionStatus() {
    find('[data-audio-finish-session]').disabled=!session||Boolean(session.finished_at);
    find('[data-audio-session-status]').textContent=session&&!session.finished_at?`${Object.keys(session.outcomes).length} gravações concluídas nesta tentativa.`:'O relatório registra as reproduções concluídas.';
  }
  function saveSession() {
    sessionStatus();
    try {saveReviewSession(session);}catch{find('[data-audio-session-status]').textContent='Não foi possível salvar a escuta neste navegador. Encerre e baixe o relatório para guardar uma cópia.';}
  }
  function finishSession() {
    if(!session||session.finished_at)return;
    player.pause();playingId=null;session.finished_at=new Date().toISOString();
    const report=buildReviewReport(session,byId);
    saveSession();mountReviewHistory(find('[data-audio-reports]'),'audio',userId,certificationId,byId,report);
  }
  find('[data-audio-finish-session]').onclick=finishSession;
  mountReviewHistory(find('[data-audio-reports]'),'audio',userId,certificationId,byId);
  sessionStatus();
  const player = find('#question-audio'), select = find('#audio-question');
  let position = 0;
  try {
    const index = Number(localStorage.getItem(key)) || 0;
    // Keep stored question indices stable when an unavailable recording is omitted.
    const next = available.findIndex(item => item.index >= index);
    position = next < 0 ? available.length - 1 : next;
  } catch {}
  function load(next, play = false) {
    if (!available[next]) return;
    playingId=null;
    position = next;
    const { question: q, index } = available[position];
    select.value = String(index);
    player.src = new URL(questionAudioPath(q), import.meta.url).href;
    player.playbackRate = Number(find('#audio-speed').value);
    find('#audio-transcript').textContent = `${questionPlainText(q)}

Correct answer: ${q.alternativas.filter(a=>a.correta).map(a=>a.texto).join('; ')}`;
    find('#audio-download').href = player.src;
    find('#audio-download').download = `${certificationId}-${q.id}.mp3`;
    find('#audio-prev').disabled = position === 0;
    find('#audio-next').disabled = position === available.length - 1;
    find('#audio-status').textContent = `Questão ${index+1} de ${questions.length}`;
    try { localStorage.setItem(key, String(index)); } catch {}
    if (play) player.play().catch(()=>{ find('#audio-status').textContent = 'Toque em reproduzir para continuar.'; });
  }
  select.addEventListener('change',()=>load(available.findIndex(item => item.index === Number(select.value))));
  find('#audio-prev').addEventListener('click',()=>load(position-1,!player.paused));
  find('#audio-next').addEventListener('click',()=>load(position+1,!player.paused));
  find('#audio-speed').addEventListener('change',()=>{player.playbackRate=Number(find('#audio-speed').value);});
  // Repeat through ended so a completed loop is recorded once, too.
  find('#audio-repeat').addEventListener('change',()=>{player.loop=false;});
  player.addEventListener('play',()=>{
    if(root.isConnected===false||player.paused)return;
    const q=available[position].question;
    if(!session||session.finished_at)session=createReviewSession('audio',available.map(item=>item.question),userId,certificationId);
    if(!session.ids.includes(q.id))session.ids.push(q.id);
    playingId=q.id;
    if(!session.started_ids.includes(q.id))session.started_ids.push(q.id);
    saveSession();
  });
  player.addEventListener('ended',()=>{
    if(root.isConnected===false||session?.finished_at)return;
    const q=available[position].question;
    if(session&&!session.finished_at&&playingId===q.id){
      session.outcomes[q.id]='listened';saveSession();
      if(!find('#audio-repeat').checked&&(!find('#audio-continuous').checked||position===available.length-1||session.ids.every(id=>session.outcomes[id]==='listened')))finishSession();
    }
    if(session?.finished_at)return;
    if(find('#audio-repeat').checked)load(position,true);
    else if (find('#audio-continuous').checked && position < available.length-1) load(position+1,true);
  });
  player.addEventListener('error',()=>{find('#audio-status').textContent='Não foi possível carregar o áudio. Verifique sua conexão e tente novamente.';});
  load(position);
}
