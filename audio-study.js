export function renderAudioStudy(root, questions) {
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  root.innerHTML = `<section class="card audio-study"><span class="eyebrow">Revisão diária em áudio</span><h2>Ouvir questões</h2><p>Pergunta e respostas corretas em inglês. Escolha uma questão ou ouça a sequência completa.</p><label class="field">Questão<select id="audio-question">${questions.map((q,i)=>`<option value="${i}">${i+1}. ${escape(q.pergunta)}</option>`).join('')}</select></label><p id="audio-transcript" lang="en"></p><audio id="question-audio" controls preload="none" aria-label="Pergunta e resposta correta"></audio><div class="audio-actions"><button type="button" id="audio-prev" class="quiet">← Anterior</button><button type="button" id="audio-next" class="quiet">Próxima →</button><a id="audio-download" download>Baixar áudio</a></div><div class="audio-actions"><label><input id="audio-continuous" type="checkbox" checked> Tocar próximas automaticamente</label><label><input id="audio-repeat" type="checkbox"> Repetir questão</label><label>Velocidade <select id="audio-speed"><option value="0.75">0,75×</option><option value="1" selected>1×</option><option value="1.25">1,25×</option><option value="1.5">1,5×</option></select></label></div><p id="audio-status" role="status"></p></section>`;
  const find = selector => root.querySelector(selector);
  const player = find('#question-audio'), select = find('#audio-question');
  let index = 0;
  try { index = Math.max(0, Math.min(questions.length - 1, Number(localStorage.getItem('cis-df-audio-index')) || 0)); } catch {}
  function load(next, play = false) {
    index = next;
    select.value = String(index);
    const q = questions[index];
    player.src = new URL(`./audio/${q.id}.wav`, import.meta.url).href;
    player.playbackRate = Number(find('#audio-speed').value);
    find('#audio-transcript').textContent = `${q.pergunta} — Correct answer: ${q.alternativas.filter(a=>a.correta).map(a=>a.texto).join('; ')}`;
    find('#audio-download').href = player.src;
    find('#audio-download').download = `cis-df-${q.id}.wav`;
    find('#audio-prev').disabled = index === 0;
    find('#audio-next').disabled = index === questions.length - 1;
    find('#audio-status').textContent = `Questão ${index+1} de ${questions.length}`;
    try { localStorage.setItem('cis-df-audio-index', String(index)); } catch {}
    if (play) player.play().catch(()=>{ find('#audio-status').textContent = 'Toque em reproduzir para continuar.'; });
  }
  select.addEventListener('change',()=>load(Number(select.value)));
  find('#audio-prev').addEventListener('click',()=>load(index-1,!player.paused));
  find('#audio-next').addEventListener('click',()=>load(index+1,!player.paused));
  find('#audio-speed').addEventListener('change',()=>{player.playbackRate=Number(find('#audio-speed').value);});
  find('#audio-repeat').addEventListener('change',event=>{player.loop=event.target.checked;});
  player.addEventListener('ended',()=>{
    if (find('#audio-continuous').checked && index < questions.length-1) load(index+1,true);
  });
  player.addEventListener('error',()=>{find('#audio-status').textContent='Não foi possível carregar o áudio. Verifique sua conexão e tente novamente.';});
  load(index);
}
