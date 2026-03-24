// ── Stem Splitter ──
import { state } from './state.js';
import { loadAndPlay, stemIcons, getCurrentStemPath, getIsPlaying, pauseAudio } from './player.js';
import { openFilePicker } from './filePicker.js';

const dropZone        = document.getElementById('dropZone');
const fileInfo        = document.getElementById('fileInfo');
const fileNameEl      = document.getElementById('fileName');
const filePathEl      = document.getElementById('filePath');
const btnPickFile     = document.getElementById('btnPickFile');
const btnClearFile    = document.getElementById('btnClearFile');
const outputCard      = document.getElementById('outputCard');
const outputDirInput  = document.getElementById('outputDir');
const btnPickFolder   = document.getElementById('btnPickFolder');
const btnSeparate     = document.getElementById('btnSeparate');
const btnSeparateText = document.getElementById('btnSeparateText');
const progressCard    = document.getElementById('progressCard');
const progressBar     = document.getElementById('progressBar');
const progressStage   = document.getElementById('progressStage');
const progressPct     = document.getElementById('progressPct');
const progressMsg     = document.getElementById('progressMsg');
const stemsResult     = document.getElementById('stemsResult');
const stemsEmpty      = document.getElementById('stemsEmpty');
const stemsGrid       = document.getElementById('stemsGrid');
const saveModal       = document.getElementById('saveModal');
const saveDirInput    = document.getElementById('saveDir');
const btnPickSaveFolder = document.getElementById('btnPickSaveFolder');
const btnSaveNow      = document.getElementById('btnSaveNow');

// ── Mode toggle ──
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.currentMode = btn.dataset.mode;
    outputCard.classList.toggle('hidden', state.currentMode === '2stem');
    updateSeparateBtn();
  });
});
outputCard.classList.add('hidden');

// ── File pick via custom picker ──
btnPickFile.addEventListener('click', () => {
  openFilePicker(path => setFile(path));
});

btnClearFile.addEventListener('click', () => {
  state.selectedFile = null;
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

export function setFile(path) {
  state.selectedFile = path;
  const parts = path.replace(/\\/g, '/').split('/');
  fileNameEl.textContent = parts[parts.length - 1];
  filePathEl.textContent = path;
  dropZone.classList.add('hidden');
  fileInfo.classList.remove('hidden');
  if (!state.outputDir && state.currentMode === '4stem') {
    state.outputDir = parts.slice(0, -1).join('/') + '/stems_output';
    outputDirInput.value = state.outputDir;
  }
  updateSeparateBtn();
}

// ── Folder pick ──
btnPickFolder.addEventListener('click', async () => {
  const res  = await fetch('/api/open_folder_dialog');
  const data = await res.json();
  if (data.path) {
    state.outputDir = data.path;
    outputDirInput.value = data.path;
    updateSeparateBtn();
  }
});

function updateSeparateBtn() {
  const needsDir = state.currentMode === '4stem';
  btnSeparate.disabled = !(state.selectedFile && (!needsDir || state.outputDir));
}

// ── Separate ──
btnSeparate.addEventListener('click', async () => {
  if (!state.selectedFile) return;
  stemsResult.classList.add('hidden');
  progressCard.classList.remove('hidden');
  btnSeparate.disabled = true;
  btnSeparateText.textContent = 'Обработка...';
  progressMsg.style.color = '';

  const body = { input_path: state.selectedFile, mode: state.currentMode };
  if (state.currentMode === '4stem') body.output_dir = state.outputDir;

  const res  = await fetch('/api/separate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (data.error) { showError(data.error); return; }
  startPolling();
});

function startPolling() {
  state.progressInterval = setInterval(async () => {
    const res   = await fetch('/api/progress');
    const s     = await res.json();
    const pct   = s.progress || 0;
    progressBar.style.width = pct + '%';
    progressPct.textContent = pct + '%';
    progressStage.textContent = stageLabel(s.stage);
    if (s.message) progressMsg.textContent = s.message;

    if (s.done) {
      clearInterval(state.progressInterval);
      if (s.error) {
        showError(s.error);
      } else if (s.needs_save) {
        progressStage.textContent = 'Готово — выбери папку';
        btnSeparateText.textContent = 'Разделить трек';
        btnSeparate.disabled = false;
        saveModal.classList.remove('hidden');
      } else {
        progressBar.style.width = '100%';
        progressPct.textContent = '100%';
        progressStage.textContent = 'Готово';
        btnSeparateText.textContent = 'Разделить трек';
        btnSeparate.disabled = false;
        loadStems(s.output_dir || state.outputDir);
      }
    }
  }, 600);
}

function stageLabel(stage) {
  const map = {
    loading_model: 'Загрузка модели', loading_audio: 'Загрузка аудио',
    preprocessing: 'Подготовка', separation: 'Разделение', saving: 'Сохранение'
  };
  return map[stage] || stage || '...';
}

// ── Save modal ──
btnPickSaveFolder.addEventListener('click', async () => {
  const res  = await fetch('/api/open_folder_dialog');
  const data = await res.json();
  if (data.path) { saveDirInput.value = data.path; btnSaveNow.disabled = false; }
});

btnSaveNow.addEventListener('click', async () => {
  const dir = saveDirInput.value;
  if (!dir) return;
  btnSaveNow.disabled = true;
  btnSaveNow.textContent = 'Сохранение...';
  const res  = await fetch('/api/save_two_stems', {
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

function loadStems(dir) {
  fetch('/api/stems_list?dir=' + encodeURIComponent(dir))
    .then(r => r.json())
    .then(data => {
      stemsGrid.innerHTML = '';
      data.stems.forEach(stem => {
        const name = stem.replace('.wav', '');
        const path = dir + '/' + stem;
        const card = document.createElement('div');
        card.className = 'stem-card';
        card.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div class="stem-icon">${stemIcons[name] || '🎵'}</div>
            <button class="stem-play-btn" data-path="${path}" data-name="${name}">▶</button>
          </div>
          <div>
            <div class="stem-name">${name}</div>
            <div class="stem-size">${stem}</div>
          </div>
          <div class="stem-actions">
            <button class="stem-btn" onclick="openStem('${path}')">Открыть в Finder</button>
          </div>
        `;
        stemsGrid.appendChild(card);
      });

      stemsGrid.querySelectorAll('.stem-play-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const path = btn.dataset.path;
          const name = btn.dataset.name;
          if (getCurrentStemPath() === path && getIsPlaying()) pauseAudio();
          else loadAndPlay(path, name, btn);
        });
      });

      stemsResult.classList.remove('hidden');
      if (stemsEmpty) stemsEmpty.classList.add('hidden');
    });
}

function showError(msg) {
  progressStage.textContent = '❌ Ошибка';
  progressMsg.textContent = msg;
  progressMsg.style.color = 'var(--red)';
  btnSeparateText.textContent = 'Разделить трек';
  btnSeparate.disabled = false;
}

window.openStem = path => fetch('/api/open_stem?path=' + encodeURIComponent(path));
