import { setSuppressDirty } from './state.js';
import { initialDark, wireThemeToggle } from './theme.js';

export const cm = CodeMirror.fromTextArea(document.getElementById('editor'), {
  mode: 'stex',
  lineNumbers: true,
  theme: initialDark ? 'material-darker' : 'default',
});

wireThemeToggle(cm);

export function wrapSelection(cmInstance, before, after) {
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

export function toggleLineComment(cmInstance) {
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

function applyFormat(before, after) {
  wrapSelection(cm, before, after);
  cm.focus();
}

document.getElementById('fmtBoldBtn').addEventListener('click', () => applyFormat('\\textbf{', '}'));
document.getElementById('fmtItalicBtn').addEventListener('click', () => applyFormat('\\textit{', '}'));
document.getElementById('fmtSectionBtn').addEventListener('click', () => applyFormat('\\section{', '}'));
document.getElementById('fmtSubsectionBtn').addEventListener('click', () => applyFormat('\\subsection{', '}'));
document.getElementById('fmtSubsubsectionBtn').addEventListener('click', () => applyFormat('\\subsubsection{', '}'));

const fontSizeLabel = document.getElementById('fontSizeLabel');
const storedFontSize = parseInt(localStorage.getItem('texiom-editor-fontsize'), 10);
let editorFontSize = Number.isFinite(storedFontSize) ? storedFontSize : 14;

function applyEditorFontSize() {
  cm.getWrapperElement().style.fontSize = editorFontSize + 'px';
  cm.refresh();
  if (fontSizeLabel) fontSizeLabel.textContent = editorFontSize + 'px';
  localStorage.setItem('texiom-editor-fontsize', editorFontSize);
}

export function zoomEditor(delta) {
  editorFontSize = delta === 0 ? 14 : Math.min(28, Math.max(9, editorFontSize + delta));
  applyEditorFontSize();
}

applyEditorFontSize();

document.getElementById('fontSizeDecBtn').addEventListener('click', () => zoomEditor(-1));
document.getElementById('fontSizeIncBtn').addEventListener('click', () => zoomEditor(1));

export function toggleWordWrap() {
  cm.setOption('lineWrapping', !cm.getOption('lineWrapping'));
}

export function jumpEditorToLine(line) {
  const lineIndex = Math.max(0, line - 1);
  cm.setCursor({ line: lineIndex, ch: 0 });
  cm.scrollIntoView({ line: lineIndex, ch: 0 }, 120);
  cm.focus();
  cm.addLineClass(lineIndex, 'background', 'sync-flash');
  setTimeout(() => cm.removeLineClass(lineIndex, 'background', 'sync-flash'), 700);
}

let loadSourceToken = 0;

export function loadSource() {
  const token = ++loadSourceToken;
  setSuppressDirty(true);
  return fetch('/source').then(r => r.text()).then(t => {
    if (token !== loadSourceToken) return;
    cm.setValue(t);
    cm.clearHistory();
    setSuppressDirty(false);
  });
}

export function initEditorKeymap(extraBindings) {
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
    'Ctrl-=': () => zoomEditor(1),
    'Cmd-=': () => zoomEditor(1),
    'Ctrl--': () => zoomEditor(-1),
    'Cmd--': () => zoomEditor(-1),
    'Ctrl-0': () => zoomEditor(0),
    'Cmd-0': () => zoomEditor(0),
    ...extraBindings,
  });
}
