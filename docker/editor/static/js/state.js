export let isDirty = false;
export function setDirty(value) { isDirty = value; }

export let suppressDirty = true;
export function setSuppressDirty(value) { suppressDirty = value; }

export let activeCompileState = 'idle';
export function setActiveCompileStateValue(value) { activeCompileState = value; }

export let compilingFiles = new Set();
export function setCompilingFiles(value) { compilingFiles = value; }

export let lastTreeFiles = [];
export let lastTreeDirs = [];
export let lastTreeCurrent = null;
export let lastTreeTexFile = null;
export function setLastTree(files, dirs, current, texFile) {
  lastTreeFiles = files;
  lastTreeDirs = dirs;
  lastTreeCurrent = current;
  lastTreeTexFile = texFile;
}

export let openTabs = [];
export function setOpenTabs(value) { openTabs = value; }

export let uploadInProgress = false;
export function setUploadInProgress(value) { uploadInProgress = value; }
