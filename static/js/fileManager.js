// ── File Manager Panel ──
import { loadAndPlay, getCurrentStemPath, getIsPlaying, pauseAudio } from './player.js';
// Lazy imports to avoid circular dependencies
async function showPanel(name) {
  const { showPanel: _show } = await import('./nav.js');
  _show(name);
}

async function setFile(path) {
  const { setFile: _set } = await import('./stems.js');
  _set(path);
}

export let fsCurrentPath = null;
let ctxTarget = null;

const fsList       = document.getElementById('fsList');
const fsBreadcrumb = document.getElementById('fsBreadcrumb');
const ctxMenu      = document.getElementById('ctxMenu');

document.getElementById('fsHome').addEventListener('click', () => fsNavigate(null));
document.getElementById('fsUp').addEventListener('click', fsGoUp);
document.getElementById('fsMkdir').addEventListener('click', fsMkdir);

export async function fsNavigate(path) {
  const url  = '/api/fs/list' + (path ? '?path=' + encodeURIComponent(path) : '');
  const res  = await fetch(url);
  const data = await res.json();
  if (data.error) return;

  fsCurrentPath = data.path;

  // Breadcrumb
  fsBreadcrumb.innerHTML = '';
  data.breadcrumb.forEach((part, i) => {
    const span = document.createElement('span');
    span.className = 'breadcrumb-item' + (i === data.breadcrumb.length - 1 ? ' last' : '');
    span.textContent = part.name || '/';
    if (i < data.breadcrumb.length - 1) span.addEventListener('click', () => fsNavigate(part.path));
    fsBreadcrumb.appendChild(span);
    if (i < data.breadcrumb.length - 1) {
      const sep = document.createElement('span');
      sep.className = 'breadcrumb-sep';
      sep.textContent = '›';
      fsBreadcrumb.appendChild(sep);
    }
  });

  // Entries
  fsList.innerHTML = '';
  if (!data.entries.length) {
    fsList.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text3);font-size:13px">Папка пуста</div>';
    return;
  }

  data.entries.forEach(entry => {
    const row = document.createElement('div');
    row.className = 'fs-entry' + (entry.is_dir ? ' is-dir' : '');
    row.dataset.path  = entry.path;
    row.dataset.isDir = entry.is_dir;
    row.dataset.name  = entry.name;

    const isAudio = /\.(mp3|wav|flac|aiff|m4a|ogg)$/i.test(entry.name);
    const icon    = entry.is_dir ? '📁' : (isAudio ? '🎵' : fileIcon(entry.name));

    const actionsHtml = entry.is_dir ? '' : `
      ${isAudio ? `<button class="fs-action-btn play" data-action="play" data-path="${encodeURIComponent(entry.path)}" data-name="${encodeURIComponent(entry.name)}">▶</button>` : ''}
      ${isAudio ? `<button class="fs-action-btn" data-action="open" data-path="${encodeURIComponent(entry.path)}" data-name="${encodeURIComponent(entry.name)}" data-size="${entry.size || 0}" title="Открыть трек">↗</button>` : ''}
      ${isAudio ? `<button class="fs-action-btn" data-action="send" data-path="${encodeURIComponent(entry.path)}">⚡</button>` : ''}
    `;

    row.innerHTML = `
      <span class="fs-icon">${icon}</span>
      <span class="fs-name">${entry.name}</span>
      <span class="fs-size">${entry.is_dir ? '' : formatBytes(entry.size)}</span>
      <div class="fs-actions">${actionsHtml}</div>
    `;

    row.addEventListener('dblclick', () => {
      if (entry.is_dir) fsNavigate(entry.path);
      else if (/\.(mp3|wav|flac|aiff|m4a|ogg)$/i.test(entry.name)) openTrackView(entry);
    });
    row.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      e.stopPropagation();
      const action = btn.dataset.action;
      const path   = decodeURIComponent(btn.dataset.path);
      const name   = btn.dataset.name ? decodeURIComponent(btn.dataset.name) : '';
      const size   = parseInt(btn.dataset.size || '0');
      if (action === 'play') fsPlayFile(path, name);
      if (action === 'open') openTrackView({ path, name, size });
      if (action === 'send') fsSendToSplitter(path);
    });
    row.addEventListener('contextmenu', e => { e.preventDefault(); showCtxMenu(e.clientX, e.clientY, entry); });
    fsList.appendChild(row);
  });
}

function fsGoUp() {
  if (!fsCurrentPath) return;
  const parent = fsCurrentPath.split('/').slice(0, -1).join('/') || '/';
  fsNavigate(parent);
}

async function fsMkdir() {
  const name = prompt('Название новой папки:');
  if (!name) return;
  await fetch('/api/fs/mkdir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: fsCurrentPath + '/' + name })
  });
  fsNavigate(fsCurrentPath);
}

function fsPlayFile(path, name) { loadAndPlay(path, name, null); }

function fsSendToSplitter(path) {
  showPanel('stems');
  setFile(path);
}

async function openTrackView(entry) {
  const { openTrackView: _open } = await import('./trackView.js');
  _open({ path: entry.path, name: entry.name, size: entry.size || 0 });
  showPanel('track');
}

// ── Context menu ──
function showCtxMenu(x, y, entry) {
  ctxTarget = entry;
  const isAudio = /\.(mp3|wav|flac|aiff|m4a|ogg)$/i.test(entry.name);
  document.getElementById('ctxOpen').style.display   = isAudio && !entry.is_dir ? '' : 'none';
  document.getElementById('ctxPlay').style.display   = isAudio && !entry.is_dir ? '' : 'none';
  document.getElementById('ctxSend').style.display   = isAudio && !entry.is_dir ? '' : 'none';
  ctxMenu.style.left = x + 'px';
  ctxMenu.style.top  = y + 'px';
  ctxMenu.classList.remove('hidden');
}

document.addEventListener('click', () => ctxMenu.classList.add('hidden'));

document.getElementById('ctxOpen').addEventListener('click', () => {
  if (ctxTarget) openTrackView(ctxTarget);
});
document.getElementById('ctxSend').addEventListener('click', () => {
  if (ctxTarget) fsSendToSplitter(ctxTarget.path);
});
document.getElementById('ctxRename').addEventListener('click', async () => {
  if (!ctxTarget) return;
  const newName = prompt('Новое имя:', ctxTarget.name);
  if (!newName || newName === ctxTarget.name) return;
  await fetch('/api/fs/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: ctxTarget.path, new_name: newName })
  });
  fsNavigate(fsCurrentPath);
});
document.getElementById('ctxCopyPath').addEventListener('click', () => {
  if (ctxTarget) navigator.clipboard.writeText(ctxTarget.path);
});
document.getElementById('ctxDelete').addEventListener('click', async () => {
  if (!ctxTarget) return;
  if (!confirm(`Удалить "${ctxTarget.name}"?`)) return;
  await fetch('/api/fs/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: ctxTarget.path })
  });
  fsNavigate(fsCurrentPath);
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
