import { cm } from './editor.js';

const status = document.getElementById('status');
const stoppedOverlay = document.getElementById('stoppedOverlay');
const expiredOverlay = document.getElementById('expiredOverlay');
const expiredReloadBtn = document.getElementById('expiredReloadBtn');

function disableEditingUI() {
  cm.setOption('readOnly', true);
  document.getElementById('liveToggle').disabled = true;
  document.getElementById('compileNow').disabled = true;
  document.getElementById('newFileBtn').disabled = true;
  document.getElementById('newFolderBtn').disabled = true;
  document.getElementById('uploadBtn').disabled = true;
  document.getElementById('uploadFolderBtn').disabled = true;
}

function markStopped() {
  if (stoppedOverlay.classList.contains('visible') || expiredOverlay.classList.contains('visible')) return;
  stoppedOverlay.classList.add('visible');
  disableEditingUI();
  status.className = 'err';
  status.textContent = 'stopped';
  waitForServer();
}

function markExpired() {
  if (stoppedOverlay.classList.contains('visible') || expiredOverlay.classList.contains('visible')) return;
  expiredOverlay.classList.add('visible');
  disableEditingUI();
  status.className = 'err';
  status.textContent = 'expired';
}

expiredReloadBtn.addEventListener('click', () => location.reload());

function waitForServer() {
  setTimeout(() => {
    fetch('/', { cache: 'no-store' })
      .then(() => location.reload())
      .catch(waitForServer);
  }, 1500);
}

const wsProtocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
const sessionSocket = new WebSocket(wsProtocol + location.host + '/ws');
sessionSocket.onclose = markStopped;
sessionSocket.onerror = markStopped;
sessionSocket.onmessage = (event) => {
  try {
    const data = JSON.parse(event.data);
    if (data.type === 'expired') markExpired();
  } catch (e) {}
};
