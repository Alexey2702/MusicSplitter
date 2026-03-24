// ── Track View — uses shared player engine ──
import {
  formatTime,
  loadAndPlay, pauseAudio, resumeAudio, stopAudio, seekTo,
  getIsPlaying, getCurrentStemPath, getAudioBuffer, getElapsed, getAnalyser,
  onTick, offTick, onStop, offStop, onLoad, offLoad,
} from './player.js';

// ── DOM ──
const tvTitle      = document.getElementById('tvTitle');
const tvMeta       = document.getElementById('tvMeta');
const tvWaveCanvas = document.getElementById('tvWaveCanvas');
const tvProgress   = document.getElementById('tvProgress');
const tvCurrent    = document.getElementById('tvCurrent');
const tvDuration   = document.getElementById('tvDuration');
const tvBtnPlay    = document.getElementById('tvBtnPlay');
const tvBtnStop    = document.getElementById('tvBtnStop');
const tvBtnBack10  = document.getElementById('tvBtnBack10');
const tvBtnFwd10   = document.getElementById('tvBtnFwd10');
const tvVolume     = document.getElementById('tvVolume');
const tvVolumeVal  = document.getElementById('tvVolumeVal');
const tvEqCanvas   = document.getElementById('tvEqCanvas');
const tvInfoGrid   = document.getElementById('tvInfoGrid');
const tvActSend    = document.getElementById('tvActSend');
const tvActFinder  = document.getElementById('tvActFinder');
const tvActCopy    = document.getElementById('tvActCopy');

// ── Local state (UI only) ──
let tvCurrentPath = null;
let tvEqRaf       = null;
let _pendingFile  = null; // file waiting for load callback

// ── Push analysis data to bottom player bar (inherited, no extra fetch) ──
export function pushAnalysisToBar(data) {
  const bpmEl = document.getElementById('playerBarBpm');
  const keyEl = document.getElementById('playerBarKey');
  if (!bpmEl || !keyEl) return;
  if (data) {
    bpmEl.textContent = data.bpm ? Math.round(data.bpm) + ' BPM' : '';
    keyEl.textContent = data.camelot || data.key || '';
    keyEl.dataset.key     = data.key     || '';
    keyEl.dataset.camelot = data.camelot || '';
    keyEl.dataset.mode    = data.mode    || '';
    keyEl.dataset.keyView = keyEl.dataset.keyView || 'camelot';
    keyEl.title = 'Нажмите для переключения формата';
  } else {
    bpmEl.textContent = '';
    keyEl.textContent = '';
  }
}

// ── Key display toggle on bottom bar key badge ──
document.getElementById('playerBarKey')?.addEventListener('click', () => {
  const el = document.getElementById('playerBarKey');
  if (!el.dataset.key) return;
  const next = el.dataset.keyView === 'camelot' ? 'key' : 'camelot';
  el.dataset.keyView = next;
  el.textContent = next === 'camelot' ? el.dataset.camelot : el.dataset.key;
});

// ── Key display toggle (click to switch between key name and Camelot) ──
document.getElementById('tvKeyVal').addEventListener('click', () => {
  const el = document.getElementById('tvKeyVal');
  if (!el.dataset.key) return;
  const next = el.dataset.keyView === 'camelot' ? 'key' : 'camelot';
  el.dataset.keyView = next;
  el.textContent = next === 'camelot' ? el.dataset.camelot : el.dataset.key;
});

// ── Sync tick from shared engine → big waveform progress ──
function _onTick(elapsed, duration) {
  if (!_isActivePanel()) return;
  tvProgress.style.width = (elapsed / duration * 100) + '%';
  tvCurrent.textContent  = formatTime(elapsed);
  tvBtnPlay.textContent  = '⏸';
}

function _onStop() {
  if (!_isActivePanel()) return;
  tvProgress.style.width = '0%';
  tvCurrent.textContent  = '0:00';
  tvBtnPlay.textContent  = '▶';
  _stopEq();
}

function _isActivePanel() {
  return !document.getElementById('panel-track').classList.contains('hidden');
}

// Register persistent listeners
onTick(_onTick);
onStop(_onStop);

// When engine finishes loading a new buffer — update TV UI
onLoad((buffer, path) => {
  if (path !== tvCurrentPath || !_pendingFile) return;
  const file = _pendingFile;
  _pendingFile = null;
  tvDuration.textContent = formatTime(buffer.duration);
  _drawTvWaveform(buffer);
  _fillInfo(file.path, file.name, file.size, buffer);
  _startEq();
});

// ── Open track ──
export function openTrackView(file) {
  tvCurrentPath = file.path;

  tvTitle.textContent    = file.name.replace(/\.[^.]+$/, '');
  tvMeta.textContent     = file.path;
  tvDuration.textContent = '...';
  tvInfoGrid.innerHTML   = '';

  // Sync UI to current engine state immediately
  _syncUI();

  // If same file already loaded — just sync, don't reload
  if (getCurrentStemPath() === file.path && getAudioBuffer()) {
    const buf = getAudioBuffer();
    tvDuration.textContent = formatTime(buf.duration);
    _drawTvWaveform(buf);
    _fillInfo(file.path, file.name, file.size, buf);
    if (getIsPlaying()) _startEq();
  } else {
    // Load via shared engine (stops whatever was playing)
    _pendingFile           = file;
    tvProgress.style.width = '0%';
    tvCurrent.textContent  = '0:00';
    tvBtnPlay.textContent  = '▶';
    _stopEq();
    loadAndPlay(file.path, file.name, null);
  }

  _runAnalysis(file.path);

  // Header actions
  tvActSend.onclick   = () => _goSplitter(file.path);
  tvActFinder.onclick = () => fetch('/api/open_stem?path=' + encodeURIComponent(file.path));
  tvActCopy.onclick   = () => { navigator.clipboard.writeText(file.path); _flash(tvActCopy, '✓'); };

  // Bottom actions
  document.getElementById('tvActStem').onclick    = () => _goSplitter(file.path);
  document.getElementById('tvActFinderB').onclick = () => fetch('/api/open_stem?path=' + encodeURIComponent(file.path));
  document.getElementById('tvActCopyB').onclick   = () => {
    navigator.clipboard.writeText(file.path);
    _flash(document.getElementById('tvActCopyB').querySelector('.tv-act-title'), '✓ Скопировано');
  };
}

// Sync big player UI to current engine state (called when panel becomes visible)
function _syncUI() {
  const buf = getAudioBuffer();
  if (!buf) return;
  const elapsed = getElapsed();
  tvProgress.style.width = (elapsed / buf.duration * 100) + '%';
  tvCurrent.textContent  = formatTime(elapsed);
  tvBtnPlay.textContent  = getIsPlaying() ? '⏸' : '▶';
  if (getIsPlaying()) _startEq();
}

// ── Controls — delegate to shared engine ──
tvBtnPlay.addEventListener('click', () => {
  if (getIsPlaying()) {
    pauseAudio();
    tvBtnPlay.textContent = '▶';
    _stopEq();
  } else {
    resumeAudio();
    tvBtnPlay.textContent = '⏸';
    _startEq();
  }
});

tvBtnStop.addEventListener('click', () => {
  stopAudio();
  _stopEq();
});

tvBtnBack10.addEventListener('click', () => {
  seekTo(getElapsed() - 10);
  if (getIsPlaying()) _startEq();
});

tvBtnFwd10.addEventListener('click', () => {
  seekTo(getElapsed() + 10);
  if (getIsPlaying()) _startEq();
});

tvVolume.addEventListener('input', () => {
  const v = parseFloat(tvVolume.value);
  tvVolumeVal.textContent = Math.round(v * 100) + '%';
  // Sync to bottom bar slider too
  const bottomSlider = document.getElementById('volumeSlider');
  if (bottomSlider) bottomSlider.value = v;
  // gainNode is internal to player — trigger its input event
  bottomSlider?.dispatchEvent(new Event('input'));
});

// Seek on big waveform click
tvWaveCanvas.addEventListener('click', e => {
  const buf = getAudioBuffer();
  if (!buf) return;
  const rect = tvWaveCanvas.getBoundingClientRect();
  const pct  = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1));
  seekTo(pct * buf.duration);
  if (getIsPlaying()) _startEq();
});

// ── Big Waveform ──
function _drawTvWaveform(buffer) {
  const canvas = tvWaveCanvas;
  const ctx    = canvas.getContext('2d');
  const W      = canvas.offsetWidth  || 800;
  const H      = canvas.offsetHeight || 120;
  canvas.width  = W;
  canvas.height = H;

  const data = buffer.getChannelData(0);
  const step = Math.ceil(data.length / W);
  const amp  = H / 2;
  ctx.clearRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath(); ctx.moveTo(0, H / 4 * i); ctx.lineTo(W, H / 4 * i); ctx.stroke();
  }

  for (let i = 0; i < W; i++) {
    let min = 1, max = -1;
    for (let j = 0; j < step; j++) {
      const v = data[i * step + j] || 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const intensity = Math.abs(max - min);
    const alpha = 0.25 + intensity * 0.75;
    const r = Math.round(124 + (34  - 124) * (i / W));
    const g = Math.round(92  + (211 - 92)  * (i / W));
    const b = Math.round(252 + (160 - 252) * (i / W));
    ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
    ctx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
  }
}

// ── Equalizer (reads from shared analyser) ──
function _startEq() {
  cancelAnimationFrame(tvEqRaf);
  _drawEq();
}

function _stopEq() {
  cancelAnimationFrame(tvEqRaf);
  tvEqRaf = null;
  const canvas = tvEqCanvas;
  if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

function _drawEq() {
  const analyser = getAnalyser();
  if (!analyser) return;
  const canvas = tvEqCanvas;
  const ctx    = canvas.getContext('2d');
  const W      = canvas.offsetWidth  || 400;
  const H      = canvas.offsetHeight || 80;
  canvas.width  = W;
  canvas.height = H;

  const bufLen   = analyser.frequencyBinCount;
  const freqData = new Uint8Array(bufLen);
  analyser.getByteFrequencyData(freqData);

  ctx.clearRect(0, 0, W, H);
  const barCount = 64;
  const barW     = (W / barCount) - 1;

  for (let i = 0; i < barCount; i++) {
    const idx  = Math.floor(i * bufLen / barCount);
    const val  = freqData[idx] / 255;
    const barH = Math.max(2, val * H);
    const x    = i * (barW + 1);
    const y    = H - barH;
    const t    = i / barCount;
    const r    = Math.round(124 * (1 - t) + 34  * t);
    const g    = Math.round(92  * (1 - t) + 211 * t);
    const b    = Math.round(252 * (1 - t) + 160 * t);
    ctx.fillStyle = `rgba(${r},${g},${b},0.9)`;
    ctx.fillRect(x, y, barW, barH);
    ctx.fillStyle = `rgba(${r},${g},${b},0.4)`;
    ctx.fillRect(x, y - 3, barW, 2);
  }

  tvEqRaf = requestAnimationFrame(_drawEq);
}

// ── Info grid ──
function _fillInfo(path, name, size, buffer) {
  const ext      = name.split('.').pop().toUpperCase();
  const channels = buffer.numberOfChannels === 2 ? 'Стерео' : 'Моно';
  const sr       = (buffer.sampleRate / 1000).toFixed(1) + ' kHz';
  const dur      = formatTime(buffer.duration);
  const sizeFmt  = size > 1024 * 1024
    ? (size / 1024 / 1024).toFixed(1) + ' MB'
    : (size / 1024).toFixed(0) + ' KB';
  const folder   = path.replace(/\\/g, '/').split('/').slice(0, -1).join('/');

  tvInfoGrid.innerHTML = [
    { label: 'Формат',       value: ext },
    { label: 'Длительность', value: dur },
    { label: 'Размер',       value: sizeFmt },
    { label: 'Каналы',       value: channels },
    { label: 'Sample Rate',  value: sr },
    { label: 'Папка',        value: folder, wide: true },
  ].map(it => `
    <div class="tv-info-item${it.wide ? ' wide' : ''}">
      <span class="tv-info-label">${it.label}</span>
      <span class="tv-info-value">${it.value}</span>
    </div>
  `).join('');
}

// ── Analysis ──
async function _runAnalysis(path) {
  const loading = document.getElementById('tvAnalysisLoading');
  const results = document.getElementById('tvAnalysisResults');
  const errEl   = document.getElementById('tvAnalysisError');

  loading.classList.remove('hidden');
  results.classList.add('hidden');
  errEl.classList.add('hidden');

  try {
    const res  = await fetch('/api/analyze?path=' + encodeURIComponent(path));
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    document.getElementById('tvBpmVal').textContent =
      data.bpm % 1 === 0 ? data.bpm.toFixed(0) : data.bpm.toFixed(1);

    const keyEl = document.getElementById('tvKeyVal');
    keyEl.dataset.key     = data.key;
    keyEl.dataset.camelot = data.camelot || '?';
    keyEl.dataset.mode    = data.mode;
    keyEl.dataset.keyView = keyEl.dataset.keyView || 'key'; // preserve mode on re-analyze
    keyEl.textContent = keyEl.dataset.keyView === 'camelot' ? data.camelot : data.key;
    keyEl.title = 'Нажмите для переключения формата';

    document.getElementById('tvEnergyPct').textContent = data.energy + '%';
    document.getElementById('tvEnergyBar').style.width = data.energy + '%';

    const strength = Math.round((data.key_strength || 0) * 100);
    document.getElementById('tvKeyStrengthPct').textContent = strength + '%';
    document.getElementById('tvKeyStrengthBar').style.width = strength + '%';

    loading.classList.add('hidden');
    results.classList.remove('hidden');
    pushAnalysisToBar(data);
  } catch(e) {
    loading.classList.add('hidden');
    errEl.classList.remove('hidden');
    errEl.textContent = '⚠️ ' + (e.message || 'Ошибка анализа');
    pushAnalysisToBar(null);
  }
}

// ── Called by nav.js when panel becomes visible ──
export function onTrackViewShow() {
  _syncUI();
  const buf = getAudioBuffer();
  if (buf && getCurrentStemPath() === tvCurrentPath) {
    requestAnimationFrame(() => _drawTvWaveform(buf));
    if (getIsPlaying()) _startEq();
  }
}

// ── Helpers ──
function _goSplitter(path) {
  import('./stems.js').then(m => {
    m.setFile(path);
    import('./nav.js').then(n => n.showPanel('stems'));
  });
}

function _flash(el, text) {
  if (!el) return;
  const orig = el.textContent;
  el.textContent = text;
  setTimeout(() => { el.textContent = orig; }, 1500);
}
