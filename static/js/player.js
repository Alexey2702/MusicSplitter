// ── Player (single audio engine) ──
const playerBar       = document.getElementById('playerBar');
const playerIcon      = document.getElementById('playerIcon');
const playerTrackName = document.getElementById('playerTrackName');
const playerCurrent   = document.getElementById('playerCurrent');
const playerDuration  = document.getElementById('playerDuration');
const btnPlay         = document.getElementById('btnPlay');
const btnStop         = document.getElementById('btnStop');
const waveformCanvas  = document.getElementById('waveformCanvas');
const progressLine    = document.getElementById('progressLine');
const volumeSlider    = document.getElementById('volumeSlider');

let audioCtx         = null;
let analyserNode     = null;
let audioBuffer      = null;  // kept for waveform draw + trackView compat
let mediaEl          = null;  // HTMLAudioElement — actual playback engine
let mediaSource      = null;  // MediaElementSourceNode
let gainNode         = null;
let isPlaying        = false;
let rafId            = null;
let _currentStemPath = null;
let currentStemCard  = null;
let isLoadingAudio   = false;
let seekOffset       = 0;

const _tickCbs  = new Set();
const _stopCbs  = new Set();
const _loadCbs  = new Set();

export const stemIcons = { vocals: '🎤', drums: '🥁', bass: '🎸', other: '🎹', instrumental: '🎼' };

export function getCurrentStemPath() { return _currentStemPath; }
export function getIsPlaying()       { return isPlaying; }
export function getAudioBuffer()     { return audioBuffer; }
export function getSeekOffset()      { return seekOffset; }
export function getElapsed()         { return mediaEl ? mediaEl.currentTime : 0; }
export function getAnalyser()        { return analyserNode; }

export function onTick(cb)  { _tickCbs.add(cb); }
export function offTick(cb) { _tickCbs.delete(cb); }
export function onStop(cb)  { _stopCbs.add(cb); }
export function offStop(cb) { _stopCbs.delete(cb); }
export function onLoad(cb)  { _loadCbs.add(cb); }
export function offLoad(cb) { _loadCbs.delete(cb); }

function _getCtx() {
  if (!audioCtx) {
    audioCtx     = new AudioContext();
    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 256;
    analyserNode.connect(audioCtx.destination);
  }
  return audioCtx;
}

function _killMedia() {
  cancelAnimationFrame(rafId);
  if (mediaEl) {
    mediaEl.pause();
    mediaEl.src = '';
    mediaEl.onended = null;
    mediaEl.ontimeupdate = null;
  }
  isPlaying = false;
}

export async function loadAndPlay(path, name, card) {
  if (isLoadingAudio && _currentStemPath === path) return;
  _killMedia();
  isLoadingAudio   = true;
  _currentStemPath = path;
  currentStemCard  = card || null;
  audioBuffer      = null;
  seekOffset       = 0;

  playerBar.classList.remove('hidden');
  playerIcon.textContent      = stemIcons[name] || '🎵';
  playerTrackName.textContent = name.replace(/\.[^.]+$/, '');
  playerCurrent.textContent   = '0:00';
  playerDuration.textContent  = '...';
  _setPlayBtn(true);

  const ctx = _getCtx();
  if (ctx.state === 'suspended') await ctx.resume();

  // ── HTMLAudioElement for instant streaming playback ──
  if (mediaSource) { try { mediaSource.disconnect(); } catch(e){} }
  mediaEl = new Audio();
  mediaEl.crossOrigin = 'anonymous';
  mediaEl.src = '/api/stream?path=' + encodeURIComponent(path);
  mediaEl.volume = parseFloat(volumeSlider.value);

  mediaSource = ctx.createMediaElementSource(mediaEl);
  gainNode    = ctx.createGain();
  gainNode.gain.value = parseFloat(volumeSlider.value);
  mediaSource.connect(gainNode);
  gainNode.connect(analyserNode);

  mediaEl.addEventListener('loadedmetadata', () => {
    if (_currentStemPath !== path) return;
    playerDuration.textContent = formatTime(mediaEl.duration);
    isLoadingAudio = false;
  }, { once: true });

  mediaEl.addEventListener('ended', () => {
    isPlaying = false;
    seekOffset = 0;
    _setPlayBtn(false);
    progressLine.style.width  = '0%';
    playerCurrent.textContent = '0:00';
    cancelAnimationFrame(rafId);
    _stopCbs.forEach(cb => cb());
  });

  await mediaEl.play().catch(e => console.error('play error', e));
  isPlaying = true;
  _tick();

  // ── Fetch full buffer in background for waveform + trackView ──
  fetch('/api/stream?path=' + encodeURIComponent(path))
    .then(r => r.arrayBuffer())
    .then(raw => ctx.decodeAudioData(raw))
    .then(buf => {
      if (_currentStemPath !== path) return;
      audioBuffer = buf;
      _drawWaveform(buf);
      _loadCbs.forEach(cb => cb(buf, path));
    })
    .catch(() => {});
}

export function seekTo(offset) {
  if (!mediaEl) return;
  const dur = mediaEl.duration || 0;
  seekOffset = Math.max(0, Math.min(offset, dur - 0.01));
  mediaEl.currentTime = seekOffset;
  const pct = dur > 0 ? seekOffset / dur * 100 : 0;
  progressLine.style.width  = pct + '%';
  playerCurrent.textContent = formatTime(seekOffset);
  _tickCbs.forEach(cb => cb(seekOffset, dur));
}

function _tick() {
  if (!isPlaying || !mediaEl) return;
  const elapsed = mediaEl.currentTime;
  const dur     = mediaEl.duration || 1;
  progressLine.style.width  = (elapsed / dur * 100) + '%';
  playerCurrent.textContent = formatTime(elapsed);
  _tickCbs.forEach(cb => cb(elapsed, dur));
  rafId = requestAnimationFrame(_tick);
}

function _setPlayBtn(playing) {
  btnPlay.textContent = playing ? '⏸' : '▶';
  if (currentStemCard) {
    currentStemCard.textContent = playing ? '⏸' : '▶';
    currentStemCard.classList.toggle('playing', playing);
  }
}

export function pauseAudio() {
  if (!isPlaying || !mediaEl) return;
  seekOffset = mediaEl.currentTime;
  mediaEl.pause();
  isPlaying = false;
  cancelAnimationFrame(rafId);
  _setPlayBtn(false);
}

export async function resumeAudio() {
  if (isPlaying || !mediaEl) return;
  const ctx = _getCtx();
  if (ctx.state === 'suspended') await ctx.resume();
  await mediaEl.play().catch(e => console.error('resume error', e));
  isPlaying = true;
  _tick();
  _setPlayBtn(true);
}

export function stopAudio() {
  _killMedia();
  seekOffset = 0;
  isLoadingAudio = false;
  progressLine.style.width  = '0%';
  playerCurrent.textContent = '0:00';
  _setPlayBtn(false);
  _stopCbs.forEach(cb => cb());
}

function _drawWaveform(buffer) {
  const canvas = waveformCanvas;
  const ctx    = canvas.getContext('2d');
  const W      = canvas.parentElement.offsetWidth || 400;
  const H      = canvas.parentElement.offsetHeight || 36;
  canvas.width  = W;
  canvas.height = H;
  const data = buffer.getChannelData(0);
  const step = Math.ceil(data.length / W);
  const amp  = H / 2;
  ctx.clearRect(0, 0, W, H);
  for (let i = 0; i < W; i++) {
    let min = 1, max = -1;
    for (let j = 0; j < step; j++) {
      const v = data[i * step + j] || 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const alpha = 0.3 + Math.abs(max - min) * 0.7;
    ctx.fillStyle = `rgba(167,139,250,${alpha})`;
    ctx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
  }
}

export function formatTime(sec) {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Bottom bar events ──
waveformCanvas.addEventListener('click', e => {
  if (!mediaEl || !mediaEl.duration) return;
  const rect = waveformCanvas.getBoundingClientRect();
  const pct  = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1));
  seekTo(pct * mediaEl.duration);
});

btnPlay.addEventListener('click', () => {
  if (isPlaying) pauseAudio(); else resumeAudio();
});

btnStop.addEventListener('click', () => {
  stopAudio();
  _currentStemPath = null;
  playerBar.classList.add('hidden');
  document.querySelectorAll('.stem-play-btn').forEach(b => {
    b.textContent = '▶'; b.classList.remove('playing');
  });
});

document.getElementById('btnOpenTrackView').addEventListener('click', () => {
  if (!_currentStemPath) return;
  import('./trackView.js').then(m => {
    m.openTrackView({
      path: _currentStemPath,
      name: playerTrackName.textContent,
      size: 0,
    });
    import('./nav.js').then(n => n.showPanel('track'));
  });
});

// ── Auto-analyze on any new track load → push BPM/key to bottom bar ──
let _lastAnalyzedPath = null;
onLoad((buffer, path) => {
  if (path === _lastAnalyzedPath) return;
  _lastAnalyzedPath = path;
  import('./trackView.js').then(m => m.pushAnalysisToBar(null));
  fetch('/api/analyze?path=' + encodeURIComponent(path))
    .then(r => r.json())
    .then(data => {
      if (path !== _currentStemPath) return;
      import('./trackView.js').then(m => m.pushAnalysisToBar(data));
    })
    .catch(() => {});
});

volumeSlider.addEventListener('input', () => {
  const v = parseFloat(volumeSlider.value);
  if (gainNode) gainNode.gain.value = v;
  if (mediaEl)  mediaEl.volume = v;
});
