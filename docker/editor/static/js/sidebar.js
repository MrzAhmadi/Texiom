import { cm } from './editor.js';

const sidebar = document.getElementById('sidebar');
const sidebarCollapsed = document.getElementById('sidebarCollapsed');
const sidebarDragDivider = document.getElementById('sidebarDragDivider');
const sidebarCollapseBtn = document.getElementById('sidebarCollapseBtn');
const sidebarExpandBtn = document.getElementById('sidebarExpandBtn');
const editorPane = document.getElementById('editor-pane');
const dragDivider = document.getElementById('dragDivider');
const containerEl = document.getElementById('container');

export function showSidebarExpanded() {
  sidebar.hidden = false;
  sidebarDragDivider.hidden = false;
  sidebarCollapsed.hidden = true;
}

export function showSidebarCollapsed() {
  sidebar.hidden = true;
  sidebarDragDivider.hidden = true;
  sidebarCollapsed.hidden = false;
}

sidebarCollapseBtn.addEventListener('click', showSidebarCollapsed);
sidebarExpandBtn.addEventListener('click', showSidebarExpanded);

export function toggleSidebar() {
  if (sidebar.hidden) {
    showSidebarExpanded();
  } else {
    showSidebarCollapsed();
  }
}

const savedEditorWidth = parseFloat(localStorage.getItem('texiom-editor-width'));
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
  localStorage.setItem('texiom-editor-width', parseFloat(editorPane.style.width));
});

const savedSidebarWidth = parseFloat(localStorage.getItem('texiom-sidebar-width'));
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
  localStorage.setItem('texiom-sidebar-width', parseFloat(sidebar.style.width));
});
