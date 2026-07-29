const darkToggle = document.getElementById('darkToggle');

function systemPrefersDark() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(isDark) {
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
}

const storedTheme = localStorage.getItem('texiom-theme');
export const initialDark = storedTheme ? storedTheme === 'dark' : systemPrefersDark();
darkToggle.checked = initialDark;
applyTheme(initialDark);

export function wireThemeToggle(cm) {
  darkToggle.addEventListener('change', () => {
    const isDark = darkToggle.checked;
    applyTheme(isDark);
    cm.setOption('theme', isDark ? 'material-darker' : 'default');
    localStorage.setItem('texiom-theme', isDark ? 'dark' : 'light');
  });
}
