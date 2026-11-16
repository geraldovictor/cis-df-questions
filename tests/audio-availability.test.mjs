import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderAudioStudy } from '../audio-study.js';
import { renderOfflineTools } from '../offline.js';
import { renderFlashcards } from '../flashcards.js';
import { renderMemorization, memorySourceKey } from '../memorization.js';

// A small DOM double exercises event handlers without starting a browser.
class Element {
  constructor() { this.innerHTML = ''; this.textContent = ''; this.value = '1'; this.style = {}; this.dataset = {}; this.listeners = {}; this.sources = []; this.paused = true; }
  set src(value) { this.source = value; this.sources.push(value); }
  get src() { return this.source; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  fire(name, event = {}) { return this.listeners[name]?.(event); }
  setAttribute() {}
  focus() {}
  play() { this.paused = false; return Promise.resolve(); }
}
function rootElement() {
  const root = new Element(), nodes = new Map();
  root.querySelector = selector => {
    if (!nodes.has(selector)) nodes.set(selector, new Element());
    return nodes.get(selector);
  };
  root.querySelectorAll = () => [];
  return root;
}
function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
async function globals(values, action) {
  const original = Object.fromEntries(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  try { return await action(); }
  finally {
    for (const [key, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}
const question = (id, audio) => ({ id, certification: 'cis-em', pergunta: `Question ${id}`, ...(audio === undefined ? {} : { audio_disponivel: audio }), alternativas: [{ texto: `Answer ${id}`, correta: true, explicacao: '' }, { texto: 'Other', correta: false, explicacao: '' }] });
const bank = [question('first'), question('missing', false), question('last', true)];
const audioKey = 'cis-em-audio-index';

test('daily player skips unavailable recordings in selection, buttons and continuous playback while keeping original indices', async () => {
  await globals({ localStorage: storage({ [audioKey]: '0' }) }, async () => {
    const root = rootElement();
    root.querySelector('#audio-continuous').checked = true;
    renderAudioStudy(root, bank, 'cis-em');
    assert.match(root.innerHTML, /Áudio indisponível para 1 questão/);
    assert.deepEqual([...root.innerHTML.matchAll(/<option value="(\d+)">\d+\./g)].map(match => match[1]), ['0', '2']);
    assert.equal(root.querySelector('#audio-question').value, '0');
    root.querySelector('#question-audio').fire('ended');
    assert.equal(root.querySelector('#audio-question').value, '2');
    assert.equal(localStorage.getItem(audioKey), '2');
    assert.equal(root.querySelector('#audio-next').disabled, true);
    root.querySelector('#audio-prev').fire('click');
    assert.equal(root.querySelector('#audio-question').value, '0');
    root.querySelector('#audio-next').fire('click');
    root.querySelector('#audio-question').value = '1';
    root.querySelector('#audio-question').fire('change');
    assert.ok(root.querySelector('#question-audio').sources.every(src => !src.includes('missing.mp3')));
    assert.ok(root.querySelector('#audio-download').href.endsWith('/last.mp3'));
    assert.match(root.innerHTML, /value="1.25"/);
  });
});

test('all118 pre-import audio positions survive the137-question bank and an unavailable saved position advances safely', async () => {
  const questions = JSON.parse(await readFile(new URL('../data/cis-em/questions.json', import.meta.url), 'utf8'));
  assert.equal(questions.length, 137);
  assert.equal(questions.filter(q => q.audio_disponivel !== false).length, 136);
  await globals({ localStorage: storage() }, async () => {
    for (let index = 0; index < 118; index++) {
      localStorage.setItem(audioKey, String(index));
      const root = rootElement();
      renderAudioStudy(root, questions, 'cis-em');
      assert.equal(root.querySelector('#audio-question').value, String(index));
      assert.ok(root.querySelector('#question-audio').src.includes(`/${questions[index].id}.mp3`));
    }
    const missing = questions.findIndex(q => q.audio_disponivel === false);
    localStorage.setItem(audioKey, String(missing));
    const root = rootElement();
    renderAudioStudy(root, questions, 'cis-em');
    assert.equal(root.querySelector('#audio-question').value, String(missing + 1));
  });
});

test('daily player handles an empty or entirely unavailable bank without creating audio or download controls', () => {
  for (const questions of [[], [bank[1]]]) {
    const root = rootElement();
    renderAudioStudy(root, questions, 'cis-em');
    assert.match(root.innerHTML, /Áudio indisponível/);
    assert.doesNotMatch(root.innerHTML, /<audio|audio-download|audio-question/);
  }
});

test('flashcards and memorization retain the question and answer but omit missing audio requests', async () => {
  for (const q of [bank[0], bank[1]]) await globals({ localStorage: storage() }, async () => {
    const flashcards = rootElement();
    renderFlashcards(flashcards, [q], 'offline-guest', 'cis-em');
    flashcards.querySelector('[data-fc-flip]').onclick();
    const flashcardAnswer = flashcards.querySelector('[data-fc-content]').innerHTML;
    assert.ok(flashcardAnswer.includes(q.alternativas[0].texto));
    const aids = { [q.id]: { gatilho: 'Gatilho', macete: 'Macete', conexao: 'Conexão', tecnica: 'Técnica', respostas: [0], assinatura: memorySourceKey(q) } };
    const memory = rootElement();
    renderMemorization({ app: memory, questions: [q], aids, userId: 'offline-guest', back() {}, certificationId: 'cis-em' });
    memory.querySelector('[data-memory-reveal]').onclick();
    const memoryAnswer = memory.querySelector('[data-memory-content]').innerHTML;
    assert.ok(memoryAnswer.includes(q.alternativas[0].texto));
    for (const html of [flashcardAnswer, memoryAnswer]) {
      if (q.audio_disponivel === false) {
        assert.match(html, /Áudio indisponível/);
        assert.doesNotMatch(html, /<audio|missing\.mp3/);
      } else assert.match(html, /<audio[^>]+first\.mp3/);
    }
  });
});

test('offline audio counts and download use only available recordings even when stale unavailable audio is cached', async () => {
  const existing = new Map([[new URL('../audio/cis-em/missing.mp3', import.meta.url).href, true]]), requested = [];
  const cache = {
    keys: async () => [...existing.keys()].map(url => ({ url })),
    match: async url => existing.get(url),
    add: async request => { requested.push(request.url); existing.set(request.url, true); }
  };
  await globals({ window: { caches: {} }, caches: { open: async () => cache } }, async () => {
    const root = rootElement();
    renderOfflineTools(root, bank, Promise.resolve());
    await root.querySelector('[data-offline-audio]').onclick();
    assert.equal(root.querySelector('[data-offline-status]').textContent, '3 questões e o site estão prontos para abrir sem internet.');
    assert.equal(root.querySelector('[data-offline-audio-status]').textContent, 'Todos os 2 áudios estão disponíveis offline.');
    assert.deepEqual(requested.map(url => url.split('/').at(-1)).sort(), ['first.mp3', 'last.mp3']);
    const cached = rootElement();
    renderOfflineTools(cached, bank, Promise.resolve());
    await new Promise(done => setImmediate(done));
    assert.equal(cached.querySelector('[data-offline-audio-status]').textContent, '2 de 2 áudios disponíveis offline.');
  });
});

test('zero available offline audio still prepares every question and does not open the audio cache', async () => {
  await globals({ window: { caches: {} }, caches: { open() { throw new Error('Audio cache must not be opened'); } } }, async () => {
    const root = rootElement();
    renderOfflineTools(root, [bank[1]], Promise.resolve());
    await new Promise(done => setImmediate(done));
    assert.match(root.innerHTML, /Áudio indisponível/);
    assert.doesNotMatch(root.innerHTML, /<button[^>]+data-offline-audio/);
    assert.equal(root.querySelector('[data-offline-status]').textContent, '1 questões e o site estão prontos para abrir sem internet.');
  });
});
