export const GUEST_ID = 'offline-guest';
export const LOCAL_PROGRESS_KEY = 'cis-df-offline-progress-v1';
export const AUDIO_CACHE = 'cis-df-audio-v1';

export function readLocalProgress(storage = localStorage) {
  const data = JSON.parse(storage.getItem(LOCAL_PROGRESS_KEY) || '{"attempts":[],"studies":[]}');
  if (!data || !Array.isArray(data.attempts) || !Array.isArray(data.studies)) {
    throw new Error('Não foi possível ler o progresso offline salvo neste navegador.');
  }
  return data;
}

export function saveLocalAttempt(attempt, storage = localStorage) {
  if (attempt.user_id !== GUEST_ID) throw new Error('Este resultado não pertence ao modo offline.');
  const data = readLocalProgress(storage);
  const list = attempt.state.mode === 'study' ? data.studies : data.attempts;
  const index = list.findIndex(item => item.id === attempt.id);
  const snapshot = JSON.parse(JSON.stringify(attempt));
  if (index < 0) list.unshift(snapshot); else list[index] = snapshot;
  storage.setItem(LOCAL_PROGRESS_KEY, JSON.stringify(data));
}

export async function prepareOffline() {
  if (!('serviceWorker' in navigator)) throw new Error('Este navegador não permite preparar o acesso sem internet.');
  const registration = await navigator.serviceWorker.register(new URL('./sw.js', import.meta.url), {updateViaCache:'none'});
  const worker = registration.installing;
  if (worker) await new Promise((resolve,reject) => {
    const check = () => {
      if (worker.state === 'installed' || worker.state === 'activated') {worker.removeEventListener('statechange',check);resolve();}
      if (worker.state === 'redundant') {worker.removeEventListener('statechange',check);reject(new Error('Não foi possível salvar o site offline.'));}
    };
    worker.addEventListener('statechange',check); check();
  });
  await navigator.serviceWorker.ready;
}

let downloading = false;
export function renderOfflineTools(root, questions, preparation) {
  root.innerHTML = `<div class="notice offline-notice"><strong>Estudo sem login</strong><p>Simulados, estudos e flashcards ficam neste navegador. Limpar os dados do site apaga o progresso local. Os resultados offline ficam separados da sua conta.</p><p data-offline-status role="status">Preparando as ${questions.length} questões para acesso sem internet…</p><button type="button" class="secondary" data-offline-audio>Salvar áudios para ouvir offline</button><p data-offline-audio-status role="status">Os áudios são opcionais e precisam ser salvos com internet.</p></div>`;
  preparation.then(() => {
    root.querySelector('[data-offline-status]').textContent = `${questions.length} questões e o site estão prontos para abrir sem internet.`;
  }).catch(() => {
    root.querySelector('[data-offline-status]').textContent = 'Ainda não foi possível preparar o site offline. Conecte-se à internet e recarregue antes de sair.';
  });
  const button = root.querySelector('[data-offline-audio]');
  if ('caches' in window) caches.open(AUDIO_CACHE).then(async cache => {
    const saved = new Set((await cache.keys()).map(request => request.url));
    const count = questions.filter(q => saved.has(new URL(`./audio/${q.id}.mp3`, import.meta.url).href)).length;
    if (count && !downloading) root.querySelector('[data-offline-audio-status]').textContent = `${count} de ${questions.length} áudios disponíveis offline.`;
  }).catch(()=>{});
  button.onclick = async () => {
    if (downloading) return;
    downloading = true; button.disabled = true;
    const status = root.querySelector('[data-offline-audio-status]');
    try {
      await preparation;
      const cache = await caches.open(AUDIO_CACHE);
      let completed = 0, cursor = 0, stopped = false;
      const results = await Promise.allSettled(Array.from({length:3}, async () => {
        while (!stopped && cursor < questions.length) {
          const q = questions[cursor++];
          const url = new URL(`./audio/${q.id}.mp3`, import.meta.url).href;
          try { if (!await cache.match(url)) await cache.add(new Request(url, {cache:'reload'})); }
          catch(error) { stopped=true; throw error; }
          status.textContent = `${++completed} de ${questions.length} áudios salvos…`;
        }
      }));
      if (results.some(result => result.status === 'rejected')) throw new Error('Download incompleto');
      status.textContent = `Todos os ${questions.length} áudios estão disponíveis offline.`;
    } catch {
      status.textContent = 'Download incompleto. Verifique a conexão e o espaço disponível e tente novamente. Os áudios já salvos serão aproveitados.';
    } finally { downloading = false; button.disabled = false; }
  };
}
