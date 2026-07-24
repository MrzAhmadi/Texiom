const status = document.getElementById('status');
const liveToggle = document.getElementById('liveToggle');
const cm = CodeMirror.fromTextArea(document.getElementById('editor'), {
  mode: 'stex',
  lineNumbers: true,
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
