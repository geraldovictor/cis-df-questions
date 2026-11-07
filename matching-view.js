import { getMatchingQuestion, getMatchingAssignments } from './matching.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// A stable shuffle keeps the bank in place when returning to a saved question.
function orderedItems(model, order) {
  let seed = [...model.prompt, ...order.join(',')].reduce((n, char) => Math.imul(n ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261);
  const items = [...model.items];
  for (let i = items.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function contents(model, assignments, { reveal, disabled, order, picked = null, announcement = '' }) {
  const locked = reveal || disabled;
  const itemById = Object.fromEntries(model.items.map(item => [item.id, item]));
  const used = new Set(Object.values(assignments));
  const count = model.targets.filter(target => assignments[target.id]).length;
  const card = item => `<button type="button" class="matching-item ${picked === item.id ? 'is-picked' : ''}" data-match-item="${esc(item.id)}" aria-pressed="${picked === item.id}" aria-label="Selecionar ${esc(item.id)}. ${esc(item.text)}" ${locked ? 'disabled' : ''}><span class="matching-handle" data-match-handle aria-hidden="true">⠿</span><span lang="en"><b>${esc(item.id)}.</b> ${esc(item.text)}</span></button>`;
  return `<div class="matching-instructions"><p>${locked ? 'Confira as associações abaixo.' : 'Arraste os itens pela alça ⠿ até as descrições. Você também pode selecionar um item e tocar na descrição.'}${model.items.length > model.targets.length ? ` Há ${model.items.length - model.targets.length} item(ns) que não serão usados.` : ''}</p><span class="matching-count">${count} de ${model.targets.length} associações</span></div><div class="matching-layout"><section class="matching-bank" data-match-bank aria-label="Itens disponíveis"><h3>Itens disponíveis</h3><div class="matching-pool">${orderedItems(model, order).filter(item => !used.has(item.id)).map(card).join('') || '<p class="matching-empty">Todos os itens foram associados.</p>'}</div></section><section class="matching-destinations" aria-label="Descrições para associar"><h3>Associe cada descrição</h3>${model.targets.map(target => {
    const item = itemById[assignments[target.id]];
    const expected = itemById[model.solution[target.id]];
    const correct = item?.id === expected?.id;
    return `<div class="matching-target ${reveal ? correct ? 'is-correct' : 'is-wrong' : ''}" data-match-target="${esc(target.id)}"><button type="button" class="matching-place" data-match-place="${esc(target.id)}" aria-label="Associar item à descrição ${esc(target.id)}: ${esc(target.text)}" ${locked ? 'disabled' : ''}><span class="matching-number">${esc(target.id)}</span><span lang="en">${esc(target.text)}</span></button><div class="matching-slot">${item ? `${card(item)}${locked ? '' : `<button type="button" class="matching-remove" data-match-remove="${esc(target.id)}" aria-label="Remover ${esc(item.id)} da descrição ${esc(target.id)}">Remover</button>`}` : `<span class="matching-placeholder">${locked ? 'Sem resposta' : picked ? 'Toque na descrição para associar o item selecionado' : 'Solte um item aqui'}</span>`}</div>${reveal ? `<p class="matching-feedback">${correct ? '✓ Associação correta' : `✕ ${item ? 'Associação incorreta' : 'Não respondida'}. Correta: <span lang="en"><b>${esc(expected?.id)}.</b> ${esc(expected?.text)}</span>`}</p>` : ''}</div>`;
  }).join('')}</section></div><p class="matching-status" role="status" aria-live="polite" aria-atomic="true">${esc(announcement || (picked ? `Item ${picked} selecionado. Escolha uma descrição.` : ''))}</p>`;
}

export function renderMatching(question, selected = [], { reveal = false, disabled = false, order = [] } = {}) {
  const model = getMatchingQuestion(question);
  if (!model) return '';
  const explanation = reveal ? question.alternativas.find(option => option.correta)?.explicacao : '';
  return `<div class="matching" data-matching ${reveal || disabled ? 'data-match-locked' : ''}>${contents(model, getMatchingAssignments(question, selected), { reveal, disabled, order })}${explanation ? `<p class="explanation" lang="en">${esc(explanation)}</p>` : ''}</div>`;
}

export function bindMatching(container, question, selected = [], { onChange = () => {}, disabled = false, order = [] } = {}) {
  const root = container.matches?.('[data-matching]') ? container : container.querySelector('[data-matching]');
  const model = getMatchingQuestion(question);
  if (!root || !model || disabled || root.hasAttribute('data-match-locked')) return;
  let assignments = { ...getMatchingAssignments(question, selected) }, picked = null, drag = null, ignoreClick = false;
  const tokens = () => model.targets.filter(target => assignments[target.id]).map(target => `match:${target.id}:${assignments[target.id]}`);
  const redraw = (announcement = '', focusSelector) => {
    root.innerHTML = contents(model, assignments, { reveal: false, disabled: false, order, picked, announcement });
    if (focusSelector) root.querySelector(focusSelector)?.focus({ preventScroll: true });
  };
  const commit = (announcement, focusSelector) => { redraw(announcement, focusSelector); onChange(tokens()); };
  const place = (itemId, targetId) => {
    const previous = Object.keys(assignments).find(id => assignments[id] === itemId);
    const displaced = assignments[targetId];
    if (previous && previous !== targetId) {
      if (displaced) assignments[previous] = displaced;
      else delete assignments[previous];
    }
    assignments[targetId] = itemId;
    picked = null;
    commit(`Item ${itemId} associado à descrição ${targetId}.`, `[data-match-place="${targetId}"]`);
  };
  const cancelDrag = () => {
    if (!drag) return null;
    const current = drag; drag = null;
    cancelAnimationFrame(current.frame);
    current.ghost?.remove(); current.element.classList.remove('is-dragging');
    root.querySelectorAll('.is-over').forEach(element => element.classList.remove('is-over'));
    if (current.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
    return current;
  };
  root.addEventListener('click', event => {
    if (ignoreClick) { ignoreClick = false; event.preventDefault(); return; }
    const remove = event.target.closest('[data-match-remove]');
    if (remove) {
      const id = remove.dataset.matchRemove, item = assignments[id];
      delete assignments[id]; picked = null;
      commit(`Item ${item} devolvido aos itens disponíveis.`, `[data-match-item="${item}"]`); return;
    }
    const item = event.target.closest('[data-match-item]');
    if (item) {
      picked = picked === item.dataset.matchItem ? null : item.dataset.matchItem;
      redraw('', `[data-match-item="${item.dataset.matchItem}"]`); return;
    }
    const target = event.target.closest('[data-match-target]');
    if (target && picked) place(picked, target.dataset.matchTarget);
  });
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') { cancelDrag(); picked = null; redraw('Seleção cancelada.'); }
  });
  const findDrop = (x, y) => {
    const element = document.elementFromPoint(x, y);
    const target = element?.closest('[data-match-target]');
    return target && root.contains(target) ? target : null;
  };
  const highlight = target => {
    root.querySelectorAll('.is-over').forEach(el => { if (el !== target) el.classList.remove('is-over'); });
    target?.classList.add('is-over');
  };
  const animateDrag = () => {
    if (!drag?.active) return;
    if (!root.isConnected || !drag.element.isConnected) { cancelDrag(); return; }
    const edge = 65, y = drag.y;
    if (y < edge) window.scrollBy(0, -Math.ceil((edge - y) / 6));
    else if (y > innerHeight - edge) window.scrollBy(0, Math.ceil((y - innerHeight + edge) / 6));
    highlight(findDrop(drag.x, drag.y));
    drag.frame = requestAnimationFrame(animateDrag);
  };
  root.addEventListener('pointerdown', event => {
    const item = event.target.closest('[data-match-item]');
    if (drag || !item || event.button !== 0 || (event.pointerType !== 'mouse' && !event.target.closest('[data-match-handle]'))) return;
    drag = { id: item.dataset.matchItem, element: item, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false };
    item.setPointerCapture(event.pointerId);
  });
  root.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.x = event.clientX; drag.y = event.clientY;
    if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) > 7) {
      drag.active = true;
      drag.ghost = drag.element.cloneNode(true);
      drag.ghost.removeAttribute('data-match-item'); drag.ghost.removeAttribute('id');
      drag.ghost.classList.add('matching-ghost');
      drag.ghost.style.width = `${Math.min(drag.element.getBoundingClientRect().width, innerWidth - 32)}px`;
      drag.ghost.setAttribute('aria-hidden', 'true');
      document.body.append(drag.ghost);
      drag.element.classList.add('is-dragging');
      animateDrag();
    }
    if (drag.active) {
      event.preventDefault();
      drag.ghost.style.left = `${Math.max(8, Math.min(drag.x - 24, innerWidth - drag.ghost.offsetWidth - 8))}px`;
      drag.ghost.style.top = `${drag.y + 14}px`;
      highlight(findDrop(drag.x, drag.y));
    }
  }, { passive: false });
  const finishDrag = (event, cancelled = false) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const current = cancelDrag();
    if (!current.active) return;
    ignoreClick = true; setTimeout(() => { ignoreClick = false; }, 0);
    if (cancelled) return;
    const target = findDrop(event.clientX, event.clientY);
    if (target) place(current.id, target.dataset.matchTarget);
    else {
      const bank = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-match-bank]');
      if (bank && root.contains(bank)) {
        const previous = Object.keys(assignments).find(id => assignments[id] === current.id);
        if (previous) { delete assignments[previous]; picked = null; commit(`Item ${current.id} devolvido aos itens disponíveis.`, `[data-match-item="${current.id}"]`); }
      }
    }
  };
  root.addEventListener('pointerup', event => finishDrag(event));
  root.addEventListener('pointercancel', event => finishDrag(event, true));
  root.addEventListener('lostpointercapture', event => { if (drag?.pointerId === event.pointerId) finishDrag(event, true); });
}
