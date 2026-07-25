const status = document.getElementById('status');
const liveToggle = document.getElementById('liveToggle');
const darkToggle = document.getElementById('darkToggle');
const pdfOnlyToggle = document.getElementById('pdfOnlyToggle');
const errorPanel = document.getElementById('errorPanel');
const compileOverlay = document.getElementById('compileOverlay');

pdfOnlyToggle.checked = localStorage.getItem('latexbuild-pdfonly') === '1';
pdfOnlyToggle.addEventListener('change', () => {
  localStorage.setItem('latexbuild-pdfonly', pdfOnlyToggle.checked ? '1' : '0');
});

let isDirty = false;
let suppressDirty = true;
let activeCompileState = 'idle';
let compilingFiles = new Set();
let pollTimer = null;

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

const pdfZoomInBtn = document.getElementById('pdfZoomIn');
const pdfZoomOutBtn = document.getElementById('pdfZoomOut');
const pdfZoomLabel = document.getElementById('pdfZoomLabel');
const pdfScrollEl = document.getElementById('pdfScroll');
const pdfPagesEl = document.getElementById('pdfPages');

const PDF_BASE_SCALE = 1.25;
let pdfScale = PDF_BASE_SCALE;
let pdfDoc = null;
let pdfPageDivs = [];
let pdfObserver = null;

function capturePdfScrollPosition() {
  if (!pdfPageDivs.length) return null;
  const scrollTop = pdfScrollEl.scrollTop;
  for (let i = 0; i < pdfPageDivs.length; i++) {
    const wrapper = pdfPageDivs[i];
    const top = wrapper.offsetTop;
    const bottom = top + wrapper.offsetHeight;
    if (bottom > scrollTop) return { page: i + 1, offset: scrollTop - top };
  }
  return null;
}

function restorePdfScrollPosition(saved) {
  if (!saved) return;
  const wrapper = pdfPageDivs[saved.page - 1];
  if (!wrapper) return;
  pdfScrollEl.scrollTop = wrapper.offsetTop + saved.offset;
}

async function renderPdfPage(pageNumber) {
  const wrapper = pdfPageDivs[pageNumber - 1];
  if (!wrapper || wrapper.dataset.rendered === '1') return;
  wrapper.dataset.rendered = '1';
  const page = await pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: pdfScale });
  const canvas = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.ceil(viewport.width * dpr);
  canvas.height = Math.ceil(viewport.height * dpr);
  canvas.style.width = viewport.width + 'px';
  canvas.style.height = viewport.height + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  wrapper.innerHTML = '';
  wrapper.appendChild(canvas);
  await page.render({ canvasContext: ctx, viewport }).promise;
}

async function layoutPdfPages(preserveScroll) {
  const saved = preserveScroll ? capturePdfScrollPosition() : null;
  if (pdfObserver) pdfObserver.disconnect();
  pdfPagesEl.innerHTML = '';
  pdfPageDivs = [];

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale: pdfScale });
    const wrapper = document.createElement('div');
    wrapper.className = 'pdf-page';
    wrapper.dataset.pageNumber = String(i);
    wrapper.style.width = viewport.width + 'px';
    wrapper.style.height = viewport.height + 'px';
    wrapper.addEventListener('dblclick', (e) => onPdfDoubleClick(e, i, wrapper));
    pdfPagesEl.appendChild(wrapper);
    pdfPageDivs.push(wrapper);
  }

  pdfObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) renderPdfPage(Number(entry.target.dataset.pageNumber));
    });
  }, { root: pdfScrollEl, rootMargin: '800px 0px' });
  pdfPageDivs.forEach(w => pdfObserver.observe(w));

  if (saved) restorePdfScrollPosition(saved);
}

function setPdfZoomLabel() {
  pdfZoomLabel.textContent = Math.round((pdfScale / PDF_BASE_SCALE) * 100) + '%';
}

function setPdfZoom(scale) {
  pdfScale = Math.min(3, Math.max(0.5, scale));
  setPdfZoomLabel();
  if (pdfDoc) layoutPdfPages(true);
}

pdfZoomInBtn.addEventListener('click', () => setPdfZoom(pdfScale + 0.15));
pdfZoomOutBtn.addEventListener('click', () => setPdfZoom(pdfScale - 0.15));
setPdfZoomLabel();

async function refreshPdf(preserveScroll) {
  if (!window.pdfjsLib) return;
  const url = '/pdf?t=' + Date.now();
  try {
    pdfDoc = await window.pdfjsLib.getDocument(url).promise;
    await layoutPdfPages(preserveScroll !== false);
  } catch (e) {
    /* no pdf available yet */
  }
}

function onPdfDoubleClick(e, pageNumber, wrapper) {
  const rect = wrapper.getBoundingClientRect();
  const pdfX = (e.clientX - rect.left) / pdfScale;
  const pdfY = (e.clientY - rect.top) / pdfScale;
  fetch(`/synctex/inverse?page=${pageNumber}&x=${pdfX}&y=${pdfY}`)
    .then(r => r.json())
    .then(data => {
      if (data.ok) jumpEditorToLine(data.line);
    });
}

function jumpEditorToLine(line) {
  const lineIndex = Math.max(0, line - 1);
  cm.setCursor({ line: lineIndex, ch: 0 });
  cm.scrollIntoView({ line: lineIndex, ch: 0 }, 120);
  cm.focus();
  cm.addLineClass(lineIndex, 'background', 'sync-flash');
  setTimeout(() => cm.removeLineClass(lineIndex, 'background', 'sync-flash'), 700);
}

function forwardSearch(line, column) {
  fetch(`/synctex/forward?line=${line}&column=${column}`)
    .then(r => r.json())
    .then(data => {
      if (data.ok) scrollPdfToPosition(data.page, data.x, data.y);
    });
}

function scrollPdfToPosition(page, x, y) {
  const wrapper = pdfPageDivs[page - 1];
  if (!wrapper) return;
  const cssX = x * pdfScale;
  const cssY = y * pdfScale;
  pdfScrollEl.scrollTop = Math.max(0, wrapper.offsetTop + cssY - pdfScrollEl.clientHeight / 3);
  const marker = document.createElement('div');
  marker.className = 'sync-marker';
  marker.style.left = cssX + 'px';
  marker.style.top = cssY + 'px';
  wrapper.appendChild(marker);
  setTimeout(() => marker.remove(), 900);
}

cm.getWrapperElement().addEventListener('mousedown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const pos = cm.coordsChar({ left: e.clientX, top: e.clientY });
  forwardSearch(pos.line + 1, pos.ch + 1);
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
  if (!lastTreeCurrent) return;
  clearTimeout(debounceTimer);
  status.className = 'busy';
  status.textContent = 'editing...';
  debounceTimer = setTimeout(compile, 700);
});

document.getElementById('compileNow').addEventListener('click', () => compile(true));

function compile(manual) {
  status.className = 'busy';
  status.textContent = 'building...';
  const params = new URLSearchParams({
    pdf_only: pdfOnlyToggle.checked ? '1' : '0',
    manual: manual ? '1' : '0',
  });
  fetch('/compile?' + params.toString(), { method: 'POST', body: cm.getValue() })
    .then(r => r.json())
    .then(data => {
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

function updateCompileOverlay() {
  const busy = activeCompileState === 'queued' || activeCompileState === 'compiling';
  compileOverlay.classList.toggle('visible', busy);
  if (busy) errorPanel.classList.remove('visible');
}

function setActiveCompileState(state) {
  activeCompileState = state;
  updateCompileOverlay();
  if (state === 'idle') return;
  status.className = 'busy';
  status.textContent = state === 'queued' ? 'queued...' : 'building...';
}

function finishActiveCompile(file) {
  activeCompileState = 'idle';
  updateCompileOverlay();
  if (!file) return;
  fetch('/compile-status?file=' + encodeURIComponent(file))
    .then(r => r.json())
    .then(data => {
      if (data.state !== 'done') return;
      if (data.ok) {
        isDirty = false;
        status.className = 'ok';
        status.textContent = 'built';
        errorPanel.classList.remove('visible');
        refreshPdf(true);
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
    compilingFiles = new Set(data.queued);
    renderCurrentTree();

    const stillBusy = lastTreeCurrent && compilingFiles.has(lastTreeCurrent);
    if (stillBusy) {
      setActiveCompileState(data.compiling === lastTreeCurrent ? 'compiling' : 'queued');
    } else if (activeCompileState !== 'idle') {
      finishActiveCompile(lastTreeCurrent);
    }

    if (compilingFiles.size === 0) stopPolling();
  });
}

function startPolling() {
  if (pollTimer) return;
  pollTick();
  pollTimer = setInterval(pollTick, 500);
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

function initCompilePolling() {
  fetch('/compile-queue').then(r => r.json()).then(data => {
    compilingFiles = new Set(data.queued);
    renderCurrentTree();
    if (lastTreeCurrent && compilingFiles.has(lastTreeCurrent)) {
      setActiveCompileState(data.compiling === lastTreeCurrent ? 'compiling' : 'queued');
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

function saveFile() {
  return fetch('/save', { method: 'POST', body: cm.getValue() })
    .then(r => r.json())
    .then(async (data) => {
      if (!data.ok) return data;
      isDirty = false;
      const handle = activeFileHandles.get(lastTreeCurrent);
      if (handle) {
        try {
          const writable = await handle.createWritable();
          await writable.write(cm.getValue());
          await writable.close();
          status.className = 'ok';
          status.textContent = 'saved to disk';
        } catch (e) {
          status.className = 'err';
          status.textContent = 'saved (could not write host file)';
        }
      } else {
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
  'Ctrl-F': 'findPersistent',
  'Cmd-F': 'findPersistent',
  'Ctrl-G': 'findNext',
  'Cmd-G': 'findNext',
  'Shift-Ctrl-G': 'findPrev',
  'Shift-Cmd-G': 'findPrev',
  'Ctrl-B': (c) => wrapSelection(c, '\\textbf{', '}'),
  'Cmd-B': (c) => wrapSelection(c, '\\textbf{', '}'),
  'Ctrl-I': (c) => wrapSelection(c, '\\textit{', '}'),
  'Cmd-I': (c) => wrapSelection(c, '\\textit{', '}'),
  'Ctrl-/': toggleLineComment,
  'Cmd-/': toggleLineComment,
  'Ctrl-Enter': () => compile(true),
  'Cmd-Enter': () => compile(true),
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
  currentFileLabel.textContent = name || 'No file open';
  currentFileLabel.title = name || '';
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
    const icon = compilingFiles.has(f.path) ? '⏳ ' : (isTex ? '📄 ' : '　');
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
  if (activeCompileState !== 'idle' && path === lastTreeCurrent) return;
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
      loadTree();

      if (data.compile_state === 'idle') {
        setActiveCompileState('idle');
        refreshPdf(false);
        status.className = 'ok';
        status.textContent = 'opened';
      } else {
        setActiveCompileState(data.compile_state);
        startPolling();
      }
    });
}

fetch('/current').then(r => r.json()).then(data => {
  setCurrentFileLabel(data.file);
  if (data.file) refreshPdf(false);
});
loadTree().then(initCompilePolling);

let activeFileHandles = new Map();
const supportsFileSystemAccess = 'showDirectoryPicker' in window;

if (supportsFileSystemAccess) {
  openFileBtn.title = 'Open a project folder from your computer (includes images, .bib, etc.) '
    + '— Ctrl+S saves directly back to these files on disk.';
} else {
  openFileBtn.title = 'Open a project folder from your computer (includes images, .bib, etc.) '
    + '— this browser only supports uploading a copy; Ctrl+S saves within the session only.';
}

function triggerOpenFile() {
  if (isDirty && !confirm('Discard unsaved changes and open a different folder?')) return;
  if (supportsFileSystemAccess) {
    openViaFileSystemAccess();
  } else {
    fileInput.click();
  }
}

openFileBtn.addEventListener('click', triggerOpenFile);

async function collectDirectoryEntries(dirHandle, prefix) {
  const results = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (name.startsWith('.')) continue;
    const relPath = prefix ? prefix + '/' + name : name;
    if (handle.kind === 'directory') {
      results.push(...await collectDirectoryEntries(handle, relPath));
    } else {
      results.push({ path: relPath, handle });
    }
  }
  return results;
}

async function openViaFileSystemAccess() {
  let dirHandle;
  try {
    dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (e) {
    return;
  }

  uploadInProgress = true;
  compileNowBtn.disabled = true;
  openFileBtn.disabled = true;
  status.className = 'busy';
  status.textContent = 'clearing workspace...';

  await fetch('/clear-workspace', { method: 'POST' });
  activeFileHandles = new Map();

  status.textContent = 'reading folder...';
  const entries = await collectDirectoryEntries(dirHandle, '');

  let uploaded = 0;
  for (const { path, handle } of entries) {
    const file = await handle.getFile();
    await fetch('/upload?name=' + encodeURIComponent(path), { method: 'POST', body: file });
    activeFileHandles.set(path, handle);
    uploaded++;
    status.textContent = 'uploading ' + uploaded + '/' + entries.length + '...';
  }

  uploadInProgress = false;
  compileNowBtn.disabled = false;
  openFileBtn.disabled = false;

  const texPaths = entries.map(e => e.path).filter(p => p.toLowerCase().endsWith('.tex')).sort();

  if (texPaths.length > 0) {
    selectFile(texPaths[0]);
  } else {
    loadTree();
    status.className = 'err';
    status.textContent = 'no .tex file found';
  }
}

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
  activeFileHandles = new Map();

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
