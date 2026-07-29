import { loadSource } from './editor.js';
import { clearPdfView, refreshPdf } from './pdf.js';
import { compile, setActiveCompileState, startPolling } from './build.js';
import { loadTree } from './filetree.js';
import {
  openTabs, setOpenTabs,
  isDirty, setDirty, setSuppressDirty,
  lastTreeCurrent,
  activeCompileState,
  uploadInProgress,
} from './state.js';
import { cm } from './editor.js';

const tabBarEl = document.getElementById('tabBar');
const currentFileLabel = document.getElementById('currentFile');
const errorPanel = document.getElementById('errorPanel');
const liveToggle = document.getElementById('liveToggle');
const status = document.getElementById('status');

export function renderTabBar() {
  tabBarEl.innerHTML = '';
  openTabs.forEach(path => {
    const name = path.split('/').pop();
    const isBib = name.toLowerCase().endsWith('.bib');
    const isActive = path === lastTreeCurrent;

    const tab = document.createElement('div');
    tab.className = 'tab' + (isActive ? ' active' : '');
    tab.title = path;
    tab.addEventListener('click', () => {
      if (path !== lastTreeCurrent) selectFile(path);
    });

    const icon = document.createElement('span');
    icon.textContent = isBib ? '📚' : '📄';
    tab.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = name;
    tab.appendChild(label);

    const closeBtn = document.createElement('span');
    closeBtn.className = 'tab-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(path);
    });
    tab.appendChild(closeBtn);

    tabBarEl.appendChild(tab);
  });
}

export function persistOpenTabs() {
  fetch('/state/tabs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tabs: openTabs }),
  });
}

export function openTab(path) {
  if (!openTabs.includes(path)) openTabs.push(path);
  renderTabBar();
  persistOpenTabs();
}

export function closeTab(path) {
  const idx = openTabs.indexOf(path);
  if (idx === -1) return;
  const wasActive = path === lastTreeCurrent;
  if (wasActive && isDirty && !confirm('Discard unsaved changes and close "' + path + '"?')) return;
  openTabs.splice(idx, 1);
  renderTabBar();
  persistOpenTabs();
  if (!wasActive) return;
  const next = openTabs[idx] || openTabs[idx - 1];
  if (next) {
    setDirty(false);
    selectFile(next);
  } else {
    resetToNoFileOpen();
    loadTree();
  }
}

export function setCurrentFileLabel(name) {
  currentFileLabel.textContent = name || 'No file open';
  currentFileLabel.title = name || '';
}

export function resetToNoFileOpen() {
  setSuppressDirty(true);
  cm.setValue('');
  cm.clearHistory();
  setSuppressDirty(false);
  setDirty(false);
  setCurrentFileLabel(null);
  errorPanel.classList.remove('visible');
  setActiveCompileState('idle');
  clearPdfView();
  setOpenTabs([]);
  renderTabBar();
  persistOpenTabs();
  fetch('/deselect', { method: 'POST' });
}

let selectRequestToken = 0;

export function selectFile(path) {
  if (activeCompileState !== 'idle' && path === lastTreeCurrent) return;
  if (uploadInProgress) return;
  if (isDirty && !confirm('Discard unsaved changes and open "' + path + '"?')) return;
  const token = ++selectRequestToken;
  fetch('/select', { method: 'POST', body: path })
    .then(r => r.json())
    .then(async (data) => {
      if (!data.ok || token !== selectRequestToken) return;
      setDirty(false);
      errorPanel.classList.remove('visible');
      await loadSource();
      if (token !== selectRequestToken) return;
      setCurrentFileLabel(data.file);
      openTab(data.file);
      loadTree();

      if (!data.is_tex) {
        setActiveCompileState('idle');
        clearPdfView();
        status.className = 'ok';
        status.textContent = 'opened';
        return;
      }

      if (data.compile_state === 'idle') {
        setActiveCompileState('idle');
        refreshPdf(false, false);
        status.className = 'ok';
        status.textContent = 'opened';
        if (liveToggle.checked) compile();
      } else {
        setActiveCompileState(data.compile_state);
        startPolling();
      }
    });
}
