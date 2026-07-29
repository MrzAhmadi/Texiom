export const shortcutsModal = document.getElementById('shortcutsModal');
const shortcutsBtn = document.getElementById('shortcutsBtn');
const shortcutsClose = document.getElementById('shortcutsClose');

export function openShortcuts() { shortcutsModal.classList.add('visible'); }
export function closeShortcuts() { shortcutsModal.classList.remove('visible'); }

shortcutsBtn.addEventListener('click', openShortcuts);
shortcutsClose.addEventListener('click', closeShortcuts);
shortcutsModal.addEventListener('click', (e) => {
  if (e.target === shortcutsModal) closeShortcuts();
});

export const appearanceModal = document.getElementById('appearanceModal');
const appearanceBtn = document.getElementById('appearanceBtn');
const appearanceClose = document.getElementById('appearanceClose');

export function openAppearance() { appearanceModal.classList.add('visible'); }
export function closeAppearance() { appearanceModal.classList.remove('visible'); }

appearanceBtn.addEventListener('click', openAppearance);
appearanceClose.addEventListener('click', closeAppearance);
appearanceModal.addEventListener('click', (e) => {
  if (e.target === appearanceModal) closeAppearance();
});

const menuLabels = document.querySelectorAll('.menu-label');

export function closeAllMenus() {
  document.querySelectorAll('.menu-dropdown.open').forEach(m => m.classList.remove('open'));
  menuLabels.forEach(l => l.classList.remove('active'));
}

export function anyMenuOpen() {
  return document.querySelector('.menu-dropdown.open') !== null;
}

menuLabels.forEach(label => {
  label.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = document.getElementById(label.dataset.menu);
    const wasOpen = menu.classList.contains('open');
    closeAllMenus();
    if (!wasOpen) {
      menu.classList.add('open');
      label.classList.add('active');
    }
  });
  label.addEventListener('mouseenter', () => {
    if (!anyMenuOpen()) return;
    closeAllMenus();
    document.getElementById(label.dataset.menu).classList.add('open');
    label.classList.add('active');
  });
});

document.querySelectorAll('.menu-dropdown').forEach(menu => {
  menu.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.target.closest('.menu-row')) closeAllMenus();
  });
});

window.addEventListener('click', closeAllMenus);
