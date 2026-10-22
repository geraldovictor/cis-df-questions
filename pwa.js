const panel = document.querySelector('#install-panel');
const button = document.querySelector('#install-app');
const status = document.querySelector('#install-status');
const standalone = window.matchMedia('(display-mode: standalone)');
let deferredPrompt = null, offlineReady = false, installed = false;

function update() {
  panel.hidden = installed || standalone.matches || navigator.standalone === true;
  button.hidden = !deferredPrompt;
  button.disabled = !offlineReady;
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredPrompt = event;
  update();
});
window.addEventListener('appinstalled', () => {
  installed = true; deferredPrompt = null; update();
});
standalone.addEventListener('change', update);
if ('serviceWorker' in navigator) navigator.serviceWorker.ready.then(() => {
  offlineReady = true;
  status.textContent = 'Site e questões preparados para uso offline. Os áudios podem ser salvos separadamente dentro do aplicativo.';
  update();
});

button.addEventListener('click', async () => {
  if (!deferredPrompt || !offlineReady) return;
  const prompt = deferredPrompt;
  deferredPrompt = null;
  update();
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    status.textContent = choice.outcome === 'accepted'
      ? 'Instalação solicitada. Depois, abra CIS DF pelo ícone no seu dispositivo.'
      : 'Você pode instalar depois pelo menu do navegador.';
  } catch {
    status.textContent = 'Use as instruções abaixo para instalar pelo menu do navegador.';
  }
});
update();
