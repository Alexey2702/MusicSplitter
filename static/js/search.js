// ── Global Search ──
import { loadAndPlay } from './player.js';
import { setFile } from './stems.js';
import { showPanel } from './nav.js';

const searchInput   = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');
let searchTimer = null;

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (!q) { searchResults.classList.add('hidden'); return; }
  searchTimer = setTimeout(() => doSearch(q), 300);
});

searchInput.addEventListener('blur', () => {
  setTimeout(() => searchResults.classList.add('hidden'), 200);
});

searchInput.addEventListener('focus', () => {
  if (searchInput.value.trim()) searchResults.classList.remove('hidden');
});

async function doSearch(query) {
  const res  = await fetch('/api/fs/search?q=' + encodeURIComponent(query));
  const data = await res.json();
  searchResults.innerHTML = '';

  if (!data.results || !data.results.length) {
    searchResults.innerHTML = '<div style="padding:14px;text-align:center;color:var(--text3);font-size:13px">Ничего не найдено</div>';
    searchResults.classList.remove('hidden');
    return;
  }

  data.results.forEach(item => {
    const div = document.createElement('div');
    div.className = 'search-item';
    div.innerHTML = `
      <span class="search-item-icon">🎵</span>
      <div style="flex:1;overflow:hidden">
        <div class="search-item-name">${item.name}</div>
        <div class="search-item-path">${item.path}</div>
      </div>
      <button class="btn btn-secondary btn-sm" style="font-size:11px" data-send="${encodeURIComponent(item.path)}">⚡</button>
    `;
    div.addEventListener('click', e => {
      if (e.target.closest('[data-send]')) {
        showPanel('stems');
        setFile(decodeURIComponent(e.target.closest('[data-send]').dataset.send));
      } else {
        loadAndPlay(item.path, item.name, null);
      }
      searchResults.classList.add('hidden');
      searchInput.value = '';
    });
    searchResults.appendChild(div);
  });

  searchResults.classList.remove('hidden');
}
