import { initEditorKeymap, toggleWordWrap } from './editor.js';
import { compile, initCompilePolling, saveFile } from './build.js';
import { openTab, setCurrentFileLabel } from './tabs.js';
import { loadTree } from './filetree.js';
import { refreshPdf } from './pdf.js';
import { toggleSidebar } from './sidebar.js';
import {
  anyMenuOpen, appearanceModal, closeAllMenus, closeAppearance, closeShortcuts, openShortcuts, shortcutsModal,
} from './menu.js';
import './session.js';

initEditorKeymap({
  'Ctrl-Enter': () => compile(),
  'Cmd-Enter': () => compile(),
});

const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
if (isMac) {
  document.querySelectorAll('.mod-key').forEach(el => { el.textContent = '⌘'; });
  document.querySelectorAll('.alt-key').forEach(el => { el.textContent = '⌥'; });
}

fetch('/current').then(r => r.json()).then(data => {
  setCurrentFileLabel(data.file);
  (data.open_tabs || []).forEach(path => openTab(path));
  if (data.file) {
    openTab(data.file);
    if (data.file === data.tex_file) refreshPdf(false, false);
  }
});
loadTree().then(initCompilePolling);

window.addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey || e.metaKey;

  if (ctrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveFile();
    return;
  }

  if (e.altKey && !ctrl && !e.shiftKey && e.code === 'KeyZ') {
    e.preventDefault();
    toggleWordWrap();
    return;
  }

  if (ctrl && !e.shiftKey && !e.altKey && e.code === 'Backslash') {
    e.preventDefault();
    toggleSidebar();
    return;
  }

  if (e.key === 'F1') {
    e.preventDefault();
    openShortcuts();
    return;
  }

  if (e.key === 'Escape' && shortcutsModal.classList.contains('visible')) {
    closeShortcuts();
  }

  if (e.key === 'Escape' && appearanceModal.classList.contains('visible')) {
    closeAppearance();
  }

  if (e.key === 'Escape' && anyMenuOpen()) {
    closeAllMenus();
  }
});
