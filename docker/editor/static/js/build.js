import { cm } from './editor.js';
import { refreshPdf } from './pdf.js';
import { renderCurrentTree, loadTree } from './filetree.js';
import {
  isDirty, setDirty, suppressDirty,
  activeCompileState, setActiveCompileStateValue,
  compilingFiles, setCompilingFiles,
  lastTreeCurrent, lastTreeTexFile,
} from './state.js';

const status = document.getElementById('status');
const liveToggle = document.getElementById('liveToggle');
const errorPanel = document.getElementById('errorPanel');
const compileOverlay = document.getElementById('compileOverlay');
const compileNowBtn = document.getElementById('compileNow');

let debounceTimer = null;
let pollTimer = null;

export async function persistCurrentEditingFile() {
  const content = cm.getValue();
  const resp = await fetch('/save', { method: 'POST', body: content });
  return resp.json();
}

export function saveFile() {
  return persistCurrentEditingFile().then(data => {
    if (!data.ok) {
      status.className = 'err';
      status.textContent = data.log || 'save failed';
      return data;
    }
    setDirty(false);
    status.className = 'ok';
    status.textContent = 'saved';
    return data;
  });
}

window.addEventListener('beforeunload', (e) => {
  if (!isDirty) return;
  e.preventDefault();
  e.returnValue = '';
});

export function compile() {
  status.className = 'busy';
  status.textContent = 'building...';
  const persist = isDirty ? persistCurrentEditingFile() : Promise.resolve({ ok: true });
  persist
    .then(persistData => {
      if (!persistData.ok) {
        status.className = 'err';
        status.textContent = persistData.log || 'save failed';
        return null;
      }
      return fetch('/compile', { method: 'POST' }).then(r => r.json());
    })
    .then(data => {
      if (!data) return;
      if (!data.ok) {
        status.className = 'err';
        status.textContent = data.log || 'compile request failed';
        return;
      }
      startPolling();
    })
    .catch(() => {
      status.className = 'err';
      status.textContent = 'compile request failed';
    });
}

cm.on('change', () => {
  if (suppressDirty) return;
  setDirty(true);
  if (!liveToggle.checked) return;
  if (!lastTreeCurrent) return;
  clearTimeout(debounceTimer);
  status.className = 'busy';
  status.textContent = 'editing...';
  debounceTimer = setTimeout(() => compile(), 700);
});

compileNowBtn.addEventListener('click', () => compile());

function updateCompileOverlay() {
  const busy = activeCompileState === 'queued' || activeCompileState === 'compiling';
  compileOverlay.classList.toggle('visible', busy);
}

export function setActiveCompileState(state) {
  setActiveCompileStateValue(state);
  updateCompileOverlay();
  if (state === 'idle') return;
  status.className = 'busy';
  status.textContent = state === 'queued' ? 'queued...' : 'building...';
}

function finishActiveCompile(file) {
  setActiveCompileStateValue('idle');
  updateCompileOverlay();
  if (!file) return;
  fetch('/compile-status?file=' + encodeURIComponent(file))
    .then(r => r.json())
    .then(data => {
      if (data.state !== 'done') return;
      loadTree();
      if (data.ok) {
        if (lastTreeCurrent === file) setDirty(false);
        status.className = 'ok';
        status.textContent = 'built';
        errorPanel.classList.remove('visible');
        refreshPdf(true, true);
      } else {
        status.className = 'err';
        status.textContent = 'build failed';
        errorPanel.textContent = data.log;
        errorPanel.classList.add('visible');
        errorPanel.focus();
      }
    });
}

function pollTick() {
  fetch('/compile-queue').then(r => r.json()).then(data => {
    setCompilingFiles(new Set(data.queued));
    renderCurrentTree();

    if (lastTreeCurrent === lastTreeTexFile) {
      const stillBusy = lastTreeTexFile && compilingFiles.has(lastTreeTexFile);
      if (stillBusy) {
        setActiveCompileState(data.compiling.includes(lastTreeTexFile) ? 'compiling' : 'queued');
      } else if (activeCompileState !== 'idle') {
        finishActiveCompile(lastTreeTexFile);
      }
    }

    if (compilingFiles.size === 0) stopPolling();
  });
}

export function startPolling() {
  if (pollTimer) return;
  pollTick();
  pollTimer = setInterval(pollTick, 500);
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

export function initCompilePolling() {
  fetch('/compile-queue').then(r => r.json()).then(data => {
    setCompilingFiles(new Set(data.queued));
    renderCurrentTree();
    if (lastTreeTexFile && compilingFiles.has(lastTreeTexFile)) {
      if (lastTreeCurrent === lastTreeTexFile) {
        setActiveCompileState(data.compiling.includes(lastTreeTexFile) ? 'compiling' : 'queued');
      }
      startPolling();
    }
  });
}

errorPanel.addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    const range = document.createRange();
    range.selectNodeContents(errorPanel);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
});
