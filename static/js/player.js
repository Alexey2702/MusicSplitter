// ── Player ──
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

let audioCtx        = null;
let audioBuffer     = null;
let sourceNode      = null;
let gainNode        = null;
let startedAt       = 0;
let seekOffset      = 0;
let isPlaying       = false;
let rafId           = null;
let _currentStemPath = null;
let currentStemCard  = null;
let isLoadingAudio   = false;

export const stemIcons = { vocals: '🎤', drums: '🥁', bass: '🎸', other: '🎹', instrumental: '🎼' };

export function getCurrentStemPath() { return _currentStemPath; }
export function getIsPlaying()       { return isPlaying; }

function getAudioCtx() {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

export async function loadAndPlay(path, name, card) {
  if (isLoadingAudio && _currentStemPath === path) return;
  _killSource();
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

  const ctx = getAudioCtx();
  if (ctx.state === 'suspended') await ctx.resume();

  try {
    const res = await fetch('/api/stream?path=' + encodeURIComponent(path));
    const raw = await res.arrayBuffer();
    if (_currentStemPath !== path) return;
    audioBuffer = await ctx.decodeAudioData(raw);
    isLoadingAudio = false;
    playerDuration.textContent = formatTime(audioBuffer.duration);
    drawWaveform(audioBuffer);
    _startFrom(0);
  } catch (e) {
    isLoadingAudio = false;
    console.error('Ошибка загрузки:', e);
  }
}

function _startFrom(offset) {
  if (!audioBuffer) return;
  _killSource();
  const ctx = getAudioCtx();
  sourceNode = ctx.createBufferSource();
  sourceNode.buffer = audioBuffer;
  gainNode = ctx.createGain();
  gainNode.gain.value = parseFloat(volumeSlider.value);
  sourceNode.connect(gainNode);
  gainNode.connect(ctx.destination);
  sourceNode.start(0, offset);
  startedAt  = ctx.currentTime - offset;
  seekOffset = offset;
  isPlaying  = true;
  sourceNode.onended = () => {
    if (!isPlaying) return;
    const elapsed = ctx.currentTime - startedAt;
    if (elapsed >= audioBuffer.duration - 0.1) {
      isPlaying = false;
      seekOffset = 0;
      _setPlayBtn(false);
      progressLine.style.width = '0%';
      playerCurrent.textContent = '0:00';
      cancelAnimationFrame(rafId);
    }
  };
  cancelAnimationFrame(rafId);
  _tick();
}

function _tick() {
  if (!isPlaying || !audioBuffer) return;
  const elapsed = Math.min(audioCtx.currentTime - startedAt, audioBuffer.duration);
  progressLine.style.width = (elapsed / audioBuffer.duration * 100) + '%';
  playerCurrent.textContent = formatTime(elapsed);
  rafId = requestAnimationFrame(_tick);
}

function _killSource() {
  cancelAnimationFrame(rafId);
  if (sourceNode) {
    sourceNode.onended = null;
    try { sourceNode.stop(); } catch(e) {}
    sourceNode = null;
  }
  isPlaying = false;
}

function _setPlayBtn(playing) {
  btnPlay.textContent = playing ? '⏸' : '▶';
  if (currentStemCard) {
    currentStemCard.textContent = playing ? '⏸' : '▶';
    currentStemCard.classList.toggle('playing', playing);
  }
}

export function pauseAudio() {
  if (!isPlaying || !audioCtx) return;
  seekOffset = audioCtx.currentTime - startedAt;
  _killSource();
  _setPlayBtn(false);
}

export async function resumeAudio() {
  if (isPlaying || !audioBuffer) return;
  const ctx = getAudioCtx();
  if (ctx.state === 'suspended') await ctx.resume();
  _startFrom(seekOffset);
  _setPlayBtn(true);
}

export function stopAudio() {
  _killSource();
  seekOffset = 0;
  isLoadingAudio = false;
  progressLine.style.width = '0%';
  playerCurrent.textContent = '0:00';
  _setPlayBtn(false);
}

function drawWaveform(buffer) {
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

// ── Events ──
waveformCanvas.addEventListener('click', e => {
  if (!audioBuffer) return;
  const rect   = waveformCanvas.getBoundingClientRect();
  const pct    = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1));
  const offset = pct * audioBuffer.duration;
  progressLine.style.width  = (pct * 100) + '%';
  playerCurrent.textContent = formatTime(offset);
  _startFrom(offset);
  _setPlayBtn(true);
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

volumeSlider.addEventListener('input', () => {
  if (gainNode) gainNode.gain.value = parseFloat(volumeSlider.value);
});
