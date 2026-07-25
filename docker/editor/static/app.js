const status = document.getElementById('status');
const liveToggle = document.getElementById('liveToggle');
const darkToggle = document.getElementById('darkToggle');
const pdfOnlyToggle = document.getElementById('pdfOnlyToggle');
const errorPanel = document.getElementById('errorPanel');

pdfOnlyToggle.checked = localStorage.getItem('latexbuild-pdfonly') === '1';
pdfOnlyToggle.addEventListener('change', () => {
  localStorage.setItem('latexbuild-pdfonly', pdfOnlyToggle.checked ? '1' : '0');
});

let isDirty = false;
let suppressDirty = true;
let isCompiling = false;

function systemPrefersDark() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(isDark) {
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
}

const storedTheme = localStorage.getItem('latexbuild-theme');
const initialDark = storedTheme ? storedTheme === 'dark' : systemPrefersDark();
darkToggle.checked = initialDark;
applyTheme(initialDark);

const cm = CodeMirror.fromTextArea(document.getElementById('editor'), {
  mode: 'stex',
  lineNumbers: true,
  theme: initialDark ? 'material-darker' : 'default',
});

darkToggle.addEventListener('change', () => {
  const isDark = darkToggle.checked;
  applyTheme(isDark);
  cm.setOption('theme', isDark ? 'material-darker' : 'default');
  localStorage.setItem('latexbuild-theme', isDark ? 'dark' : 'light');
});

const stoppedOverlay = document.getElementById('stoppedOverlay');
const compileNowBtn = document.getElementById('compileNow');

function markStopped() {
  if (stoppedOverlay.classList.contains('visible')) return;
  stoppedOverlay.classList.add('visible');
  cm.setOption('readOnly', true);
  liveToggle.disabled = true;
  compileNowBtn.disabled = true;
  pdfOnlyToggle.disabled = true;
  openFileBtn.disabled = true;
  status.className = 'err';
  status.textContent = 'stopped';
  waitForServer();
}

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

function loadSource() {
  suppressDirty = true;
  return fetch('/source').then(r => r.text()).then(t => {
    cm.setValue(t);
    suppressDirty = false;
  });
}

loadSource();

let debounceTimer = null;
cm.on('change', () => {
  if (!suppressDirty) isDirty = true;
  if (!liveToggle.checked) return;
  clearTimeout(debounceTimer);
  status.className = 'busy';
  status.textContent = 'editing...';
  debounceTimer = setTimeout(compile, 700);
});

document.getElementById('compileNow').addEventListener('click', compile);

function compile() {
  status.className = 'busy';
  status.textContent = 'building...';
  isCompiling = true;
  renderCurrentTree();
  fetch('/compile?pdf_only=' + (pdfOnlyToggle.checked ? '1' : '0'), { method: 'POST', body: cm.getValue() })
    .then(r => r.json())
    .then(data => {
      isCompiling = false;
      renderCurrentTree();
      if (data.ok) {
        isDirty = false;
        status.className = 'ok';
        status.textContent = 'built';
        errorPanel.classList.remove('visible');
        document.getElementById('pdfFrame').src = '/pdf?t=' + Date.now();
      } else {
        status.className = 'err';
        status.textContent = 'build failed';
        errorPanel.textContent = data.log;
        errorPanel.classList.add('visible');
        errorPanel.focus();
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

function saveFile() {
  return fetch('/save', { method: 'POST', body: cm.getValue() })
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        isDirty = false;
        status.className = 'ok';
        status.textContent = 'saved';
      }
      return data;
    });
}

window.addEventListener('beforeunload', (e) => {
  if (!isDirty) return;
  e.preventDefault();
  e.returnValue = '';
});

function wrapSelection(cmInstance, before, after) {
  const selections = cmInstance.listSelections().slice()
    .sort((a, b) => CodeMirror.cmpPos(b.from(), a.from()));
  cmInstance.operation(() => {
    selections.forEach(sel => {
      const from = sel.from(), to = sel.to();
      const text = cmInstance.getRange(from, to);
      cmInstance.replaceRange(before + text + after, from, to);
      if (text === '') {
        cmInstance.setCursor({ line: from.line, ch: from.ch + before.length });
      }
    });
  });
}

function toggleLineComment(cmInstance) {
  const lines = new Set();
  cmInstance.listSelections().forEach(sel => {
    for (let l = sel.from().line; l <= sel.to().line; l++) lines.add(l);
  });
  const lineNums = Array.from(lines);
  const allCommented = lineNums.every(l => /^\s*%/.test(cmInstance.getLine(l)));
  cmInstance.operation(() => {
    lineNums.forEach(l => {
      const lineText = cmInstance.getLine(l);
      if (allCommented) {
        const uncommented = lineText.replace(/^(\s*)%\s?/, '$1');
        cmInstance.replaceRange(uncommented, { line: l, ch: 0 }, { line: l, ch: lineText.length });
      } else {
        cmInstance.replaceRange('%', { line: l, ch: 0 });
      }
    });
  });
}

let editorFontSize = 14;
function zoomEditor(delta) {
  editorFontSize = delta === 0 ? 14 : Math.min(28, Math.max(9, editorFontSize + delta));
  cm.getWrapperElement().style.fontSize = editorFontSize + 'px';
  cm.refresh();
}

function toggleWordWrap() {
  cm.setOption('lineWrapping', !cm.getOption('lineWrapping'));
}

cm.setOption('extraKeys', {
  'Ctrl-A': 'selectAll',
  'Cmd-A': 'selectAll',
  'Ctrl-B': (c) => wrapSelection(c, '\\textbf{', '}'),
  'Cmd-B': (c) => wrapSelection(c, '\\textbf{', '}'),
  'Ctrl-I': (c) => wrapSelection(c, '\\textit{', '}'),
  'Cmd-I': (c) => wrapSelection(c, '\\textit{', '}'),
  'Ctrl-/': toggleLineComment,
  'Cmd-/': toggleLineComment,
  'Ctrl-Enter': () => compile(),
  'Cmd-Enter': () => compile(),
  'Ctrl-=': () => zoomEditor(1),
  'Cmd-=': () => zoomEditor(1),
  'Ctrl--': () => zoomEditor(-1),
  'Cmd--': () => zoomEditor(-1),
  'Ctrl-0': () => zoomEditor(0),
  'Cmd-0': () => zoomEditor(0),
});

const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
if (isMac) {
  document.querySelectorAll('.mod-key').forEach(el => { el.textContent = '⌘'; });
  document.querySelectorAll('.alt-key').forEach(el => { el.textContent = '⌥'; });
}

const shortcutsModal = document.getElementById('shortcutsModal');
const shortcutsBtn = document.getElementById('shortcutsBtn');
const shortcutsClose = document.getElementById('shortcutsClose');

function openShortcuts() { shortcutsModal.classList.add('visible'); }
function closeShortcuts() { shortcutsModal.classList.remove('visible'); }

shortcutsBtn.addEventListener('click', openShortcuts);
shortcutsClose.addEventListener('click', closeShortcuts);
shortcutsModal.addEventListener('click', (e) => {
  if (e.target === shortcutsModal) closeShortcuts();
});

const openFileBtn = document.getElementById('openFileBtn');
const fileInput = document.getElementById('fileInput');
const currentFileLabel = document.getElementById('currentFile');
const sidebar = document.getElementById('sidebar');
const sidebarCollapsed = document.getElementById('sidebarCollapsed');
const sidebarCollapseBtn = document.getElementById('sidebarCollapseBtn');
const sidebarExpandBtn = document.getElementById('sidebarExpandBtn');
const fileTreeEl = document.getElementById('fileTree');
const texOnlyToggle = document.getElementById('texOnlyToggle');
let sidebarInitialized = false;
let uploadInProgress = false;

texOnlyToggle.checked = localStorage.getItem('latexbuild-texonly') === '1';
texOnlyToggle.addEventListener('change', () => {
  localStorage.setItem('latexbuild-texonly', texOnlyToggle.checked ? '1' : '0');
  renderCurrentTree();
});

function setCurrentFileLabel(name) {
  currentFileLabel.textContent = name;
  currentFileLabel.title = name;
}

function showSidebarExpanded() {
  sidebar.hidden = false;
  sidebarCollapsed.hidden = true;
}

function showSidebarCollapsed() {
  sidebar.hidden = true;
  sidebarCollapsed.hidden = false;
}

sidebarCollapseBtn.addEventListener('click', showSidebarCollapsed);
sidebarExpandBtn.addEventListener('click', showSidebarExpanded);

function buildTree(paths) {
  const root = {};
  paths.forEach(path => {
    const parts = path.split('/');
    let node = root;
    parts.forEach((part, i) => {
      if (i === parts.length - 1) {
        node.__files = node.__files || [];
        node.__files.push({ name: part, path });
      } else {
        node[part] = node[part] || {};
        node = node[part];
      }
    });
  });
  return root;
}

const expandedFolders = new Set();

function renderTree(node, container, currentFile, depth = 0, pathPrefix = '') {
  const indent = 10 + depth * 14;

  Object.keys(node).filter(k => k !== '__files').sort().forEach(dirName => {
    const dirPath = pathPrefix ? pathPrefix + '/' + dirName : dirName;
    const row = document.createElement('div');
    row.className = 'tree-row tree-dir';
    row.style.paddingLeft = indent + 'px';
    const children = document.createElement('div');
    children.className = 'tree-children' + (expandedFolders.has(dirPath) ? '' : ' collapsed');
    const setLabel = () => {
      row.textContent = (children.classList.contains('collapsed') ? '▸' : '▾') + ' 📁 ' + dirName;
    };
    setLabel();
    row.addEventListener('click', () => {
      children.classList.toggle('collapsed');
      if (children.classList.contains('collapsed')) {
        expandedFolders.delete(dirPath);
      } else {
        expandedFolders.add(dirPath);
      }
      setLabel();
    });
    container.appendChild(row);
    container.appendChild(children);
    renderTree(node[dirName], children, currentFile, depth + 1, dirPath);
  });

  (node.__files || []).sort((a, b) => a.name.localeCompare(b.name)).forEach(f => {
    const isTex = f.name.toLowerCase().endsWith('.tex');
    const isActive = f.path === currentFile;
    const row = document.createElement('div');
    row.className = 'tree-row tree-file'
      + (isTex ? ' tex-file' : '')
      + (isActive ? ' active' : '');
    row.style.paddingLeft = indent + 'px';
    const icon = isActive && isCompiling ? '⏳ ' : (isTex ? '📄 ' : '　');
    row.textContent = icon + f.name;
    if (isTex) row.addEventListener('dblclick', () => selectFile(f.path));
    container.appendChild(row);
  });
}

let lastTreeFiles = [];
let lastTreeCurrent = null;

function renderCurrentTree() {
  fileTreeEl.innerHTML = '';
  const files = texOnlyToggle.checked
    ? lastTreeFiles.filter(f => f.toLowerCase().endsWith('.tex'))
    : lastTreeFiles;
  renderTree(buildTree(files), fileTreeEl, lastTreeCurrent);
}

function loadTree() {
  return fetch('/tree').then(r => r.json()).then(data => {
    lastTreeFiles = data.files;
    lastTreeCurrent = data.current;
    renderCurrentTree();
    if (!sidebarInitialized && data.files.length > 0) {
      sidebarInitialized = true;
      showSidebarExpanded();
    }
  });
}

function selectFile(path) {
  if (isCompiling && path === lastTreeCurrent) return;
  if (uploadInProgress) return;
  if (isDirty && !confirm('Discard unsaved changes and open "' + path + '"?')) return;
  fetch('/select', { method: 'POST', body: path })
    .then(r => r.json())
    .then(data => {
      if (!data.ok) return;
      isDirty = false;
      errorPanel.classList.remove('visible');
      loadSource();
      setCurrentFileLabel(data.file);
      document.getElementById('pdfFrame').src = '/pdf?t=' + Date.now();
      status.className = 'ok';
      status.textContent = 'opened';
      loadTree();
    });
}

fetch('/current').then(r => r.json()).then(data => setCurrentFileLabel(data.file));
loadTree();

function triggerOpenFile() {
  if (isDirty && !confirm('Discard unsaved changes and open a different folder?')) return;
  fileInput.click();
}

openFileBtn.addEventListener('click', triggerOpenFile);

fileInput.addEventListener('change', async () => {
  const files = Array.from(fileInput.files);
  fileInput.value = '';
  if (files.length === 0) return;

  uploadInProgress = true;
  compileNowBtn.disabled = true;
  openFileBtn.disabled = true;
  status.className = 'busy';
  status.textContent = 'clearing workspace...';

  await fetch('/clear-workspace', { method: 'POST' });

  const relPathOf = (f) => f.webkitRelativePath.split('/').slice(1).join('/');
  const isHidden = (rel) => rel.split('/').some(part => part.startsWith('.'));

  let uploaded = 0;
  for (const file of files) {
    const rel = relPathOf(file);
    if (!rel || isHidden(rel)) continue;
    await fetch('/upload?name=' + encodeURIComponent(rel), { method: 'POST', body: file });
    uploaded++;
    status.textContent = 'uploading ' + uploaded + '/' + files.length + '...';
  }

  uploadInProgress = false;
  compileNowBtn.disabled = false;
  openFileBtn.disabled = false;

  const texPaths = files
    .map(relPathOf)
    .filter(p => p && !isHidden(p) && p.toLowerCase().endsWith('.tex'))
    .sort();

  if (texPaths.length > 0) {
    selectFile(texPaths[0]);
  } else {
    loadTree();
    status.className = 'err';
    status.textContent = 'no .tex file found';
  }
});

window.addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey || e.metaKey;

  if (ctrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveFile();
    return;
  }

  if (ctrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    triggerOpenFile();
    return;
  }

  if (e.altKey && !ctrl && !e.shiftKey && e.code === 'KeyZ') {
    e.preventDefault();
    toggleWordWrap();
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
});
