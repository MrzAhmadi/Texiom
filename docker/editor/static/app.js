const status = document.getElementById('status');
const liveToggle = document.getElementById('liveToggle');
const darkToggle = document.getElementById('darkToggle');

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

fetch('/source').then(r => r.text()).then(t => cm.setValue(t));

let debounceTimer = null;
cm.on('change', () => {
  if (!liveToggle.checked) return;
  clearTimeout(debounceTimer);
  status.className = 'busy';
  status.textContent = 'editing...';
  debounceTimer = setTimeout(compile, 700);
});

document.getElementById('compileNow').addEventListener('click', compile);

function compile() {
  status.className = 'busy';
  status.textContent = 'building...';
  fetch('/compile', { method: 'POST', body: cm.getValue() })
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        status.className = 'ok';
        status.textContent = 'built';
        document.getElementById('pdfFrame').src = '/pdf?t=' + Date.now();
      } else {
        status.className = 'err';
        status.textContent = 'build failed';
        console.error(data.log);
      }
    });
}
