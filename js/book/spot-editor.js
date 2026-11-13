import { SONGS_DB, isVocaTrackId } from '../config/r2-config.js';
import {
  getSpotsForPage,
  isVocaLinkSpot,
  saveSpotsToCloud,
  detectDefaultVocaEndPage,
  collectVocaCardsInRange
} from './spots-sync.js';
import { preloadTrackList } from './audio-ducking.js';
import { ensureOcrWorker, detectCardNumberFromCorner } from './card-ocr.js';

let isSpotEditMode = false;
let currentShape = 'circle';
let circleSize = 12.0;
let rectW = 26.0;
let rectH = 12.0;
let vocaW = 20.5;
let vocaH = 6.0;

let pendingSpotContext = null;
let pendingVocaContext = null;
let editorDeps = null;

export function isEditModeActive() {
  return isSpotEditMode;
}

export function initSpotEditor(deps) {
  editorDeps = deps;

  document.getElementById('btn-edit-spots').addEventListener('click', toggleSpotEditMode);
  document.getElementById('btn-shape-circle').addEventListener('click', () => setBrushShape('circle'));
  document.getElementById('btn-shape-rect').addEventListener('click', () => setBrushShape('rect'));
  document.getElementById('btn-shape-voca').addEventListener('click', () => setBrushShape('voca'));

  document.getElementById('circle-size-input').addEventListener('input', (e) => {
    const n = parseFloat(e.target.value);
    if (!isNaN(n) && n >= 1 && n <= 60) circleSize = n;
  });

  document.getElementById('rect-w-input').addEventListener('input', (e) => {
    const n = parseFloat(e.target.value);
    if (!isNaN(n) && n >= 1 && n <= 85) rectW = n;
  });
  document.getElementById('rect-h-input').addEventListener('input', (e) => {
    const n = parseFloat(e.target.value);
    if (!isNaN(n) && n >= 1 && n <= 85) rectH = n;
  });
  document.getElementById('btn-rect-large').addEventListener('click', () => applyRectPreset(26, 12));
  document.getElementById('btn-rect-small').addEventListener('click', () => applyRectPreset(19.5, 9));

  document.getElementById('voca-w-input').addEventListener('input', (e) => {
    const n = parseFloat(e.target.value);
    if (!isNaN(n) && n >= 1 && n <= 85) vocaW = n;
  });
  document.getElementById('voca-h-input').addEventListener('input', (e) => {
    const n = parseFloat(e.target.value);
    if (!isNaN(n) && n >= 1 && n <= 85) vocaH = n;
  });
  document.getElementById('btn-voca-large').addEventListener('click', () => applyVocaPreset(20.5, 6));
  document.getElementById('btn-voca-small').addEventListener('click', () => applyVocaPreset(15.5, 4.5));

  ['left', 'right'].forEach(side => {
    const layer = document.getElementById(`songs-${side}`);
    layer.addEventListener('mousemove', (e) => moveGhost(e, side));
    layer.addEventListener('mouseleave', () => hideGhost(side));
    layer.addEventListener('click', (e) => openSpotModalNew(e, side));
  });

  document.getElementById('song-modal').addEventListener('click', closeSongModal);
  document.getElementById('song-modal-box').addEventListener('click', (e) => e.stopPropagation());
  document.getElementById('btn-close-song-modal').addEventListener('click', closeSongModal);
  document.getElementById('btn-delete-spot').addEventListener('click', deleteCurrentSpot);

  const searchInput = document.getElementById('song-search-input');
  searchInput.addEventListener('input', (e) => filterSongList(e.target.value));
  searchInput.addEventListener('keyup', (e) => filterSongList(e.target.value));
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') selectFirstFilteredSong();
  });

  document.getElementById('voca-link-modal').addEventListener('click', closeVocaLinkModal);
  document.getElementById('voca-modal-box').addEventListener('click', (e) => e.stopPropagation());
  document.getElementById('btn-close-voca-modal').addEventListener('click', closeVocaLinkModal);
  document.getElementById('voca-end-page-input').addEventListener('input', updateVocaRangePreview);
  document.getElementById('voca-end-page-input').addEventListener('change', updateVocaRangePreview);
  document.getElementById('btn-save-voca-spot').addEventListener('click', saveVocaLinkSpot);
  document.getElementById('btn-delete-voca-spot').addEventListener('click', deleteCurrentVocaSpot);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!document.getElementById('voca-link-modal').classList.contains('hidden')) closeVocaLinkModal();
      if (!document.getElementById('song-modal').classList.contains('hidden')) closeSongModal();
    }
  });
}

function setBrushShape(shape) {
  currentShape = shape;
  const btnCircle = document.getElementById('btn-shape-circle');
  const btnRect = document.getElementById('btn-shape-rect');
  const btnVoca = document.getElementById('btn-shape-voca');
  const circleBox = document.getElementById('circle-size-box');
  const rectBox = document.getElementById('rect-size-box');
  const vocaBox = document.getElementById('voca-size-box');

  btnCircle.className = 'px-2 py-0.5 rounded text-slate-600 hover:bg-pink-50';
  btnRect.className = 'px-2 py-0.5 rounded text-slate-600 hover:bg-pink-50';
  btnVoca.className = 'px-2 py-0.5 rounded text-sky-700 hover:bg-sky-50';
  circleBox.classList.add('hidden');
  rectBox.classList.add('hidden');
  vocaBox.classList.add('hidden');

  if (shape === 'circle') {
    btnCircle.className = 'px-2 py-0.5 rounded bg-pink-600 text-white';
    circleBox.classList.remove('hidden');
  } else if (shape === 'rect') {
    btnRect.className = 'px-2 py-0.5 rounded bg-pink-600 text-white';
    rectBox.classList.remove('hidden');
  } else if (shape === 'voca') {
    btnVoca.className = 'px-2 py-0.5 rounded bg-sky-600 text-white';
    vocaBox.classList.remove('hidden');
  }
}

function applyRectPreset(w, h) {
  rectW = w;
  rectH = h;
  document.getElementById('rect-w-input').value = w;
  document.getElementById('rect-h-input').value = h;
}

function applyVocaPreset(w, h) {
  vocaW = w;
  vocaH = h;
  document.getElementById('voca-w-input').value = w;
  document.getElementById('voca-h-input').value = h;
}

function moveGhost(e, side) {
  if (!isSpotEditMode) return;
  const ghost = document.getElementById(`ghost-${side}`);
  if (!ghost) return;
  const rect = e.currentTarget.getBoundingClientRect();

  let wPx, hPx;
  if (currentShape === 'circle') {
    wPx = Math.round(rect.width * (circleSize / 100));
    hPx = wPx;
    ghost.className = 'ghost-guide shape-circle';
  } else if (currentShape === 'voca') {
    wPx = Math.round(rect.width * (vocaW / 100));
    hPx = Math.round(rect.width * (vocaH / 100));
    ghost.className = 'ghost-guide shape-voca';
  } else {
    wPx = Math.round(rect.width * (rectW / 100));
    hPx = Math.round(rect.width * (rectH / 100));
    ghost.className = 'ghost-guide shape-rect';
  }

  ghost.style.display = 'block';
  ghost.style.width = `${wPx}px`;
  ghost.style.height = `${hPx}px`;
  ghost.style.left = `${e.clientX - rect.left}px`;
  ghost.style.top = `${e.clientY - rect.top}px`;
}

function hideGhost(side) {
  const ghost = document.getElementById(`ghost-${side}`);
  if (ghost) ghost.style.display = 'none';
}

export function toggleSpotEditMode() {
  isSpotEditMode = !isSpotEditMode;
  const spread = document.getElementById('book-spread');
  const btn = document.getElementById('btn-edit-spots');
  const controls = document.getElementById('edit-controls');

  spread.classList.toggle('edit-active', isSpotEditMode);
  controls.classList.toggle('hidden', !isSpotEditMode);
  btn.className = isSpotEditMode
    ? 'px-2.5 py-1 rounded-lg bg-pink-600 text-white border border-pink-600 text-xs font-bold transition'
    : 'px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 text-xs font-bold hover:bg-slate-200 transition';

  if (isSpotEditMode) {
    ensureOcrWorker();
  } else {
    hideGhost('left');
    hideGhost('right');
  }
  if (editorDeps) editorDeps.refreshLayers();
}

export function openSpotModalEdit(pageNum, idx) {
  const spot = getSpotsForPage(pageNum)[idx];
  if (isVocaLinkSpot(spot)) {
    openVocaLinkModal(pageNum, idx);
    return;
  }
  pendingSpotContext = { pageNum, x: spot.x, y: spot.y, editIndex: idx };
  document.getElementById('modal-title').textContent = `수정/삭제 (현재: ${spot.track})`;
  document.getElementById('modal-footer-delete').classList.remove('hidden');
  document.getElementById('ocr-preview-canvas').classList.add('hidden');
  document.getElementById('ocr-status-tag').classList.add('hidden');
  showModalWithFilter('');
}

async function openSpotModalNew(e, side) {
  if (!isSpotEditMode || !editorDeps) return;
  const pageNum = editorDeps.getPageForSide(side);
  if (!pageNum) return;

  const rect = e.currentTarget.getBoundingClientRect();
  const xPct = Number((((e.clientX - rect.left) / rect.width) * 100).toFixed(2));
  const yPct = Number((((e.clientY - rect.top) / rect.height) * 100).toFixed(2));

  if (currentShape === 'voca') {
    openVocaLinkModal(pageNum, null, xPct, yPct);
    return;
  }

  pendingSpotContext = { pageNum, x: xPct, y: yPct, editIndex: null };
  document.getElementById('modal-title').textContent = `${pageNum}페이지 - 새 음원 연결`;
  document.getElementById('modal-footer-delete').classList.add('hidden');
  document.getElementById('ocr-preview-canvas').classList.add('hidden');

  showModalWithFilter('');

  if (currentShape === 'rect') {
    const ocrTag = document.getElementById('ocr-status-tag');
    ocrTag.classList.remove('hidden');
    ocrTag.textContent = '카드 번호 읽는 중...';

    const detectedId = await detectCardNumberFromCorner(editorDeps.getPdfDoc(), pageNum, xPct, yPct, rectW, rectH);
    ocrTag.classList.add('hidden');

    if (detectedId && pendingSpotContext) {
      const input = document.getElementById('song-search-input');
      input.value = detectedId;
      filterSongList(detectedId);
      input.focus();
      input.select();
    }
  }
}

function showModalWithFilter(query) {
  const modal = document.getElementById('song-modal');
  const input = document.getElementById('song-search-input');
  modal.classList.remove('hidden');
  input.value = query;
  filterSongList(query);
  setTimeout(() => input.focus(), 50);
}

function closeSongModal() {
  document.getElementById('song-modal').classList.add('hidden');
  pendingSpotContext = null;
}

function getAllAudioItems() {
  const items = [];
  Object.entries(SONGS_DB).forEach(([num, fileName]) => {
    items.push({
      id: String(num),
      type: 'song',
      label: `#${num}`,
      title: fileName.replace(/\.mp3$/i, '')
    });
  });
  for (let i = 1; i <= 510; i++) {
    const padded = String(i).padStart(3, '0');
    items.push({
      id: `v${padded}`,
      type: 'voca',
      label: `v${padded}`,
      title: `VOCA 카드 ${padded}번 (${padded}.mp3)`
    });
  }
  return items;
}

function filterSongList(query) {
  const container = document.getElementById('song-search-results');
  if (!container) return;
  const rawQ = String(query || '').trim().toLowerCase();
  const compactQ = rawQ.replace(/\s+/g, '');
  container.innerHTML = '';

  const allItems = getAllAudioItems();
  let matchCount = 0;

  for (const item of allItems) {
    const lowerId = item.id.toLowerCase();
    const lowerTitle = item.title.toLowerCase();
    const compactTitle = lowerTitle.replace(/\s+/g, '');

    const isMatch = !rawQ
      || lowerId === rawQ
      || lowerId.includes(rawQ)
      || lowerTitle.includes(rawQ)
      || compactTitle.includes(compactQ);

    if (isMatch) {
      matchCount++;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'w-full text-left px-3 py-2 text-xs hover:bg-blue-50 flex items-center gap-2 transition';
      btn.dataset.track = item.id;

      const badge = item.type === 'voca'
        ? `<span class="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-mono font-black text-[10px] shrink-0">${item.label}</span>`
        : `<span class="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-mono font-black text-[10px] shrink-0">${item.label}</span>`;

      btn.innerHTML = `${badge}<span class="truncate text-slate-700 font-medium">${item.title}</span>`;
      btn.addEventListener('click', () => assignSongToSpot(item.id));
      container.appendChild(btn);

      if (matchCount >= 60) break;
    }
  }

  if (matchCount === 0) {
    container.innerHTML = `<div class="py-6 text-center text-xs text-slate-400">일치하는 음원이 없습니다.</div>`;
  }
}

function selectFirstFilteredSong() {
  const first = document.querySelector('#song-search-results button');
  if (first) assignSongToSpot(first.dataset.track);
}

function assignSongToSpot(trackId) {
  if (!pendingSpotContext) return;
  const pageNum = pendingSpotContext.pageNum;
  const list = getSpotsForPage(pageNum);
  const normalizedTrack = isVocaTrackId(trackId) ? String(trackId).toLowerCase() : Number(trackId);

  if (pendingSpotContext.editIndex !== null) {
    list[pendingSpotContext.editIndex].track = normalizedTrack;
  } else {
    const newSpot = {
      track: normalizedTrack,
      x: pendingSpotContext.x,
      y: pendingSpotContext.y,
      shape: currentShape,
      w: (currentShape === 'circle') ? circleSize : rectW
    };
    if (currentShape === 'rect') {
      newSpot.h = rectH;
    }
    list.push(newSpot);
  }
  preloadTrackList(list);
  closeSongModal();
  if (editorDeps) editorDeps.refreshLayers();
  saveSpotsToCloud();
}

function deleteCurrentSpot() {
  if (!pendingSpotContext || pendingSpotContext.editIndex === null) return;
  const list = getSpotsForPage(pendingSpotContext.pageNum);
  list.splice(pendingSpotContext.editIndex, 1);
  closeSongModal();
  if (editorDeps) editorDeps.refreshLayers();
  saveSpotsToCloud();
}

function openVocaLinkModal(pageNum, editIndex = null, xPct = 0, yPct = 0) {
  const modal = document.getElementById('voca-link-modal');
  const titleEl = document.getElementById('voca-modal-title');
  const startLabel = document.getElementById('voca-start-page-label');
  const endInput = document.getElementById('voca-end-page-input');
  const delFooter = document.getElementById('voca-modal-footer-delete');
  const totalPages = editorDeps ? editorDeps.getTotalPages() : 500;

  let anchorY = yPct;
  let defaultEnd = pageNum;

  if (editIndex !== null) {
    const existing = getSpotsForPage(pageNum)[editIndex];
    anchorY = existing.y;
    defaultEnd = existing.endPage || detectDefaultVocaEndPage(pageNum, anchorY, totalPages);
    pendingVocaContext = { pageNum, x: existing.x, y: existing.y, editIndex };
    titleEl.textContent = `VOCA 링크 수정 (${pageNum}P 시작)`;
    delFooter.classList.remove('hidden');
  } else {
    defaultEnd = detectDefaultVocaEndPage(pageNum, anchorY, totalPages);
    pendingVocaContext = { pageNum, x: xPct, y: yPct, editIndex: null };
    titleEl.textContent = `VOCA 단어앱 링크 연결 (${pageNum}P 시작)`;
    delFooter.classList.add('hidden');
  }

  startLabel.textContent = `${pageNum}P`;
  endInput.min = pageNum;
  endInput.max = totalPages || 500;
  endInput.value = defaultEnd;

  modal.classList.remove('hidden');
  updateVocaRangePreview();
}

function updateVocaRangePreview() {
  if (!pendingVocaContext) return;
  const startPage = pendingVocaContext.pageNum;
  const endInput = document.getElementById('voca-end-page-input');
  let endPage = parseInt(endInput.value, 10);
  if (isNaN(endPage) || endPage < startPage) endPage = startPage;

  const cards = collectVocaCardsInRange(startPage, endPage, pendingVocaContext.y);
  const countBadge = document.getElementById('voca-card-count-badge');
  const listEl = document.getElementById('voca-cards-preview-list');

  const pageSpan = endPage - startPage + 1;
  countBadge.textContent = `${pageSpan}페이지 · 총 ${cards.length}장`;

  if (cards.length === 0) {
    listEl.innerHTML = `<span class="text-slate-400 font-sans">선택된 범위에 배치된 VOCA 카드(v001~v510)가 없습니다.</span>`;
  } else {
    listEl.innerHTML = cards.map((cid, idx) =>
      `<span class="px-1.5 py-0.5 rounded bg-white border border-sky-200 text-sky-900 font-bold"><span class="text-slate-400 mr-0.5">${idx + 1}.</span>${cid}</span>`
    ).join('');
  }
}

function saveVocaLinkSpot() {
  if (!pendingVocaContext) return;
  const list = getSpotsForPage(pendingVocaContext.pageNum);
  const startPage = pendingVocaContext.pageNum;
  let endPage = parseInt(document.getElementById('voca-end-page-input').value, 10);
  if (isNaN(endPage) || endPage < startPage) endPage = startPage;

  if (pendingVocaContext.editIndex !== null) {
    list[pendingVocaContext.editIndex].endPage = endPage;
  } else {
    list.push({
      shape: 'voca',
      type: 'voca-link',
      x: pendingVocaContext.x,
      y: pendingVocaContext.y,
      w: vocaW,
      h: vocaH,
      endPage
    });
  }

  closeVocaLinkModal();
  if (editorDeps) editorDeps.refreshLayers();
  saveSpotsToCloud();
}

function deleteCurrentVocaSpot() {
  if (!pendingVocaContext || pendingVocaContext.editIndex === null) return;
  const list = getSpotsForPage(pendingVocaContext.pageNum);
  list.splice(pendingVocaContext.editIndex, 1);
  closeVocaLinkModal();
  if (editorDeps) editorDeps.refreshLayers();
  saveSpotsToCloud();
}

function closeVocaLinkModal() {
  document.getElementById('voca-link-modal').classList.add('hidden');
  pendingVocaContext = null;
}
