import { cm, jumpEditorToLine } from './editor.js';
import { downloadPath } from './fileops.js';
import { lastTreeTexFile } from './state.js';

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

export async function refreshPdf(preserveScroll, isFresh) {
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

export function clearPdfView() {
  pdfDoc = null;
  pdfIsFresh = false;
  updateStalePdfNotice();
  pdfPageDivs = [];
  if (pdfObserver) pdfObserver.disconnect();
  pdfPagesEl.innerHTML = '';
}

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
