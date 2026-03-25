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
  fetch('/api/stems_list?dir=' + encodeURIComponent(dir) + '&mode=' + state.currentMode)
    .then(r => r.json())
    .then(data => {
      _buildMixer(data.stems, dir);
      stemsResult.classList.remove('hidden');
      if (stemsEmpty) stemsEmpty.classList.add('hidden');
    });
}

// ── Mixer state ──
const _mixer = {
  ctx: null, tracks: [],   // [{name, path, buf, gainNode, muteGain, source, muted, soloed, vol}]
  playingAll: false, startedAt: 0, seekOff: 0, rafId: null,
};

function _getMixCtx() {
  if (!_mixer.ctx) _mixer.ctx = new AudioContext();
  return _mixer.ctx;
}

function _stopMixer() {
  cancelAnimationFrame(_mixer.rafId);
  _mixer.tracks.forEach(t => {
    if (t.source) { try { t.source.stop(); } catch(e){} t.source = null; }
  });
  _mixer.playingAll = false;
}

function _startMixerFrom(offset) {
  _stopMixer();
  const ctx = _getMixCtx();
  const duration = _mixer.tracks[0]?.buf?.duration || 0;
  _mixer.tracks.forEach(t => {
    if (!t.buf) return;
    t.source = ctx.createBufferSource();
    t.source.buffer = t.buf;
    t.source.connect(t.gainNode);
    t.source.start(0, offset);
  });
  _mixer.startedAt = ctx.currentTime - offset;
  _mixer.seekOff   = offset;
  _mixer.playingAll = true;
  _tickMixer(duration);
}

function _tickMixer(duration) {
  if (!_mixer.playingAll) return;
  const elapsed = Math.min(_mixer.ctx.currentTime - _mixer.startedAt, duration);
  const pct = elapsed / duration * 100;
  // update all waveform progress lines
  document.querySelectorAll('.smx-progress').forEach(el => el.style.width = pct + '%');
  document.querySelectorAll('.smx-time').forEach(el => el.textContent = _fmtTime(elapsed));
  if (elapsed >= duration - 0.05) { _stopMixer(); _resetMixerUI(); return; }
  _mixer.rafId = requestAnimationFrame(() => _tickMixer(duration));
}

function _resetMixerUI() {
  document.querySelectorAll('.smx-progress').forEach(el => el.style.width = '0%');
  document.querySelectorAll('.smx-time').forEach(el => el.textContent = '0:00');
  const btn = document.getElementById('smxPlayAll');
  if (btn) btn.textContent = '▶';
}

function _updateSolo() {
  const hasSolo = _mixer.tracks.some(t => t.soloed);
  _mixer.tracks.forEach(t => {
    const active = !hasSolo || t.soloed;
    t.muteGain.gain.value = (t.muted || !active) ? 0 : t.vol;
  });
}

function _fmtTime(s) {
  if (!s || isNaN(s)) return '0:00';
  return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
}

function _drawStemWave(canvas, buf) {
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth || 600;
  const H = 72;
  canvas.width = W; canvas.height = H;
  const data = buf.getChannelData(0);
  const step = Math.ceil(data.length / W);
  const amp  = H / 2;
  ctx.clearRect(0, 0, W, H);
  for (let i = 0; i < W; i++) {
    let min = 1, max = -1;
    for (let j = 0; j < step; j++) {
      const v = data[i * step + j] || 0;
      if (v < min) min = v; if (v > max) max = v;
    }
    const intensity = Math.abs(max - min);
    ctx.fillStyle = `rgba(34,211,160,${0.3 + intensity * 0.7})`;
    ctx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
  }
}

async function _buildMixer(stems, dir) {
  const mixer = document.getElementById('stemsMixer');
  mixer.innerHTML = '';
  _stopMixer();
  _mixer.tracks = [];

  const ctx = _getMixCtx();

  // Header toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'smx-toolbar';
  toolbar.innerHTML = `
    <button class="smx-play-all" id="smxPlayAll">▶</button>
    <span class="smx-total-time" id="smxTotalTime">0:00</span>
    <button class="btn btn-secondary btn-sm smx-export-btn" id="smxExportBtn">↓ Экспорт</button>
  `;
  mixer.appendChild(toolbar);

  const tracksWrap = document.createElement('div');
  tracksWrap.className = 'smx-tracks';
  mixer.appendChild(tracksWrap);

  const stemOrder = ['vocals', 'drums', 'bass', 'other', 'instrumental'];
  const sorted = [...stems].sort((a, b) => {
    const ai = stemOrder.indexOf(a.replace('.wav',''));
    const bi = stemOrder.indexOf(b.replace('.wav',''));
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  for (const stem of sorted) {
    const name = stem.replace('.wav', '');
    const path = (dir + '/' + stem).replace(/\\/g, '/');

    // Load audio
    let buf = null;
    try {
      const res = await fetch('/api/stream?path=' + encodeURIComponent(path));
      const raw = await res.arrayBuffer();
      buf = await ctx.decodeAudioData(raw);
    } catch(e) { console.error('stem load error', e); }

    // Audio graph: gainNode (volume) → muteGain (mute/solo) → destination
    const gainNode = ctx.createGain();
    const muteGain = ctx.createGain();
    gainNode.connect(muteGain);
    muteGain.connect(ctx.destination);

    const track = { name, path, buf, gainNode, muteGain, source: null, muted: false, soloed: false, vol: 1 };
    _mixer.tracks.push(track);

    // Build row
    const row = document.createElement('div');
    row.className = 'smx-row';
    row.innerHTML = `
      <div class="smx-label">
        <div class="smx-top-row">
          <span class="smx-icon">${stemIcons[name] || '🎵'}</span>
          <span class="smx-name">${name}</span>
          <div class="smx-btns">
            <button class="smx-btn smx-m" title="Mute">M</button>
            <button class="smx-btn smx-s" title="Solo">S</button>
          </div>
        </div>
        <div class="smx-vol-wrap">
          <input type="range" class="smx-vol" min="0" max="1" step="0.01" value="1"/>
        </div>
      </div>
      <div class="smx-wave-wrap">
        <canvas class="smx-wave-canvas"></canvas>
        <div class="smx-progress"></div>
        <div class="smx-seek-overlay"></div>
        <span class="smx-time">0:00</span>
      </div>
    `;
    tracksWrap.appendChild(row);

    // Draw waveform after layout
    if (buf) {
      requestAnimationFrame(() => {
        const canvas = row.querySelector('.smx-wave-canvas');
        _drawStemWave(canvas, buf);
        document.getElementById('smxTotalTime').textContent = _fmtTime(buf.duration);
      });
    }

    // Mute
    row.querySelector('.smx-m').addEventListener('click', e => {
      track.muted = !track.muted;
      e.currentTarget.classList.toggle('active', track.muted);
      _updateSolo();
    });

    // Solo
    row.querySelector('.smx-s').addEventListener('click', e => {
      track.soloed = !track.soloed;
      e.currentTarget.classList.toggle('active', track.soloed);
      _updateSolo();
    });

    // Volume
    row.querySelector('.smx-vol').addEventListener('input', e => {
      track.vol = parseFloat(e.target.value);
      if (!track.muted) gainNode.gain.value = track.vol;
      _updateSolo();
    });

    // Seek on waveform click
    row.querySelector('.smx-seek-overlay').addEventListener('click', e => {
      if (!buf) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const pct  = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1));
      const off  = pct * buf.duration;
      _mixer.seekOff = off;
      if (_mixer.playingAll) _startMixerFrom(off);
      else {
        document.querySelectorAll('.smx-progress').forEach(el => el.style.width = pct * 100 + '%');
        document.querySelectorAll('.smx-time').forEach(el => el.textContent = _fmtTime(off));
      }
    });
  }

  // Play all button
  document.getElementById('smxPlayAll').addEventListener('click', e => {
    if (_mixer.playingAll) {
      _mixer.seekOff = _mixer.ctx.currentTime - _mixer.startedAt;
      _stopMixer();
      e.target.textContent = '▶';
    } else {
      if (ctx.state === 'suspended') ctx.resume();
      _startMixerFrom(_mixer.seekOff);
      e.target.textContent = '⏸';
    }
  });

  // Export button — open folder in Finder
  document.getElementById('smxExportBtn').addEventListener('click', () => {
    fetch('/api/open_stem?path=' + encodeURIComponent(dir + '/' + sorted[0]));
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
