// ── Custom File Picker Modal ──
import { loadAndPlay, stemIcons, getCurrentStemPath, getIsPlaying, pauseAudio } from './player.js';

const overlay   = document.getElementById('filePickerOverlay');
const closeBtn  = document.getElementById('filePickerClose');
const cancelBtn = document.getElementById('filePickerCancel');
const openBtn   = document.getElementById('filePickerOpen');
const listEl    = document.getElementById('filePickerList');
const breadEl   = document.getElementById('filePickerBreadcrumb');
const searchEl  = document.getElementById('filePickerSearch');
const titleEl   = document.getElementById('filePickerTitle');

let pickerCurrentPath = null;
let pickerSelected    = null;
let onPickCallback    = null;
let searchTimer       = null;

export function openFilePicker(callback) {
  onPickCallback = callback;
  pickerSelected = null;
  openBtn.disabled = true;
  searchEl.value = '';
  overlay.classList.remove('hidden');
  pickerNavigate(null);
}

function closePicker() {
  overlay.classList.add('hidden');
  pickerSelected = null;
  onPickCallback = null;
}

closeBtn.addEventListener('click', closePicker);
cancelBtn.addEventListener('click', closePicker);
overlay.addEventListener('click', e => { if (e.target === overlay) closePicker(); });

openBtn.addEventListener('click', () => {
  if (pickerSelected && onPickCallback) {
    onPickCallback(pickerSelected);
    closePicker();
  }
});

// Search inside picker
searchEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchEl.value.trim();
  if (!q) { pickerNavigate(pickerCurrentPath); return; }
  searchTimer = setTimeout(() => pickerSearch(q), 300);
});

async function pickerSearch(query) {
  const res  = await fetch('/api/fs/search?q=' + encodeURIComponent(query));
  const data = await res.json();
  listEl.innerHTML = '';
  titleEl.textContent = `Результаты: "${query}"`;

  if (!data.results || !data.results.length) {
    listEl.innerHTML = '<div class="picker-empty">Ничего не найдено</div>';
    return;
  }

  data.results.forEach(item => renderPickerRow(item, false));
}

async function pickerNavigate(path) {
  const url  = '/api/fs/list' + (path ? '?path=' + encodeURIComponent(path) : '');
  const res  = await fetch(url);
  const data = await res.json();
  if (data.error) return;

  pickerCurrentPath = data.path;
  pickerSelected    = null;
  openBtn.disabled  = true;
  searchEl.value    = '';

  // Breadcrumb
  breadEl.innerHTML = '';
  data.breadcrumb.forEach((part, i) => {
    const span = document.createElement('span');
    span.className = 'picker-crumb' + (i === data.breadcrumb.length - 1 ? ' active' : '');
    span.textContent = part.name || '/';
    if (i < data.breadcrumb.length - 1) {
      span.addEventListener('click', () => pickerNavigate(part.path));
    }
    breadEl.appendChild(span);
    if (i < data.breadcrumb.length - 1) {
      const sep = document.createElement('span');
      sep.className = 'picker-crumb-sep';
      sep.textContent = '›';
      breadEl.appendChild(sep);
    }
  });

  // Title = current folder name
  const last = data.breadcrumb[data.breadcrumb.length - 1];
  titleEl.textContent = last ? last.name : 'Файлы';

  // List
  listEl.innerHTML = '';
  if (!data.entries.length) {
    listEl.innerHTML = '<div class="picker-empty">Папка пуста</div>';
    return;
  }

  data.entries.forEach(entry => renderPickerRow(entry, true));
}

function renderPickerRow(entry, canNavigate) {
  const isAudio = /\.(mp3|wav|flac|aiff|m4a|ogg)$/i.test(entry.name);
  const icon    = entry.is_dir ? '📁' : (isAudio ? '🎵' : fileIcon(entry.name));

  const row = document.createElement('div');
  row.className = 'picker-row' + (entry.is_dir ? ' is-dir' : '');
  if (!entry.is_dir) row.dataset.path = entry.path;

  row.innerHTML = `
    <span class="picker-row-icon">${icon}</span>
    <span class="picker-row-name">${entry.name}</span>
    <span class="picker-row-size">${entry.is_dir ? '' : formatBytes(entry.size)}</span>
    ${isAudio && !entry.is_dir ? `<button class="picker-play-btn" data-path="${entry.path}" data-name="${entry.name}" title="Прослушать">▶</button>` : ''}
  `;

  // Select file
  if (!entry.is_dir) {
    row.addEventListener('click', e => {
      if (e.target.closest('.picker-play-btn')) return;
      document.querySelectorAll('.picker-row.selected').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      pickerSelected = entry.path;
      openBtn.disabled = false;
    });

    row.addEventListener('dblclick', e => {
      if (e.target.closest('.picker-play-btn')) return;
      if (onPickCallback) {
        onPickCallback(entry.path);
        closePicker();
      }
    });
  }

  // Navigate into folder
  if (entry.is_dir && canNavigate) {
    row.addEventListener('dblclick', () => pickerNavigate(entry.path));
    row.addEventListener('click', () => {
      document.querySelectorAll('.picker-row.selected').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
    });
  }

  // Play preview
  const playBtn = row.querySelector('.picker-play-btn');
  if (playBtn) {
    playBtn.addEventListener('click', e => {
      e.stopPropagation();
      const path = playBtn.dataset.path;
      const name = playBtn.dataset.name;
      if (getCurrentStemPath() === path && getIsPlaying()) {
        pauseAudio();
        playBtn.textContent = '▶';
      } else {
        document.querySelectorAll('.picker-play-btn').forEach(b => b.textContent = '▶');
        playBtn.textContent = '⏸';
        loadAndPlay(path, name, null);
      }
    });
  }

  listEl.appendChild(row);
}

// ── Sidebar quick locations ──
document.querySelectorAll('[data-picker-loc]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-picker-loc]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const loc = btn.dataset.pickerLoc;
    fetch('/api/fs/quickloc?loc=' + loc)
      .then(r => r.json())
      .then(d => { if (d.path) pickerNavigate(d.path); });
  });
});

// ── Up button ──
document.getElementById('filePickerUp').addEventListener('click', () => {
  if (!pickerCurrentPath) return;
  const parent = pickerCurrentPath.split('/').slice(0, -1).join('/') || '/';
  pickerNavigate(parent);
});

// ── Helpers ──
function fileIcon(name) {
  if (/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(name)) return '🖼';
  if (/\.(pdf)$/i.test(name)) return '📄';
  if (/\.(zip|rar|tar|gz)$/i.test(name)) return '📦';
  if (/\.(py|js|ts|html|css|json)$/i.test(name)) return '📝';
  if (/\.(mp4|mov|avi|mkv)$/i.test(name)) return '🎬';
  return '📄';
}

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}
