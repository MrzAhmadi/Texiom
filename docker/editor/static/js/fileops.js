import { expandedFolders, loadTree } from './filetree.js';
import { setOpenTabs, setUploadInProgress } from './state.js';
import { renderTabBar, resetToNoFileOpen, selectFile, setCurrentFileLabel } from './tabs.js';

const status = document.getElementById('status');
const compileNowBtn = document.getElementById('compileNow');
const uploadBtn = document.getElementById('uploadBtn');
const uploadInput = document.getElementById('uploadInput');
const uploadFolderBtn = document.getElementById('uploadFolderBtn');
const uploadFolderInput = document.getElementById('uploadFolderInput');
const newFileBtn = document.getElementById('newFileBtn');
const newFolderBtn = document.getElementById('newFolderBtn');

export function downloadPath(path) {
  const a = document.createElement('a');
  a.href = '/fs/download?path=' + encodeURIComponent(path);
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function joinPath(dir, name) {
  return dir ? dir + '/' + name : name;
}

export async function createFile(targetDir) {
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

export async function createFolder(targetDir) {
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

export async function renameEntry(path, isDir) {
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
  setOpenTabs(data.open_tabs || []);
  renderTabBar();
  if (data.editing_file) setCurrentFileLabel(data.editing_file);
  await loadTree();
}

export async function deleteEntry(path, isDir) {
  const label = isDir ? 'folder "' + path + '" and everything inside it' : 'file "' + path + '"';
  if (!confirm('Delete ' + label + '? This cannot be undone.')) return;
  const resp = await fetch('/fs/delete', { method: 'POST', body: path });
  const data = await resp.json();
  if (!data.ok) {
    alert(data.error || 'Delete failed.');
    return;
  }
  setOpenTabs(data.open_tabs || []);
  renderTabBar();
  if (data.closed_current) resetToNoFileOpen();
  await loadTree();
}

newFileBtn.addEventListener('click', () => createFile(''));
newFolderBtn.addEventListener('click', () => createFolder(''));

let uploadTargetDir = '';

export function triggerUpload(targetDir) {
  uploadTargetDir = targetDir;
  uploadInput.click();
}

export function triggerUploadFolder(targetDir) {
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

  setUploadInProgress(true);
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

  setUploadInProgress(false);
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
