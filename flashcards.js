import { shuffle } from './quiz.js';

export function restoreFlashcards(raw, questions) {
  const ids = new Set(questions.map(q => q.id));
  const marks = Object.fromEntries(Object.entries(raw?.marks || {}).filter(([id, value]) => ids.has(id) && ['known', 'review'].includes(value)));
  return { marks, currentId: ids.has(raw?.currentId) ? raw.currentId : questions[0]?.id };
}

export function flashcardDeck(questions, marks, mode) {
  return mode === 'review' ? questions.filter(q => marks[q.id] === 'review') : [...questions];
}

export function renderFlashcards(root, questions, userId) {
  const key = `cis-df-flashcards-${userId}`;
  let stored;
  try { stored = JSON.parse(localStorage.getItem(key) || 'null'); } catch {}
  let { marks, currentId } = restoreFlashcards(stored, questions);
  let order = [...questions], mode = 'all', revealed = false;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  root.innerHTML = `<details class="card flashcards"><summary><span class="eyebrow">Memorize no seu ritmo</span><h2>Flashcards</h2><span class="muted">Pense na resposta e vire o cartão para conferir.</span></summary><p class="muted">Suas marcações ficam salvas neste navegador, separadas por conta.</p><div class="flashcard-tools"><label>Baralho <select data-fc-mode><option value="all">Todas as questões</option><option value="review">Quero revisar</option></select></label><button type="button" class="secondary" data-fc-shuffle>Embaralhar</button></div><p data-fc-stats role="status"></p><div data-fc-content></div></details>`;
  const find = selector => root.querySelector(selector);
  function save() {
    try { localStorage.setItem(key, JSON.stringify({ marks, currentId })); }
    catch { find('[data-fc-stats]').textContent += ' Não foi possível salvar neste navegador.'; }
  }
  function render(focus = false) {
    const deck = flashcardDeck(order, marks, mode);
    let index = deck.findIndex(q => q.id === currentId);
    if (index < 0) index = 0;
    const q = deck[index];
    currentId = q?.id;
    const values = Object.values(marks);
    find('[data-fc-stats]').textContent = `${values.filter(v=>v==='known').length} já sei · ${values.filter(v=>v==='review').length} para revisar · ${questions.length-values.length} sem marcação`;
    if (!q) {
      find('[data-fc-content]').innerHTML = '<p class="empty">Nenhum cartão para revisar. Marque “Quero revisar” nos cartões que quiser praticar novamente.</p><button type="button" class="secondary" data-fc-all>Ver todas as questões</button>';
      find('[data-fc-all]').onclick = () => { mode='all'; find('[data-fc-mode]').value=mode; revealed=false; render(); };
      return;
    }
    const answers = q.alternativas.filter(a => a.correta);
    find('[data-fc-content]').innerHTML = `<p class="muted">Cartão ${index+1} de ${deck.length}${marks[q.id] ? ` · ${marks[q.id]==='known'?'Já sei':'Quero revisar'}` : ''}</p><article class="flashcard-face"><span class="eyebrow">${revealed?'Resposta':'Pergunta'}</span><h3 lang="en">${esc(q.pergunta)}</h3>${revealed ? `<div class="flashcard-answer"><strong>${answers.length>1?'Respostas corretas':'Resposta correta'}</strong>${answers.map(a=>`<div lang="en"><p>${esc(a.texto)}</p>${a.explicacao?`<p class="explanation">${esc(a.explicacao)}</p>`:''}</div>`).join('')}<audio controls preload="none" src="audio/${encodeURIComponent(q.id)}.mp3" aria-label="Ouvir pergunta e resposta"></audio></div>` : '<p class="muted">Tente lembrar antes de revelar.</p>'}</article><div class="flashcard-tools"><button type="button" class="primary" data-fc-flip>${revealed?'Ocultar resposta':'Mostrar resposta'}</button>${revealed?'<button type="button" class="secondary" data-fc-rate="review">Quero revisar</button><button type="button" class="secondary" data-fc-rate="known">Já sei ✓</button>':''}</div><div class="flashcard-tools"><button type="button" class="quiet" data-fc-prev ${index===0?'disabled':''}>← Anterior</button><button type="button" class="quiet" data-fc-next ${index===deck.length-1?'disabled':''}>Próximo →</button></div>`;
    find('[data-fc-flip]').onclick = () => { revealed=!revealed; render(true); };
    function move(next) { currentId=deck[next].id; revealed=false; render(true); save(); }
    find('[data-fc-prev]').onclick = () => move(index-1);
    find('[data-fc-next]').onclick = () => move(index+1);
    root.querySelectorAll('[data-fc-rate]').forEach(button => { button.onclick = () => {
      marks[q.id]=button.dataset.fcRate;
      const remaining = flashcardDeck(order, marks, mode);
      const nextIndex = mode==='review' && button.dataset.fcRate==='known' ? index : index+1;
      currentId=remaining[nextIndex % remaining.length]?.id;
      revealed=false; render(true); save();
    }; });
    if (focus) find('[data-fc-flip]').focus({preventScroll:true});
  }
  find('[data-fc-mode]').onchange = event => { mode=event.target.value; revealed=false; render(); };
  find('[data-fc-shuffle]').onclick = () => { order=shuffle(order); currentId=flashcardDeck(order,marks,mode)[0]?.id; revealed=false; render(); save(); };
  render();
}
