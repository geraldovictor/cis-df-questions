import { shuffle } from './quiz.js';
import { getMatchingQuestion } from './matching.js';
import { renderQuestionContext, questionAudioPath } from './question-content.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const filters = new Set(['all', 'review', 'known', 'new']);

export function memorySourceKey(question) {
  const text = JSON.stringify([question.pergunta, question.contexto, question.alternativas.filter(answer => answer.correta).map(answer => answer.texto)]);
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

export function validateMemoryAids(aids, questions) {
  for (const q of questions) {
    const aid = aids?.[q.id];
    const expected = q.alternativas.flatMap((answer, index) => answer.correta ? [index] : []);
    if (!aid || aid.assinatura !== memorySourceKey(q) || ['gatilho', 'macete', 'conexao', 'tecnica'].some(key => typeof aid[key] !== 'string' || !aid[key].trim()) ||
        !Array.isArray(aid.respostas) || aid.respostas.length !== expected.length ||
        new Set(aid.respostas).size !== expected.length || !expected.every(index => aid.respostas.includes(index))) {
      throw new Error('As dicas de decoreba estão incompletas ou desatualizadas. Conecte-se à internet e recarregue a página.');
    }
  }
  return aids;
}

export function restoreMemoryProgress(raw, questions) {
  const ids = new Set(questions.map(q => q.id));
  const marks = Object.fromEntries(Object.entries(raw?.marks || {}).filter(([id, value]) => ids.has(id) && ['known', 'review'].includes(value)));
  const order = [...new Set(Array.isArray(raw?.order) ? raw.order.filter(id => ids.has(id)) : [])];
  order.push(...questions.map(q => q.id).filter(id => !order.includes(id)));
  return { marks, order, currentId: ids.has(raw?.currentId) ? raw.currentId : order[0],
    mode: raw?.mode === 'test' ? 'test' : 'learn', filter: filters.has(raw?.filter) ? raw.filter : 'all' };
}

export function memoryDeck(questions, marks, filter = 'all', query = '', aids = {}) {
  const term = normalize(query).trim();
  return questions.filter(q => {
    if (filter === 'review' && marks[q.id] !== 'review') return false;
    if (filter === 'known' && marks[q.id] !== 'known') return false;
    if (filter === 'new' && marks[q.id]) return false;
    if (!term) return true;
    const aid = aids[q.id] || {};
    return normalize([q.id, q.pergunta, q.contexto?.introducao, ...(q.contexto?.paragrafos || []), aid.gatilho, aid.macete, aid.conexao,
      ...q.alternativas.filter(a => a.correta).map(a => a.texto)].join(' ')).includes(term);
  });
}

function originalQuestion(q) {
  const model = getMatchingQuestion(q);
  return `${renderQuestionContext(q)}<p class="memory-original" lang="en">${esc(model?.prompt || q.pergunta)}</p>${model ? `<div class="memory-source-lists"><div><b>Itens</b><ul>${model.items.map(item => `<li lang="en">${esc(item.text)}</li>`).join('')}</ul></div><div><b>Descrições</b><ul>${model.targets.map(target => `<li lang="en">${esc(target.text)}</li>`).join('')}</ul></div></div>` : ''}`;
}

function correctAnswers(q) {
  const model = getMatchingQuestion(q);
  if (model) return `<dl class="memory-pairs">${model.targets.map(target => {
    const item = model.items.find(item => item.id === model.solution[target.id]);
    return `<div><dt lang="en">${esc(item.text)}</dt><dd lang="en">${esc(target.text)}</dd></div>`;
  }).join('')}</dl>`;
  return `<ul class="memory-answers">${q.alternativas.filter(answer => answer.correta).map(answer => `<li lang="en">${esc(answer.texto)}</li>`).join('')}</ul>`;
}

export function renderMemorization({ app, questions, aids, userId, back }) {
  validateMemoryAids(aids, questions);
  const key = `cis-df-memory-v1-${userId}`;
  let stored, storageError = '';
  try { stored = JSON.parse(localStorage.getItem(key) || 'null'); }
  catch { storageError = 'Não foi possível ler seu progresso de decoreba neste navegador.'; }
  let { marks, order, currentId, mode, filter } = restoreMemoryProgress(stored, questions);
  let revealed = false, query = '';
  const byId = Object.fromEntries(questions.map(q => [q.id, q]));
  const sourceNumbers = Object.fromEntries(questions.map((q, index) => [q.id, index + 1]));
  const find = selector => app.querySelector(selector);
  app.innerHTML = `<div class="quiz-heading"><button type="button" class="quiet" data-memory-back>← Voltar à minha trajetória</button><span class="tag">Decoreba · ${questions.length} macetes</span></div><section class="card memory-tools"><div><span class="eyebrow">Palavras que puxam a resposta</span><h1>Um macete para cada questão.</h1><p class="muted">Aprenda a associação, tente lembrar e confira o gabarito. As letras das alternativas mudam; guarde os conceitos.</p></div><div class="memory-modes" role="group" aria-label="Forma de praticar"><button type="button" data-memory-mode="learn">Aprender macetes</button><button type="button" data-memory-mode="test">Testar memória</button></div><div class="memory-stats" data-memory-stats role="status"></div><div class="progress" role="progressbar" aria-label="Macetes decorados" aria-valuemin="0" aria-valuemax="${questions.length}" data-memory-progress><span></span></div><div class="memory-controls"><label>Buscar<input type="search" data-memory-search placeholder="Tema, palavra-chave ou referência" autocomplete="off"></label><label>Mostrar<select data-memory-filter><option value="all">Todos os macetes</option><option value="review">Ainda confundo</option><option value="known">Decorei</option><option value="new">Sem marcação</option></select></label><button type="button" class="secondary" data-memory-shuffle>Embaralhar</button></div><label class="memory-jump">Ir para uma questão<select data-memory-jump></select></label><p class="memory-storage" role="status" data-memory-storage></p></section><div data-memory-content></div>`;
  find('[data-memory-filter]').value = filter;

  const ordered = () => order.map(id => byId[id]);
  const deck = () => memoryDeck(ordered(), marks, filter, query, aids);
  function save() {
    try {
      localStorage.setItem(key, JSON.stringify({ marks, order, currentId, mode, filter }));
      storageError = '';
    } catch { storageError = 'Não foi possível salvar a decoreba neste navegador. Suas marcações desta tela continuam disponíveis enquanto ela estiver aberta.'; }
    find('[data-memory-storage]').textContent = storageError;
  }
  function render(focus = false) {
    const list = deck();
    let index = list.findIndex(q => q.id === currentId);
    if (index < 0) index = 0;
    const q = list[index];
    // Keep the last question when a filter is empty, so returning restores it.
    if (q) currentId = q.id;
    const known = Object.values(marks).filter(value => value === 'known').length;
    const review = Object.values(marks).filter(value => value === 'review').length;
    find('[data-memory-stats]').innerHTML = `<span><b>${known}</b> decorei</span><span><b>${review}</b> ainda confundo</span><span><b>${questions.length-known-review}</b> sem marcação</span>`;
    find('[data-memory-progress]').setAttribute('aria-valuenow', String(known));
    find('[data-memory-progress] span').style.width = `${known/questions.length*100}%`;
    app.querySelectorAll('[data-memory-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.memoryMode === mode)));
    find('[data-memory-storage]').textContent = storageError;
    find('[data-memory-jump]').innerHTML = list.map(item => `<option value="${esc(item.id)}">Questão ${sourceNumbers[item.id]} · ${esc(aids[item.id].gatilho)}</option>`).join('');
    find('[data-memory-jump]').disabled = !q;
    find('[data-memory-jump]').value = currentId;
    if (!q) {
      find('[data-memory-content]').innerHTML = `<section class="card empty"><b>${query ? 'Nenhum macete encontrado.' : filter === 'review' ? 'Nenhuma questão marcada como “Ainda confundo”.' : 'Nenhum macete neste filtro.'}</b><p>Busque outra palavra ou volte para todas as questões.</p><button type="button" class="secondary" data-memory-all>Ver todos os macetes</button></section>`;
      find('[data-memory-all]').onclick = () => { query = ''; filter = 'all'; find('[data-memory-search]').value = ''; find('[data-memory-filter]').value = filter; revealed = false; render(); save(); };
      return;
    }
    const aid = aids[q.id], showAid = mode === 'learn' || revealed;
    const expected = q.alternativas.filter(answer => answer.correta).length;
    find('[data-memory-content]').innerHTML = `<article class="card memory-card"><div class="memory-card-heading"><span class="eyebrow">Macete ${index+1} de ${list.length} · Questão ${sourceNumbers[q.id]} · Ref. ${esc(q.id)}</span><span class="tag">${esc(aid.tecnica)}</span></div><h2 class="memory-title" tabindex="-1">${esc(aid.gatilho)}</h2><details class="memory-question"><summary>Ver enunciado original</summary>${originalQuestion(q)}</details>${showAid ? `<section class="memory-hook" aria-label="Dica de memorização"><span class="eyebrow">Guarde assim</span><p class="memory-mnemonic" data-memory-mnemonic>${esc(aid.macete)}</p><p class="memory-connection">${esc(aid.conexao)}</p>${aid.observacao ? `<p class="memory-observation"><b>Atenção ao gabarito deste banco:</b> ${esc(aid.observacao)}</p>` : ''}</section>` : '<div class="memory-challenge"><b>Qual resposta essa pista te faz lembrar?</b><p>Pense nos termos corretos antes de revelar o macete.</p></div>'}<button type="button" class="primary" data-memory-reveal aria-expanded="${revealed}">${revealed ? 'Ocultar resposta' : mode === 'test' ? 'Revelar macete e resposta' : 'Conferir resposta'}</button>${revealed ? `<section class="memory-answer" aria-label="Gabarito"><h3>${getMatchingQuestion(q) ? 'Associações corretas' : expected > 1 ? `Lembre das ${expected} respostas corretas` : 'Resposta correta'}</h3>${correctAnswers(q)}<audio controls preload="none" src="${esc(questionAudioPath(q))}" aria-label="Ouvir questão e resposta original em inglês"></audio><p class="muted">Como ficou sua memória desta questão?</p><div class="memory-ratings"><button type="button" class="secondary" data-memory-rate="review">Ainda confundo</button><button type="button" class="primary" data-memory-rate="known">Decorei ✓</button></div></section>` : '<p class="muted memory-prompt">Tente dizer a resposta de cabeça antes de conferir.</p>'}${marks[q.id] ? `<p class="memory-mark">Sua marcação: <b>${marks[q.id] === 'known' ? 'Decorei' : 'Ainda confundo'}</b> <button type="button" class="quiet" data-memory-clear>Limpar marcação</button></p>` : ''}<div class="quiz-actions"><button type="button" class="secondary" data-memory-prev ${index === 0 ? 'disabled' : ''}>← Anterior</button><button type="button" class="secondary" data-memory-next ${index === list.length-1 ? 'disabled' : ''}>Próxima →</button></div><p class="memory-local">Progresso de decoreba salvo neste navegador, separado por conta.</p></article>`;
    find('[data-memory-reveal]').onclick = () => { revealed = !revealed; render(); find('[data-memory-reveal]').focus({ preventScroll: true }); };
    const move = nextId => { currentId = nextId; revealed = false; render(true); save(); };
    find('[data-memory-prev]').onclick = () => move(list[index-1].id);
    find('[data-memory-next]').onclick = () => move(list[index+1].id);
    app.querySelectorAll('[data-memory-rate]').forEach(button => { button.onclick = () => {
      const nextId = list[(index+1)%list.length]?.id;
      marks[q.id] = button.dataset.memoryRate;
      const remaining = deck();
      currentId = remaining.some(item => item.id === nextId) ? nextId : remaining[Math.min(index, remaining.length-1)]?.id || q.id;
      revealed = false; render(true); save();
    }; });
    if (find('[data-memory-clear]')) find('[data-memory-clear]').onclick = () => { delete marks[q.id]; revealed = false; render(); save(); };
    if (focus) find('.memory-title')?.focus({ preventScroll: true });
  }
  find('[data-memory-back]').onclick = back;
  find('[data-memory-search]').oninput = event => { query = event.target.value; revealed = false; render(); save(); };
  find('[data-memory-filter]').onchange = event => { filter = event.target.value; revealed = false; render(); save(); };
  find('[data-memory-jump]').onchange = event => { currentId = event.target.value; revealed = false; render(true); save(); };
  find('[data-memory-shuffle]').onclick = () => { order = shuffle(order); currentId = deck()[0]?.id || currentId; revealed = false; render(true); save(); };
  app.querySelectorAll('[data-memory-mode]').forEach(button => { button.onclick = () => { mode = button.dataset.memoryMode; revealed = false; render(); save(); }; });
  render();
}
