const SHELL_CACHE = 'cis-df-shell-v2';
const AUDIO_CACHE = 'cis-df-audio-v1';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './config.js', './quiz.js', './study.js', './study-view.js', './flashcards.js', './audio-study.js', './offline.js', './pwa.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png', './questoes-1-corrigida (1).json', './questoes-2-corrigida-v2 (1).json', './questoes-3-corrigida-v2 (1).json'];
const base = self.registration.scope;
const shellURLs = new Set(ASSETS.map(path => new URL(path, base).href));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(ASSETS.map(path => new Request(new URL(path, base), {cache:'reload'})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('cis-df-shell-') && key !== SHELL_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

async function audioResponse(request) {
  const cache = await caches.open(AUDIO_CACHE);
  const cached = await cache.match(request.url);
  if (!cached) return fetch(request);
  const range = request.headers.get('range');
  if (!range) return cached;
  const blob = await cached.blob();
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return new Response(null, {status:416, headers:{'Content-Range':`bytes */${blob.size}`}});
  const start = match[1] ? Number(match[1]) : Math.max(0, blob.size-Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), blob.size-1) : blob.size-1;
  if (start > end || start >= blob.size) return new Response(null, {status:416, headers:{'Content-Range':`bytes */${blob.size}`}});
  return new Response(blob.slice(start, end+1), {status:206, headers:{'Content-Type':'audio/mpeg','Content-Range':`bytes ${start}-${end}/${blob.size}`,'Content-Length':String(end-start+1),'Accept-Ranges':'bytes'}});
}

self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || !url.href.startsWith(base)) return;
  if (url.pathname.endsWith('.mp3')) { event.respondWith(audioResponse(request)); return; }
  if (request.mode === 'navigate') {
    event.respondWith(caches.open(SHELL_CACHE).then(cache => cache.match(new URL('./index.html',base))).then(response => response || fetch(request)));
  } else if (shellURLs.has(url.href)) {
    event.respondWith(caches.open(SHELL_CACHE).then(cache => cache.match(request)).then(response => response || fetch(request)));
  }
});
