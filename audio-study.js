import { questionPlainText, questionAudioPath } from './question-content.js';
import { DEFAULT_CERTIFICATION, certificationStorageKey } from './certification.js';

export function renderAudioStudy(root, questions, certificationId = DEFAULT_CERTIFICATION) {
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
  find('#audio-repeat').addEventListener('change',event=>{player.loop=event.target.checked;});
  player.addEventListener('ended',()=>{
    if (find('#audio-continuous').checked && position < available.length-1) load(position+1,true);
  });
  player.addEventListener('error',()=>{find('#audio-status').textContent='Não foi possível carregar o áudio. Verifique sua conexão e tente novamente.';});
  load(position);
}
