import {
  createFile, createFolder, deleteEntry, downloadPath, renameEntry, triggerUpload, triggerUploadFolder,
} from './fileops.js';
import { showSidebarExpanded } from './sidebar.js';
import { compilingFiles, lastTreeCurrent, lastTreeDirs, lastTreeFiles, setLastTree } from './state.js';
import { renderTabBar, selectFile } from './tabs.js';

const fileTreeEl = document.getElementById('fileTree');
const searchToggleBtn = document.getElementById('searchToggleBtn');
const searchRow = document.getElementById('searchRow');
const searchInput = document.getElementById('searchInput');
const searchClearBtn = document.getElementById('searchClearBtn');

export const expandedFolders = new Set();

let sidebarInitialized = false;
let searchQuery = '';

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

window.addEventListener('mousedown', (e) => {
  if (rowMenuEl && !rowMenuEl.contains(e.target)) closeRowMenu();
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

export function renderCurrentTree() {
  fileTreeEl.innerHTML = '';
  const { files, dirs } = getFilteredTreeData();
  renderTree(buildTree(files, dirs), fileTreeEl, lastTreeCurrent);
}

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

export function loadTree() {
  return fetch('/tree').then(r => r.json()).then(data => {
    setLastTree(data.files, data.dirs || [], data.current, data.tex_file);
    renderCurrentTree();
    renderTabBar();
    if (!sidebarInitialized) {
      sidebarInitialized = true;
      showSidebarExpanded();
    }
  });
}

fileTreeEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  openRowMenu(rootMenuOptions(), { x: e.clientX, y: e.clientY });
});
