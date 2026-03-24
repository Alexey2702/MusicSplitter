// ── Navigation ──
import { fsCurrentPath, fsNavigate } from './fileManager.js';

const homeScreen = document.getElementById('homeScreen');
const topbarHint = document.getElementById('topbarHint');

export function showPanel(name) {
  homeScreen.classList.add('hidden');
  document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
  const panel = document.getElementById('panel-' + name);
  if (panel) panel.classList.remove('hidden');
  topbarHint.textContent = { files: 'Файлы', stems: 'Stem Splitter', bpm: 'BPM & Key' }[name] || '';
  if (name === 'files' && !fsCurrentPath) {
    requestAnimationFrame(() => fsNavigate(null));
  }
}

export function showHome() {
  document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
  homeScreen.classList.remove('hidden');
  topbarHint.textContent = 'Выбери режим';
}

document.querySelectorAll('.mode-card-big').forEach(card => {
  card.addEventListener('click', () => showPanel(card.dataset.mode));
});

document.getElementById('backFromFiles').addEventListener('click', showHome);
document.getElementById('backFromStems').addEventListener('click', showHome);
document.getElementById('backFromBpm').addEventListener('click', showHome);
