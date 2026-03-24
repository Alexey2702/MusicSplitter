// ── State ──
let selectedFile = null;
let outputDir = null;
let currentMode = '2stem';
let progressInterval = null;

// ── DOM refs ──
const dropZone       = document.getElementById('dropZone');
const fileInfo       = document.getElementById('fileInfo');
const fileName       = document.getElementById('fileName');
const filePath       = document.getElementById('filePath');
const btnPickFile    = document.getElementById('btnPickFile');
const btnClearFile   = document.getElementById('btnClearFile');
const outputCard     = document.getElementById('outputCard');
const outputDirInput = document.getElementById('outputDir');
const btnPickFolder  = document.getElementById('btnPickFolder');
const btnSeparate    = document.getElementById('btnSeparate');
const btnSeparateText = document.getElementById('btnSeparateText');
const progressCard   = document.getElementById('progressCard');
const progressBar    = document.getElementById('progressBar');
const progressStage  = document.getElementById('progressStage');
const progressPct    = document.getElementById('progressPct');
const progressMsg    = document.getElementById('progressMsg');
const stemsResult    = document.getElementById('stemsResult');
const stemsGrid      = document.getElementById('stemsGrid');
const saveModal      = document.getElementById('saveModal');
const saveDirInput   = document.getElementById('saveDir');
const btnPickSaveFolder = document.getElementById('btnPickSaveFolder');
const btnSaveNow     = document.getElementById('btnSaveNow');

// ── Tab navigation ──
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ── Mode toggle ──
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentMode = btn.dataset.mode;
    // Папка нужна только для 4stem
    outputCard.classList.toggle('hidden', currentMode === '2stem');
    updateSeparateBtn();
  });
});

// Скрываем папку по умолчанию (2stem активен)
outputCard.classList.add('hidden');

// ── File pick ──
btnPickFile.addEventListener('click', async () => {
  const res = await fetch('/api/open_file_dialog');
  const data = await res.json();
  if (data.path) setFile(data.path);
});

btnClearFile.addEventListener('click', () => {
  selectedFile = null;
  fileInfo.classList.add('hidden');
  dropZone.classList.remove('hidden');
  updateSeparateBtn();
});

// ── Drag & drop ──
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) setFile(file.path || file.name);
});

function setFile(path) {
  selectedFile = path;
  const parts = path.replace(/\\/g, '/').split('/');
  fileName.textContent = parts[parts.length - 1];
  filePath.textContent = path;
  dropZone.classList.add('hidden');
  fileInfo.classList.remove('hidden');

  if (!outputDir && currentMode === '4stem') {
    outputDir = parts.slice(0, -1).join('/') + '/stems_output';
    outputDirInput.value = outputDir;
  }
  updateSeparateBtn();
}

// ── Folder pick (4stem) ──
btnPickFolder.addEventListener('click', async () => {
  const res = await fetch('/api/open_folder_dialog');
  const data = await res.json();
  if (data.path) { outputDir = data.path; outputDirInput.value = data.path; updateSeparateBtn(); }
});

function updateSeparateBtn() {
  const needsDir = currentMode === '4stem';
  btnSeparate.disabled = !(selectedFile && (!needsDir || outputDir));
}

// ── Separate ──
btnSeparate.addEventListener('click', async () => {
  if (!selectedFile) return;

  stemsResult.classList.add('hidden');
  progressCard.classList.remove('hidden');
  btnSeparate.disabled = true;
  btnSeparateText.textContent = 'Обработка...';
  progressMsg.style.color = '';

  const body = { input_path: selectedFile, mode: currentMode };
  if (currentMode === '4stem') body.output_dir = outputDir;

  const res = await fetch('/api/separate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  if (data.error) { showError(data.error); return; }

  startPolling();
});

function startPolling() {
  progressInterval = setInterval(async () => {
    const res = await fetch('/api/progress');
    const state = await res.json();

    const pct = state.progress || 0;
    progressBar.style.width = pct + '%';
    progressPct.textContent = pct + '%';
    progressStage.textContent = stageLabel(state.stage);
    if (state.message) progressMsg.textContent = state.message;

    if (state.done) {
      clearInterval(progressInterval);
      if (state.error) {
        showError(state.error);
      } else if (state.needs_save) {
        // 2stem — показываем модалку для выбора папки
        progressStage.textContent = 'Готово — выбери папку';
        btnSeparateText.textContent = 'Разделить трек';
        btnSeparate.disabled = false;
        showSaveModal();
      } else {
        progressBar.style.width = '100%';
        progressPct.textContent = '100%';
        progressStage.textContent = 'Готово';
        btnSeparateText.textContent = 'Разделить трек';
        btnSeparate.disabled = false;
        loadStems(state.output_dir || outputDir);
      }
    }
  }, 600);
}

function stageLabel(stage) {
  const map = {
    loading_model: 'Загрузка модели',
    loading_audio: 'Загрузка аудио',
    preprocessing: 'Подготовка',
    separation: 'Разделение',
    saving: 'Сохранение'
  };
  return map[stage] || stage || '...';
}

// ── Save modal (2stem) ──
function showSaveModal() {
  saveModal.classList.remove('hidden');
}

btnPickSaveFolder.addEventListener('click', async () => {
  const res = await fetch('/api/open_folder_dialog');
  const data = await res.json();
  if (data.path) {
    saveDirInput.value = data.path;
    btnSaveNow.disabled = false;
  }
});

btnSaveNow.addEventListener('click', async () => {
  const dir = saveDirInput.value;
  if (!dir) return;

  btnSaveNow.disabled = true;
  btnSaveNow.textContent = 'Сохранение...';

  const res = await fetch('/api/save_two_stems', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ output_dir: dir })
  });
  const data = await res.json();

  saveModal.classList.add('hidden');
  btnSaveNow.textContent = 'Сохранить';
  btnSaveNow.disabled = true;
  saveDirInput.value = '';

  if (data.error) { showError(data.error); return; }
  loadStems(dir);
});

// ── Load stems ──
async function loadStems(dir) {
  const res = await fetch('/api/stems_list?dir=' + encodeURIComponent(dir));
  const data = await res.json();

  stemsGrid.innerHTML = '';
  const icons = { vocals: '🎤', drums: '🥁', bass: '🎸', other: '🎹', instrumental: '🎼' };

  data.stems.forEach(stem => {
    const name = stem.replace('.wav', '');
    const card = document.createElement('div');
    card.className = 'stem-card';
    card.innerHTML = `
      <div class="stem-icon">${icons[name] || '🎵'}</div>
      <div>
        <div class="stem-name">${name}</div>
        <div class="stem-size">${stem}</div>
      </div>
      <div class="stem-actions">
        <button class="stem-btn" onclick="openStem('${dir}/${stem}')">Открыть</button>
      </div>
    `;
    stemsGrid.appendChild(card);
  });

  stemsResult.classList.remove('hidden');
}

function openStem(path) {
  fetch('/api/open_stem?path=' + encodeURIComponent(path));
}

function showError(msg) {
  progressStage.textContent = '❌ Ошибка';
  progressMsg.textContent = msg;
  progressMsg.style.color = 'var(--red)';
  btnSeparateText.textContent = 'Разделить трек';
  btnSeparate.disabled = false;
}
