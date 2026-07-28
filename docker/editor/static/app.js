const status = document.getElementById('status');
const liveToggle = document.getElementById('liveToggle');
const darkToggle = document.getElementById('darkToggle');
const errorPanel = document.getElementById('errorPanel');
const compileOverlay = document.getElementById('compileOverlay');

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
const stalePdfNotice = document.getElementById('stalePdfNotice');
const pdfDownloadBtn = document.getElementById('pdfDownloadBtn');
const pdfPrintBtn = document.getElementById('pdfPrintBtn');

pdfDownloadBtn.addEventListener('click', () => {
  if (!lastTreeTexFile) return;
  downloadPath(lastTreeTexFile.replace(/\.tex$/i, '.pdf'));
});

pdfPrintBtn.addEventListener('click', () => {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write('<html><head><title>Print PDF</title></head>'
    + '<body style="margin:0"><iframe src="/pdf" style="border:none;width:100%;height:100vh;"></iframe></body></html>');
  w.document.close();
  const iframe = w.document.querySelector('iframe');
  iframe.onload = () => {
    w.focus();
    iframe.contentWindow.print();
  };
});

const PDF_BASE_SCALE = 1.25;
let pdfScale = PDF_BASE_SCALE;
let pdfDoc = null;
let pdfPageDivs = [];
let pdfObserver = null;
let pdfIsFresh = false;

function updateStalePdfNotice() {
  stalePdfNotice.classList.toggle('visible', pdfDoc !== null && !pdfIsFresh);
}

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

  const textLayerDiv = document.createElement('div');
  textLayerDiv.className = 'textLayer';
  wrapper.appendChild(textLayerDiv);
  const textLayer = new window.pdfjsLib.TextLayer({
    textContentSource: page.streamTextContent({ includeMarkedContent: true, disableNormalization: true }),
    container: textLayerDiv,
    viewport,
  });
  await textLayer.render();
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

pdfScrollEl.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  setPdfZoom(pdfScale * (1 - e.deltaY * 0.0015));
}, { passive: false });

async function refreshPdf(preserveScroll, isFresh) {
  if (!window.pdfjsLib) return;
  const url = '/pdf?t=' + Date.now();
  try {
    pdfDoc = await window.pdfjsLib.getDocument(url).promise;
    await layoutPdfPages(preserveScroll !== false);
    pdfIsFresh = !!isFresh;
    updateStalePdfNotice();
  } catch (e) {
    pdfDoc = null;
    updateStalePdfNotice();
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
const expiredOverlay = document.getElementById('expiredOverlay');
const expiredReloadBtn = document.getElementById('expiredReloadBtn');
const compileNowBtn = document.getElementById('compileNow');

function disableEditingUI() {
  cm.setOption('readOnly', true);
  liveToggle.disabled = true;
  compileNowBtn.disabled = true;
  newFileBtn.disabled = true;
  newFolderBtn.disabled = true;
  uploadBtn.disabled = true;
  uploadFolderBtn.disabled = true;
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

let loadSourceToken = 0;

function loadSource() {
  const token = ++loadSourceToken;
  suppressDirty = true;
  return fetch('/source').then(r => r.text()).then(t => {
    if (token !== loadSourceToken) return;
    cm.setValue(t);
    cm.clearHistory();
    suppressDirty = false;
  });
}

loadSource();

let debounceTimer = null;
cm.on('change', () => {
  if (suppressDirty) return;
  isDirty = true;
  if (!liveToggle.checked) return;
  if (!lastTreeCurrent) return;
  clearTimeout(debounceTimer);
  status.className = 'busy';
  status.textContent = 'editing...';
  debounceTimer = setTimeout(compile, 700);
});

document.getElementById('compileNow').addEventListener('click', () => compile());

function compile() {
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

function updateCompileOverlay() {
  const busy = activeCompileState === 'queued' || activeCompileState === 'compiling';
  compileOverlay.classList.toggle('visible', busy);
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
      loadTree();
      if (data.ok) {
        if (lastTreeCurrent === file) isDirty = false;
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
    compilingFiles = new Set(data.queued);
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

pdfScrollEl.addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    const range = document.createRange();
    range.selectNodeContents(pdfPagesEl);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
});

async function persistCurrentEditingFile() {
  const content = cm.getValue();
  const resp = await fetch('/save', { method: 'POST', body: content });
  return resp.json();
}

function saveFile() {
  return persistCurrentEditingFile().then(data => {
    if (!data.ok) {
      status.className = 'err';
      status.textContent = data.log || 'save failed';
      return data;
    }
    isDirty = false;
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

const currentFileLabel = document.getElementById('currentFile');
const sidebar = document.getElementById('sidebar');
const sidebarCollapsed = document.getElementById('sidebarCollapsed');
const sidebarDragDivider = document.getElementById('sidebarDragDivider');
const sidebarCollapseBtn = document.getElementById('sidebarCollapseBtn');
const sidebarExpandBtn = document.getElementById('sidebarExpandBtn');
const fileTreeEl = document.getElementById('fileTree');
const tabBarEl = document.getElementById('tabBar');
const newFileBtn = document.getElementById('newFileBtn');
const newFolderBtn = document.getElementById('newFolderBtn');
const uploadBtn = document.getElementById('uploadBtn');
const uploadInput = document.getElementById('uploadInput');
const uploadFolderBtn = document.getElementById('uploadFolderBtn');
const uploadFolderInput = document.getElementById('uploadFolderInput');
const searchToggleBtn = document.getElementById('searchToggleBtn');
const searchRow = document.getElementById('searchRow');
const searchInput = document.getElementById('searchInput');
const searchClearBtn = document.getElementById('searchClearBtn');
let sidebarInitialized = false;
let uploadInProgress = false;
let openTabs = [];

function renderTabBar() {
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

function persistOpenTabs() {
  fetch('/state/tabs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tabs: openTabs }),
  });
}

function openTab(path) {
  if (!openTabs.includes(path)) openTabs.push(path);
  renderTabBar();
  persistOpenTabs();
}

function closeTab(path) {
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
    isDirty = false;
    selectFile(next);
  } else {
    resetToNoFileOpen();
    loadTree();
  }
}

let searchQuery = '';

function setSearchQuery(q) {
  searchQuery = q;
  if (q) {
    const { dirs } = getFilteredTreeData();
    dirs.forEach(d => expandedFolders.add(d));
  }
  renderCurrentTree();
}

function showSearchRow() {
  searchRow.hidden = false;
  searchToggleBtn.classList.add('active');
  searchInput.focus();
}

function hideSearchRow() {
  searchRow.hidden = true;
  searchToggleBtn.classList.remove('active');
  searchInput.value = '';
  setSearchQuery('');
}

searchToggleBtn.addEventListener('click', () => {
  if (searchRow.hidden) {
    showSearchRow();
  } else {
    hideSearchRow();
  }
});

searchInput.addEventListener('input', () => {
  setSearchQuery(searchInput.value.trim());
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideSearchRow();
});

searchClearBtn.addEventListener('click', () => {
  searchInput.value = '';
  setSearchQuery('');
  searchInput.focus();
});

function setCurrentFileLabel(name) {
  currentFileLabel.textContent = name || 'No file open';
  currentFileLabel.title = name || '';
}

function clearPdfView() {
  pdfDoc = null;
  pdfIsFresh = false;
  updateStalePdfNotice();
  pdfPageDivs = [];
  if (pdfObserver) pdfObserver.disconnect();
  pdfPagesEl.innerHTML = '';
}

function resetToNoFileOpen() {
  suppressDirty = true;
  cm.setValue('');
  cm.clearHistory();
  suppressDirty = false;
  isDirty = false;
  setCurrentFileLabel(null);
  errorPanel.classList.remove('visible');
  activeCompileState = 'idle';
  updateCompileOverlay();
  clearPdfView();
  openTabs = [];
  renderTabBar();
  persistOpenTabs();
  fetch('/deselect', { method: 'POST' });
}

function showSidebarExpanded() {
  sidebar.hidden = false;
  sidebarDragDivider.hidden = false;
  sidebarCollapsed.hidden = true;
}

function showSidebarCollapsed() {
  sidebar.hidden = true;
  sidebarDragDivider.hidden = true;
  sidebarCollapsed.hidden = false;
}

sidebarCollapseBtn.addEventListener('click', showSidebarCollapsed);
sidebarExpandBtn.addEventListener('click', showSidebarExpanded);

function toggleSidebar() {
  if (sidebar.hidden) {
    showSidebarExpanded();
  } else {
    showSidebarCollapsed();
  }
}

const editorPane = document.getElementById('editor-pane');
const dragDivider = document.getElementById('dragDivider');
const containerEl = document.getElementById('container');

const savedEditorWidth = parseFloat(localStorage.getItem('latexbuild-editor-width'));
if (!isNaN(savedEditorWidth)) editorPane.style.width = savedEditorWidth + '%';

let dividerDragging = false;

dragDivider.addEventListener('mousedown', (e) => {
  dividerDragging = true;
  dragDivider.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!dividerDragging) return;
  const containerRect = containerEl.getBoundingClientRect();
  const sidebarEl = sidebar.hidden ? sidebarCollapsed : sidebar;
  const startX = sidebarEl.getBoundingClientRect().right;
  const dividerWidth = dragDivider.getBoundingClientRect().width;
  const availableWidth = containerRect.right - startX - dividerWidth;
  const editorWidth = e.clientX - startX;
  const percent = Math.min(80, Math.max(20, (editorWidth / availableWidth) * 100));
  editorPane.style.width = percent + '%';
  cm.refresh();
});

window.addEventListener('mouseup', () => {
  if (!dividerDragging) return;
  dividerDragging = false;
  dragDivider.classList.remove('dragging');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  localStorage.setItem('latexbuild-editor-width', parseFloat(editorPane.style.width));
});

const savedSidebarWidth = parseFloat(localStorage.getItem('latexbuild-sidebar-width'));
if (!isNaN(savedSidebarWidth)) sidebar.style.width = savedSidebarWidth + 'px';

let sidebarDividerDragging = false;

sidebarDragDivider.addEventListener('mousedown', (e) => {
  sidebarDividerDragging = true;
  sidebarDragDivider.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!sidebarDividerDragging) return;
  const containerRect = containerEl.getBoundingClientRect();
  const width = Math.min(500, Math.max(140, e.clientX - containerRect.left));
  sidebar.style.width = width + 'px';
});

window.addEventListener('mouseup', () => {
  if (!sidebarDividerDragging) return;
  sidebarDividerDragging = false;
  sidebarDragDivider.classList.remove('dragging');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  localStorage.setItem('latexbuild-sidebar-width', parseFloat(sidebar.style.width));
});

function buildTree(paths, dirs) {
  const root = {};
  (dirs || []).forEach(dirPath => {
    let node = root;
    dirPath.split('/').forEach(part => {
      node[part] = node[part] || {};
      node = node[part];
    });
  });
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

function downloadPath(path) {
  const a = document.createElement('a');
  a.href = '/fs/download?path=' + encodeURIComponent(path);
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function dirMenuOptions(dirPath) {
  return [
    { label: 'New file here', action: () => createFile(dirPath) },
    { label: 'New folder here', action: () => createFolder(dirPath) },
    { label: 'Upload here', action: () => triggerUpload(dirPath) },
    { label: 'Upload folder here', action: () => triggerUploadFolder(dirPath) },
    { label: 'Download (.zip)', action: () => downloadPath(dirPath) },
    { label: 'Rename', action: () => renameEntry(dirPath, true) },
    { label: 'Delete', action: () => deleteEntry(dirPath, true) },
  ];
}

function fileMenuOptions(path) {
  return [
    { label: 'Download', action: () => downloadPath(path) },
    { label: 'Rename', action: () => renameEntry(path, false) },
    { label: 'Delete', action: () => deleteEntry(path, false) },
  ];
}

function rootMenuOptions() {
  return [
    { label: 'New file here', action: () => createFile('') },
    { label: 'New folder here', action: () => createFolder('') },
    { label: 'Upload here', action: () => triggerUpload('') },
    { label: 'Upload folder here', action: () => triggerUploadFolder('') },
    { label: 'Download project (.zip)', action: () => downloadPath('') },
  ];
}

function renderTree(node, container, currentFile, depth = 0, pathPrefix = '') {
  const indent = 10 + depth * 14;

  Object.keys(node).filter(k => k !== '__files').sort().forEach(dirName => {
    const dirPath = pathPrefix ? pathPrefix + '/' + dirName : dirName;
    const row = document.createElement('div');
    row.className = 'tree-row tree-dir';
    row.style.paddingLeft = indent + 'px';
    const children = document.createElement('div');
    children.className = 'tree-children' + (expandedFolders.has(dirPath) ? '' : ' collapsed');

    const label = document.createElement('span');
    label.className = 'tree-label';
    const setLabel = () => {
      label.textContent = (children.classList.contains('collapsed') ? '▸' : '▾') + ' 📁 ' + dirName;
    };
    setLabel();
    row.appendChild(label);

    const menuBtn = document.createElement('button');
    menuBtn.className = 'tree-row-menu-btn';
    menuBtn.textContent = '⋮';
    menuBtn.title = 'Actions';
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openRowMenu(dirMenuOptions(dirPath), { x: menuBtn.getBoundingClientRect().left, y: menuBtn.getBoundingClientRect().bottom + 4 });
    });
    row.appendChild(menuBtn);

    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openRowMenu(dirMenuOptions(dirPath), { x: e.clientX, y: e.clientY });
    });

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
    const lower = f.name.toLowerCase();
    const isTex = lower.endsWith('.tex');
    const isBib = lower.endsWith('.bib');
    const isEditable = isTex || isBib;
    const isActive = f.path === currentFile;
    const row = document.createElement('div');
    row.className = 'tree-row tree-file'
      + (isEditable ? ' editable-file' : '')
      + (isActive ? ' active' : '');
    row.style.paddingLeft = indent + 'px';

    const label = document.createElement('span');
    label.className = 'tree-label';
    const icon = compilingFiles.has(f.path) ? '⏳ ' : (isTex ? '📄 ' : isBib ? '📚 ' : '　');
    label.textContent = icon + f.name;
    row.appendChild(label);

    const menuBtn = document.createElement('button');
    menuBtn.className = 'tree-row-menu-btn';
    menuBtn.textContent = '⋮';
    menuBtn.title = 'Actions';
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openRowMenu(fileMenuOptions(f.path), { x: menuBtn.getBoundingClientRect().left, y: menuBtn.getBoundingClientRect().bottom + 4 });
    });
    row.appendChild(menuBtn);

    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openRowMenu(fileMenuOptions(f.path), { x: e.clientX, y: e.clientY });
    });

    if (isEditable) row.addEventListener('dblclick', () => selectFile(f.path));
    container.appendChild(row);
  });
}

let lastTreeFiles = [];
let lastTreeDirs = [];
let lastTreeCurrent = null;
let lastTreeTexFile = null;

function collectAncestors(path, set) {
  const parts = path.split('/');
  let cur = '';
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur ? cur + '/' + parts[i] : parts[i];
    set.add(cur);
  }
}

function getFilteredTreeData() {
  if (!searchQuery) return { files: lastTreeFiles, dirs: lastTreeDirs };
  const q = searchQuery.toLowerCase();
  const matchingDirs = lastTreeDirs.filter(d => d.toLowerCase().includes(q));
  const isUnderMatchingDir = (p) => matchingDirs.some(d => p === d || p.startsWith(d + '/'));
  const files = lastTreeFiles.filter(f => f.toLowerCase().includes(q) || isUnderMatchingDir(f));
  const dirSet = new Set(lastTreeDirs.filter(d => d.toLowerCase().includes(q) || isUnderMatchingDir(d)));
  files.forEach(f => collectAncestors(f, dirSet));
  Array.from(dirSet).forEach(d => collectAncestors(d, dirSet));
  return { files, dirs: Array.from(dirSet) };
}

function renderCurrentTree() {
  fileTreeEl.innerHTML = '';
  const { files, dirs } = getFilteredTreeData();
  renderTree(buildTree(files, dirs), fileTreeEl, lastTreeCurrent);
}

function loadTree() {
  return fetch('/tree').then(r => r.json()).then(data => {
    lastTreeFiles = data.files;
    lastTreeDirs = data.dirs || [];
    lastTreeCurrent = data.current;
    lastTreeTexFile = data.tex_file;
    renderCurrentTree();
    renderTabBar();
    if (!sidebarInitialized) {
      sidebarInitialized = true;
      showSidebarExpanded();
    }
  });
}

let selectRequestToken = 0;

function selectFile(path) {
  if (activeCompileState !== 'idle' && path === lastTreeCurrent) return;
  if (uploadInProgress) return;
  if (isDirty && !confirm('Discard unsaved changes and open "' + path + '"?')) return;
  const token = ++selectRequestToken;
  fetch('/select', { method: 'POST', body: path })
    .then(r => r.json())
    .then(async (data) => {
      if (!data.ok || token !== selectRequestToken) return;
      isDirty = false;
      errorPanel.classList.remove('visible');
      await loadSource();
      if (token !== selectRequestToken) return;
      setCurrentFileLabel(data.file);
      openTab(data.file);
      loadTree();

      if (!data.is_tex) {
        activeCompileState = 'idle';
        updateCompileOverlay();
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

fetch('/current').then(r => r.json()).then(data => {
  setCurrentFileLabel(data.file);
  (data.open_tabs || []).forEach(path => openTab(path));
  if (data.file) {
    openTab(data.file);
    if (data.file === data.tex_file) refreshPdf(false, false);
  }
});
loadTree().then(initCompilePolling);

let uploadTargetDir = '';

function triggerUpload(targetDir) {
  uploadTargetDir = targetDir;
  uploadInput.click();
}

function triggerUploadFolder(targetDir) {
  uploadTargetDir = targetDir;
  uploadFolderInput.click();
}

uploadBtn.addEventListener('click', () => triggerUpload(''));
uploadFolderBtn.addEventListener('click', () => triggerUploadFolder(''));

function expandAncestors(path) {
  const parts = path.split('/');
  let cur = '';
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur ? cur + '/' + parts[i] : parts[i];
    expandedFolders.add(cur);
  }
}

async function uploadFileList(files, relPathOf) {
  if (files.length === 0) return;

  uploadInProgress = true;
  compileNowBtn.disabled = true;
  status.className = 'busy';

  let uploaded = 0;
  for (const file of files) {
    const rel = relPathOf(file);
    uploaded++;
    if (!rel) continue;
    expandAncestors(rel);
    status.textContent = 'uploading ' + uploaded + '/' + files.length + '...';
    await fetch('/upload?name=' + encodeURIComponent(rel), { method: 'POST', body: file });
  }

  uploadInProgress = false;
  compileNowBtn.disabled = false;
  status.className = 'ok';
  status.textContent = 'uploaded';
  loadTree();
}

uploadInput.addEventListener('change', async () => {
  const files = Array.from(uploadInput.files);
  uploadInput.value = '';
  await uploadFileList(files, (file) => joinPath(uploadTargetDir, file.name));
});

uploadFolderInput.addEventListener('change', async () => {
  const files = Array.from(uploadFolderInput.files);
  uploadFolderInput.value = '';
  const isHidden = (rel) => rel.split('/').some(part => part.startsWith('.'));
  await uploadFileList(files, (file) => {
    const rel = file.webkitRelativePath;
    if (!rel || isHidden(rel)) return null;
    return joinPath(uploadTargetDir, rel);
  });
});

function joinPath(dir, name) {
  return dir ? dir + '/' + name : name;
}

async function createFile(targetDir) {
  const name = prompt('New file name (e.g. chapter2.tex, notes.bib):');
  if (!name || !name.trim()) return;
  const rel = joinPath(targetDir, name.trim());
  const resp = await fetch('/fs/create-file', { method: 'POST', body: rel });
  const data = await resp.json();
  if (!data.ok) {
    alert(data.error === 'already exists' ? 'A file with that name already exists.' : 'Could not create file.');
    return;
  }
  await loadTree();
  const lower = rel.toLowerCase();
  if (lower.endsWith('.tex') || lower.endsWith('.bib')) selectFile(rel);
}

async function createFolder(targetDir) {
  const name = prompt('New folder name:');
  if (!name || !name.trim()) return;
  const rel = joinPath(targetDir, name.trim());
  const resp = await fetch('/fs/create-folder', { method: 'POST', body: rel });
  const data = await resp.json();
  if (!data.ok) {
    alert(data.error === 'already exists' ? 'A folder with that name already exists.' : 'Could not create folder.');
    return;
  }
  expandedFolders.add(rel);
  await loadTree();
}

async function renameEntry(path, isDir) {
  const currentName = path.split('/').pop();
  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const newName = prompt('Rename to:', currentName);
  if (!newName || !newName.trim() || newName.trim() === currentName) return;
  const to = joinPath(parent, newName.trim());
  const resp = await fetch('/fs/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: path, to }),
  });
  const data = await resp.json();
  if (!data.ok) {
    alert(data.error || 'Rename failed.');
    return;
  }
  openTabs = data.open_tabs || [];
  renderTabBar();
  if (data.editing_file) setCurrentFileLabel(data.editing_file);
  await loadTree();
}

async function deleteEntry(path, isDir) {
  const label = isDir ? 'folder "' + path + '" and everything inside it' : 'file "' + path + '"';
  if (!confirm('Delete ' + label + '? This cannot be undone.')) return;
  const resp = await fetch('/fs/delete', { method: 'POST', body: path });
  const data = await resp.json();
  if (!data.ok) {
    alert(data.error || 'Delete failed.');
    return;
  }
  openTabs = data.open_tabs || [];
  renderTabBar();
  if (data.closed_current) resetToNoFileOpen();
  await loadTree();
}

newFileBtn.addEventListener('click', () => createFile(''));
newFolderBtn.addEventListener('click', () => createFolder(''));

let rowMenuEl = null;

function closeRowMenu() {
  if (!rowMenuEl) return;
  rowMenuEl.remove();
  rowMenuEl = null;
}

function openRowMenu(options, pos) {
  closeRowMenu();
  const menu = document.createElement('div');
  menu.className = 'row-menu';
  options.forEach(opt => {
    const item = document.createElement('div');
    item.className = 'row-menu-item';
    item.textContent = opt.label;
    item.addEventListener('click', () => {
      closeRowMenu();
      opt.action();
    });
    menu.appendChild(item);
  });
  document.body.appendChild(menu);
  menu.style.top = Math.min(pos.y, window.innerHeight - menu.offsetHeight - 8) + 'px';
  menu.style.left = Math.min(pos.x, window.innerWidth - menu.offsetWidth - 8) + 'px';
  rowMenuEl = menu;
}

fileTreeEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  openRowMenu(rootMenuOptions(), { x: e.clientX, y: e.clientY });
});

window.addEventListener('mousedown', (e) => {
  if (rowMenuEl && !rowMenuEl.contains(e.target)) closeRowMenu();
});

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
});
