import { CARDS, CATEGORIES, STAGE_THEMES } from './cards-data.js';
import { isFavoriteCard, toggleFavoriteCard, getFavoriteCount } from './favorites.js';

let parentCurrentStage = 'all';
let parentCurrentCategory = 'all';
let parentSearchKeyword = '';
let renderedParentCount = 30;
let filteredCache = [];

let selectedSetRef = null;
let onPlaySelectedCallback = null;
let onCloseFilterCallback = null;

export function initParentSelect(selectedSet, callbacks = {}) {
  selectedSetRef = selectedSet;
  onPlaySelectedCallback = callbacks.onPlaySelected || null;
  onCloseFilterCallback = callbacks.onClose || null;

  document.getElementById('btn-play-selected').addEventListener('click', () => {
    if (selectedSetRef.size === 0) {
      alert('선택된 카드가 없습니다. 카드를 1장 이상 선택해 주세요.');
      return;
    }
    if (onPlaySelectedCallback) {
      onPlaySelectedCallback(CARDS.filter(c => selectedSetRef.has(c.id)));
    }
  });

  document.getElementById('parent-search-input').addEventListener('input', (e) => {
    parentSearchKeyword = e.target.value;
    document.getElementById('btn-clear-search').classList.toggle('hidden', parentSearchKeyword.length === 0);
    refreshParentFilteredList();
  });

  document.getElementById('btn-clear-search').addEventListener('click', () => {
    document.getElementById('parent-search-input').value = '';
    parentSearchKeyword = '';
    document.getElementById('btn-clear-search').classList.add('hidden');
    refreshParentFilteredList();
  });

  document.getElementById('btn-apply-range').addEventListener('click', applyNumberRangeInput);

  document.querySelectorAll('.stage-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      parentCurrentStage = btn.getAttribute('data-stage');
      renderParentView();
    });
  });

  document.getElementById('btn-select-visible').addEventListener('click', () => {
    filteredCache.forEach(c => selectedSetRef.add(c.id));
    renderParentCardsGrid(false);
    updateSelectedCountsUI();
  });

  document.getElementById('btn-deselect-all').addEventListener('click', () => {
    selectedSetRef.clear();
    renderParentCardsGrid(false);
    updateSelectedCountsUI();
  });

  document.getElementById('parent-card-grid').addEventListener('scroll', (e) => {
    const el = e.currentTarget;
    if (renderedParentCount >= filteredCache.length) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
      renderedParentCount += 30;
      renderParentCardsGrid(true);
    }
  });

  document.getElementById('btn-close-filter').addEventListener('click', () => {
    if (onCloseFilterCallback) onCloseFilterCallback();
  });
}

export function renderParentView() {
  const container = document.getElementById('filter-tags-container');
  container.innerHTML = '';

  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = `px-3 py-1 rounded-xl border shrink-0 text-xs font-black shadow-xs transition btn-jelly ${
    parentCurrentCategory === 'all'
      ? 'bg-slate-900 text-white border-slate-900 ring-2 ring-slate-900/30'
      : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
  }`;
  allBtn.textContent = '전체 인덱스';
  allBtn.addEventListener('click', () => {
    parentCurrentCategory = 'all';
    renderParentView();
  });
  container.appendChild(allBtn);

  const tagWrap = document.createElement('div');
  tagWrap.className = 'flex flex-wrap items-center gap-1.5 flex-1 min-w-0';

  const favActive = parentCurrentCategory === 'FAVORITE';
  const favBtn = document.createElement('button');
  favBtn.type = 'button';
  favBtn.className = `px-2.5 py-1 rounded-full border shrink-0 text-xs font-black flex items-center gap-1 transition shadow-xs btn-jelly ${
    favActive
      ? 'bg-amber-400 text-slate-900 border-amber-500 ring-2 ring-amber-300'
      : 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100'
  }`;
  favBtn.innerHTML = `<i class="fa-solid fa-star text-amber-500 text-[10px]"></i><span>즐겨찾기 (${getFavoriteCount()})</span>`;
  favBtn.addEventListener('click', () => {
    parentCurrentCategory = favActive ? 'all' : 'FAVORITE';
    renderParentView();
  });
  tagWrap.appendChild(favBtn);

  CATEGORIES.forEach(cat => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const active = parentCurrentCategory === cat;
    if (cat === 'MAGIC') {
      btn.className = `px-2.5 py-1 rounded-full border shrink-0 text-xs font-black flex items-center gap-1 transition shadow-xs btn-jelly ${
        active
          ? 'bg-amber-400 text-slate-900 border-amber-400 ring-2 ring-amber-300'
          : 'bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-200'
      }`;
      btn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles text-[9px]"></i> MAGIC`;
    } else {
      btn.className = `px-2.5 py-1 rounded-full border shrink-0 text-xs font-bold transition shadow-xs btn-jelly ${
        active
          ? 'bg-blue-600 text-white border-blue-600 ring-2 ring-blue-400/40'
          : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
      }`;
      btn.textContent = cat;
    }
    btn.addEventListener('click', () => {
      parentCurrentCategory = active ? 'all' : cat;
      renderParentView();
    });
    tagWrap.appendChild(btn);
  });

  container.appendChild(tagWrap);

  document.querySelectorAll('.stage-tab-btn').forEach(btn => {
    const st = btn.getAttribute('data-stage');
    if (parentCurrentStage === st) {
      btn.classList.remove('opacity-45', 'scale-95');
      btn.classList.add('opacity-100', 'ring-2', 'ring-offset-1', 'ring-slate-800', 'scale-105');
    } else {
      btn.classList.remove('opacity-100', 'ring-2', 'ring-offset-1', 'ring-slate-800', 'scale-105');
      btn.classList.add('opacity-45', 'scale-95');
    }
  });

  refreshParentFilteredList();
  updateSelectedCountsUI();
}

function refreshParentFilteredList() {
  const q = parentSearchKeyword.trim().toLowerCase();
  filteredCache = CARDS.filter(c => {
    if (parentCurrentStage !== 'all' && c.stage !== parentCurrentStage) return false;
    if (parentCurrentCategory === 'FAVORITE') {
      if (!isFavoriteCard(c.id)) return false;
    } else if (parentCurrentCategory !== 'all' && !c.cats.includes(parentCurrentCategory)) {
      return false;
    }
    if (q) {
      const matchId = String(c.id) === q;
      const matchWord = c.word.toLowerCase().includes(q);
      const matchCat = c.cats.some(cat => cat.toLowerCase().includes(q));
      if (!matchId && !matchWord && !matchCat) return false;
    }
    return true;
  });

  renderedParentCount = 30;
  renderParentCardsGrid(false);
}

function renderParentCardsGrid(append = false) {
  const grid = document.getElementById('parent-card-grid');
  const moreInfo = document.getElementById('parent-load-more');

  if (!append) grid.innerHTML = '';

  if (filteredCache.length === 0) {
    const emptyMsg = parentCurrentCategory === 'FAVORITE'
      ? '즐겨찾기(★)에 등록된 카드가 아직 없습니다.'
      : '일치하는 카드가 없습니다.';
    grid.innerHTML = `<div class="col-span-full py-12 text-center text-slate-400 font-bold text-xs">${emptyMsg}</div>`;
    moreInfo.classList.add('hidden');
    return;
  }

  const startIndex = append ? grid.children.length : 0;
  const targetList = filteredCache.slice(startIndex, renderedParentCount);

  targetList.forEach(c => {
    const isSelected = selectedSetRef.has(c.id);
    const isFav = isFavoriteCard(c.id);
    const cardBox = document.createElement('div');
    const stStyle = STAGE_THEMES[c.stage] || STAGE_THEMES['1단계'];

    cardBox.className = `h-fit self-start p-2 rounded-xl border-2 transition cursor-pointer select-none flex flex-col justify-between gap-1.5 ${
      isSelected
        ? 'bg-blue-50/70 border-blue-600 shadow-xs ring-1 ring-blue-600'
        : 'bg-white border-slate-200 hover:border-slate-300 opacity-75 hover:opacity-100'
    }`;

    cardBox.innerHTML = `
      <div class="w-full aspect-[2.1/1] rounded-lg bg-slate-100 border border-slate-200 overflow-hidden relative">
        <img src="images/${c.id}.jpg" loading="lazy" decoding="async" class="w-full h-full object-cover">
        <div class="absolute top-1 left-1 bg-black/60 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold text-white flex items-center gap-1">
          ${c.id}
          ${c.isMagic ? '<i class="fa-solid fa-wand-magic-sparkles text-amber-300 text-[8px]"></i>' : ''}
        </div>
        <button type="button" title="즐겨찾기" class="fav-star-btn absolute bottom-1 left-1 w-5 h-5 rounded-full bg-black/55 hover:bg-black/75 flex items-center justify-center transition">
          <i class="${isFav ? 'fa-solid fa-star text-amber-400' : 'fa-regular fa-star text-white/80'} text-[10px]"></i>
        </button>
        <div class="selection-check-badge absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center border ${
          isSelected ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white/80 border-slate-300 text-transparent'
        }">
          <i class="fa-solid fa-check text-[9px]"></i>
        </div>
      </div>
      <div class="flex items-start justify-between px-0.5 gap-1 min-h-[26px]">
        <p class="gothic-font text-[11px] sm:text-xs font-black text-slate-900 break-words leading-tight flex-1">${c.word}</p>
        <span class="text-[9px] font-bold px-1 rounded text-white shrink-0 ${stStyle.bg}">${stStyle.name}</span>
      </div>
    `;

    const starBtn = cardBox.querySelector('.fav-star-btn');
    starBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const nowFav = toggleFavoriteCard(c.id);
      starBtn.innerHTML = `<i class="${nowFav ? 'fa-solid fa-star text-amber-400' : 'fa-regular fa-star text-white/80'} text-[10px]"></i>`;
      if (parentCurrentCategory === 'FAVORITE') {
        renderParentView();
      }
    });

    cardBox.addEventListener('click', () => toggleCardSelection(c.id, cardBox));
    grid.appendChild(cardBox);
  });

  moreInfo.classList.toggle('hidden', renderedParentCount >= filteredCache.length);
}

function toggleCardSelection(cardId, cardBox) {
  if (selectedSetRef.has(cardId)) {
    selectedSetRef.delete(cardId);
    cardBox.className = "h-fit self-start p-2 rounded-xl border-2 transition cursor-pointer select-none flex flex-col justify-between gap-1.5 bg-white border-slate-200 hover:border-slate-300 opacity-75 hover:opacity-100";
    const badge = cardBox.querySelector('.selection-check-badge');
    if (badge) badge.className = "selection-check-badge absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center border bg-white/80 border-slate-300 text-transparent";
  } else {
    selectedSetRef.add(cardId);
    cardBox.className = "h-fit self-start p-2 rounded-xl border-2 transition cursor-pointer select-none flex flex-col justify-between gap-1.5 bg-blue-50/70 border-blue-600 shadow-xs ring-1 ring-blue-600";
    const badge = cardBox.querySelector('.selection-check-badge');
    if (badge) badge.className = "selection-check-badge absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center border bg-blue-600 border-blue-600 text-white";
  }
  updateSelectedCountsUI();
}

function updateSelectedCountsUI() {
  const count = selectedSetRef.size;
  document.getElementById('current-selected-stat').textContent = count;
  document.getElementById('btn-selected-count').textContent = count;
}

function applyNumberRangeInput() {
  const input = document.getElementById('parent-range-input');
  const val = input.value.trim();
  if (!val) return;

  const parts = val.split(/[,\s]+/);
  let addedCount = 0;

  parts.forEach(part => {
    if (part.includes('-') || part.includes('~')) {
      const [startStr, endStr] = part.split(/[-~]/);
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (!isNaN(start) && !isNaN(end)) {
        const min = Math.max(1, Math.min(start, end));
        const max = Math.min(510, Math.max(start, end));
        for (let i = min; i <= max; i++) {
          selectedSetRef.add(i);
          addedCount++;
        }
      }
    } else {
      const num = parseInt(part, 10);
      if (!isNaN(num) && num >= 1 && num <= 510) {
        selectedSetRef.add(num);
        addedCount++;
      }
    }
  });

  renderParentCardsGrid(false);
  updateSelectedCountsUI();
  input.value = '';
  if (addedCount > 0) alert('선택 목록에 담겼습니다.');
}
