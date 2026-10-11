import { cm, jumpEditorToLine } from './editor.js';
import { lastTreeCurrent } from './state.js';
import { selectFile } from './tabs.js';

const errorPanel = document.getElementById('errorPanel');

let items = [];
let marked = [];

export function hasDiagnostics() {
  return items.length > 0;
}

export function clearMarks() {
  marked.forEach(({ handle, cls }) => cm.removeLineClass(handle, 'background', cls));
  marked = [];
}

// Highlights the diagnostic lines that belong to the file currently open in the editor.
export function applyMarks() {
  clearMarks();
  items.forEach(item => {
    if (!item.file || item.file !== lastTreeCurrent || !item.line) return;
    if (item.line > cm.lineCount()) return;
    const cls = 'diag-line-' + item.severity;
    const handle = cm.addLineClass(item.line - 1, 'background', cls);
    marked.push({ handle, cls });
  });
}

function openAt(item) {
  if (!item.file) return;
  if (item.file === lastTreeCurrent) {
    jumpEditorToLine(item.line);
    return;
  }
  const opened = selectFile(item.file, { keepRoot: true });
  if (opened) opened.then(() => jumpEditorToLine(item.line));
}

function buildRow(item) {
  const row = document.createElement('div');
  row.className = 'diag-row diag-' + item.severity + (item.file ? ' diag-clickable' : '');

  const icon = document.createElement('span');
  icon.className = 'diag-icon';
  icon.textContent = item.severity === 'error' ? '✖' : '⚠';
  row.appendChild(icon);

  const body = document.createElement('div');
  body.className = 'diag-body';

  const message = document.createElement('div');
  message.className = 'diag-message';
  message.textContent = item.message;
  body.appendChild(message);

  const where = document.createElement('div');
  where.className = 'diag-where';
  where.textContent = item.line ? item.source + ':' + item.line : item.source;
  body.appendChild(where);

  if (item.context) {
    const context = document.createElement('code');
    context.className = 'diag-context';
    context.textContent = item.context;
    body.appendChild(context);
  }

  row.appendChild(body);
  if (item.file) row.addEventListener('click', () => openAt(item));
  return row;
}

export function showPanel() {
  errorPanel.classList.add('visible');
}

export function hidePanel() {
  errorPanel.classList.remove('visible');
}

export function togglePanel() {
  if (!hasDiagnostics()) return;
  errorPanel.classList.toggle('visible');
}

// Renders the structured list (errors first) plus the raw log in a collapsible block.
export function setDiagnostics(list, rawLog) {
  items = [...list].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
  errorPanel.textContent = '';

  const header = document.createElement('div');
  header.className = 'diag-header';
  const errors = items.filter(i => i.severity === 'error').length;
  const warnings = items.length - errors;
  const title = document.createElement('span');
  title.textContent = [
    errors ? errors + (errors === 1 ? ' error' : ' errors') : '',
    warnings ? warnings + (warnings === 1 ? ' warning' : ' warnings') : '',
  ].filter(Boolean).join(', ') || 'Build log';
  header.appendChild(title);
  const close = document.createElement('button');
  close.className = 'icon-btn';
  close.title = 'Close';
  close.textContent = '×';
  close.addEventListener('click', hidePanel);
  header.appendChild(close);
  errorPanel.appendChild(header);

  items.forEach(item => errorPanel.appendChild(buildRow(item)));

  if (rawLog) {
    const details = document.createElement('details');
    details.className = 'diag-log';
    details.open = items.length === 0;
    const summary = document.createElement('summary');
    summary.textContent = 'Full log';
    details.appendChild(summary);
    const pre = document.createElement('pre');
    pre.textContent = rawLog;
    details.appendChild(pre);
    errorPanel.appendChild(details);
  }
  applyMarks();
}

export function resetDiagnostics() {
  items = [];
  clearMarks();
  hidePanel();
}
