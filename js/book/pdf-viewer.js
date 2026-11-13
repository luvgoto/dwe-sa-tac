import { PDF_URL, isVocaTrackId } from '../config/r2-config.js';
import {
  loadSpotsFromCloud,
  getSpotsForPage,
  isVocaLinkSpot,
  detectDefaultVocaEndPage,
  collectVocaCardsInRange
} from './spots-sync.js';
import {
  preloadTrackList,
  playOrPauseR2Song,
  stopAllBookAudio,
  getActiveAudioKeys,
  setAudioStateCallback
} from './audio-ducking.js';
import { initSpotEditor, isEditModeActive, openSpotModalEdit } from './spot-editor.js';
import { getActiveAppMode } from '../main.js';

const TOC_PAGES = new Set([4, 5, 6, 74, 75, 76, 142, 143, 216, 217]);

let pdfDoc = null;
let currentPage = 1;
let totalPages = 1;
let isSpreadMode = true;
let hasCoverPage = true;
let isRendering = false;
let isFullscreenMode = false;
let tocAudioMode = false;

let currentLeftPageNum = null;
let currentRightPageNum = null;
let onOpenTacCardsCallback = null;

export function getCurrentPage() {
  return currentPage;
}

export function pauseBookAudio() {
  stopAllBookAudio();
}

export function toggleFullscreen(isFs) {
  isFullscreenMode = isFs;
  setTimeout(renderCurrentView, 120);
}

export async function initBookViewer(options = {}) {
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
  onOpenTacCardsCallback = options.onOpenTacCards || null;
  if (options.initialPage) currentPage = options.initialPage;

  setAudioStateCallback(refreshAllSongLayers);

  initSpotEditor({
    getPdfDoc: () => pdfDoc,
    getTotalPages: () => totalPages,
    getPageForSide: (side) => (side === 'left' ? currentLeftPageNum : currentRightPageNum),
    refreshLayers: refreshAllSongLayers
  });

  bindViewerEvents();

  try {
    await loadSpotsFromCloud();
    pdfDoc = await window.pdfjsLib.getDocument(PDF_URL).promise;
    totalPages = pdfDoc.numPages;

    document.getElementById('total-page-num').textContent = totalPages;
    document.getElementById('page-slider').max = totalPages;
    document.getElementById('direct-page-input').max = totalPages;
    document.getElementById('voca-end-page-input').max = totalPages;

    if (currentPage > totalPages) currentPage = 1;

    await renderCurrentView();
    document.getElementById('loading-box').classList.add('hidden');
    document.getElementById('book-spread').classList.remove('hidden');
  } catch (err) {
    document.getElementById('loading-box').innerHTML = `<p class="text-sm font-bold text-rose-600">PDF 로드 실패: ${err.message}</p>`;
  }
}

function bindViewerEvents() {
  document.getElementById('btn-toc-mode-toggle').addEventListener('click', toggleTocInteractionMode);
  document.getElementById('btn-toggle-spread').addEventListener('click', toggleSpreadMode);
  document.getElementById('btn-toggle-cover').addEventListener('click', toggleCoverMode);
  document.getElementById('btn-prev-page').addEventListener('click', prevPage);
  document.getElementById('btn-next-page').addEventListener('click', nextPage);

  let sliderDebounce;
  document.getElementById('page-slider').addEventListener('input', (e) => {
    const val = e.target.value;
    document.getElementById('current-page-num').textContent = val;
    document.getElementById('direct-page-input').value = val;
    clearTimeout(sliderDebounce);
    sliderDebounce = setTimeout(() => goToPage(val), 70);
  });

  document.getElementById('direct-page-input').addEventListener('change', (e) => goToPage(e.target.value));

  let hideBottomTimer;
  document.getElementById('bottom-nav-trigger').addEventListener('click', () => {
    const bar = document.getElementById('bottom-nav-bar');
    bar.classList.add('active');
    clearTimeout(hideBottomTimer);
    hideBottomTimer = setTimeout(() => bar.classList.remove('active'), 3500);
  });
  document.getElementById('bottom-nav-inner').addEventListener('click', (e) => e.stopPropagation());

  window.addEventListener('keydown', (e) => {
    if (getActiveAppMode() !== 'book') return;
    if (!document.getElementById('voca-link-modal').classList.contains('hidden')) return;
    if (!document.getElementById('song-modal').classList.contains('hidden')) return;
    if (e.key === 'ArrowLeft') prevPage();
    if (e.key === 'ArrowRight') nextPage();
  });

  let touchStartX = 0;
  const viewerEl = document.getElementById('viewer-container');
  viewerEl.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; }, { passive: true });
  viewerEl.addEventListener('touchend', e => {
    const diff = e.changedTouches[0].screenX - touchStartX;
    if (Math.abs(diff) > 60) {
      if (diff < 0) nextPage();
      else prevPage();
    }
  }, { passive: true });

  let resizeTimer;
  window.addEventListener('resize', () => {
    if (getActiveAppMode() !== 'book') return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderCurrentView, 150);
  });
}

export async function renderCurrentView() {
  if (!pdfDoc || isRendering) return;
  isRendering = true;
  try {
    const container = document.getElementById('viewer-container');
    const availW = Math.max(100, container.clientWidth - (isFullscreenMode ? 88 : 112));
    const availH = Math.max(100, container.clientHeight - (isFullscreenMode ? 16 : 24));
    const leftBox = document.getElementById('left-page-box');
    const rightBox = document.getElementById('right-page-box');

    let leftPageNum = null;
    let rightPageNum = null;

    if (!isSpreadMode) {
      leftPageNum = currentPage;
    } else if (hasCoverPage) {
      if (currentPage === 1) {
        rightPageNum = 1;
      } else {
        leftPageNum = (currentPage % 2 === 0) ? currentPage : currentPage - 1;
        rightPageNum = (leftPageNum + 1 <= totalPages) ? leftPageNum + 1 : null;
      }
    } else {
      leftPageNum = (currentPage % 2 !== 0) ? currentPage : currentPage - 1;
      rightPageNum = (leftPageNum + 1 <= totalPages) ? leftPageNum + 1 : null;
    }

    currentLeftPageNum = leftPageNum;
    currentRightPageNum = rightPageNum;
    tocAudioMode = false;

    const samplePage = await pdfDoc.getPage(leftPageNum || rightPageNum || 1);
    const baseVp = samplePage.getViewport({ scale: 1.0 });
    const scale = Math.min((isSpreadMode ? availW / 2 : availW) / baseVp.width, availH / baseVp.height);
    const renderedW = Math.floor(baseVp.width * scale);
    const renderedH = Math.floor(baseVp.height * scale);

    if (leftPageNum) {
      leftBox.style.display = 'block';
      leftBox.style.visibility = 'visible';
      leftBox.className = isSpreadMode
        ? 'page-wrapper rounded-l-md overflow-hidden book-spine-left'
        : 'page-wrapper rounded-md overflow-hidden shadow-lg';
      await renderSinglePage(leftPageNum, 'canvas-left', 'links-left', 'songs-left', scale);
      preloadTrackList(getSpotsForPage(leftPageNum));
    } else if (isSpreadMode && rightPageNum === 1) {
      leftBox.style.display = 'block';
      leftBox.style.visibility = 'hidden';
      leftBox.style.width = `${renderedW}px`;
      leftBox.style.height = `${renderedH}px`;
    } else {
      leftBox.style.display = 'none';
    }

    if (rightPageNum) {
      rightBox.style.display = 'block';
      rightBox.className = (isSpreadMode && !leftPageNum)
        ? 'page-wrapper rounded-md overflow-hidden'
        : 'page-wrapper rounded-r-md overflow-hidden book-spine-right border-l border-slate-200';
      await renderSinglePage(rightPageNum, 'canvas-right', 'links-right', 'songs-right', scale);
      preloadTrackList(getSpotsForPage(rightPageNum));
    } else {
      rightBox.style.display = 'none';
    }

    const isTocView = (leftPageNum && TOC_PAGES.has(leftPageNum)) || (rightPageNum && TOC_PAGES.has(rightPageNum));
    updateTocModeUI(isTocView);
    updateBottomNavUI();
  } finally {
    isRendering = false;
  }
}

async function renderSinglePage(pageNum, canvasId, linkLayerId, songLayerId, scale) {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext('2d');
  const floorW = Math.floor(viewport.width);
  const floorH = Math.floor(viewport.height);

  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${floorW}px`;
  canvas.style.height = `${floorH}px`;
  canvas.parentElement.style.width = `${floorW}px`;
  canvas.parentElement.style.height = `${floorH}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  await page.render({ canvasContext: ctx, viewport }).promise;

  const linkLayer = document.getElementById(linkLayerId);
  linkLayer.innerHTML = '';
  linkLayer.style.width = `${floorW}px`;
  linkLayer.style.height = `${floorH}px`;

  const annotations = await page.getAnnotations();
  annotations.forEach(item => {
    if (item.subtype !== 'Link') return;
    const rect = window.pdfjsLib.Util.normalizeRect(item.rect);
    const viewRect = viewport.convertToViewportRectangle(rect);
    const a = document.createElement('a');
    a.style.left = `${Math.min(viewRect[0], viewRect[2])}px`;
    a.style.top = `${Math.min(viewRect[1], viewRect[3])}px`;
    a.style.width = `${Math.abs(viewRect[2] - viewRect[0])}px`;
    a.style.height = `${Math.abs(viewRect[3] - viewRect[1])}px`;

    if (item.url) {
      if (/^https?:\/\//i.test(item.url)) {
        a.href = item.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        linkLayer.appendChild(a);
      }
    } else if (item.dest) {
      a.href = 'javascript:void(0)';
      a.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await navigateToDestination(item.dest);
      });
      linkLayer.appendChild(a);
    }
  });

  renderSongCircles(pageNum, songLayerId, floorW, floorH);
}

function renderSongCircles(pageNum, layerId, pageW, pageH) {
  const layer = document.getElementById(layerId);
  layer.innerHTML = '';
  layer.style.width = `${pageW}px`;
  layer.style.height = `${pageH}px`;

  const list = getSpotsForPage(pageNum);
  const { activeSongSpotKey, activeVocaSpotKey } = getActiveAudioKeys();
  const editActive = isEditModeActive();

  list.forEach((spot, idx) => {
    const isVocaBadge = isVocaLinkSpot(spot);
    const shapeType = isVocaBadge ? 'voca' : (spot.shape || 'circle');
    const spotKey = `${pageNum}-${idx}`;
    const btn = document.createElement('div');
    btn.className = `song-spot shape-${shapeType}`;

    if (!isVocaBadge) {
      if (activeSongSpotKey === spotKey) btn.classList.add('playing');
      if (activeVocaSpotKey === spotKey) btn.classList.add('playing-voca');
    } else {
      btn.title = 'VOCA 단어카드로 이동하여 학습하기';
    }

    let wPx, hPx;
    if (shapeType === 'circle') {
      const widthPct = spot.w ? spot.w : (spot.r ? spot.r * 2 : 12.0);
      wPx = Math.round(pageW * (widthPct / 100));
      hPx = wPx;
    } else if (shapeType === 'voca') {
      const widthPct = spot.w || 20.5;
      const heightPct = spot.h || 6.0;
      wPx = Math.round(pageW * (widthPct / 100));
      hPx = Math.round(pageW * (heightPct / 100));
    } else {
      const widthPct = spot.w || 26.0;
      const heightPct = spot.h ? spot.h : (widthPct * 0.46);
      wPx = Math.round(pageW * (widthPct / 100));
      hPx = Math.round(pageW * (heightPct / 100));
    }

    btn.style.left = `${spot.x}%`;
    btn.style.top = `${spot.y}%`;
    btn.style.width = `${wPx}px`;
    btn.style.height = `${hPx}px`;

    if (editActive) {
      if (isVocaBadge) {
        const endP = spot.endPage || detectDefaultVocaEndPage(pageNum, spot.y, totalPages);
        const cnt = collectVocaCardsInRange(pageNum, endP, spot.y).length;
        btn.innerHTML = `<span class="text-[10px] font-mono font-black text-sky-900 bg-white/95 px-1.5 rounded-full shadow-xs">VOCA ${pageNum}~${endP}P (${cnt}장)</span>`;
      } else {
        const isVoca = isVocaTrackId(spot.track);
        const badgeColor = isVoca ? 'text-emerald-800' : 'text-blue-900';
        btn.innerHTML = `<span class="text-[10px] font-mono font-black ${badgeColor} bg-white/95 px-1.5 rounded-full shadow-xs">${spot.track}</span>`;
      }
    }

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (editActive) {
        openSpotModalEdit(pageNum, idx);
      } else if (isVocaBadge) {
        launchTacWithVocaSpot(pageNum, spot);
      } else {
        playOrPauseR2Song(spot.track, spotKey);
      }
    });

    layer.appendChild(btn);
  });
}

function launchTacWithVocaSpot(pageNum, spot) {
  const endPage = spot.endPage || detectDefaultVocaEndPage(pageNum, spot.y, totalPages);
  const cards = collectVocaCardsInRange(pageNum, endPage, spot.y);

  if (cards.length === 0) {
    alert(`${pageNum}P ~ ${endPage}P 구간에 연결된 VOCA 카드(v001~v510)가 아직 없습니다.\n음원편집 모드에서 VOCA 카드를 먼저 배치해 주세요.`);
    return;
  }

  if (onOpenTacCardsCallback) {
    onOpenTacCardsCallback(cards);
  }
}

export function refreshAllSongLayers() {
  const leftC = document.getElementById('canvas-left');
  const rightC = document.getElementById('canvas-right');
  if (currentLeftPageNum && leftC.style.width) {
    renderSongCircles(currentLeftPageNum, 'songs-left', parseInt(leftC.style.width, 10), parseInt(leftC.style.height, 10));
  }
  if (currentRightPageNum && rightC.style.width) {
    renderSongCircles(currentRightPageNum, 'songs-right', parseInt(rightC.style.width, 10), parseInt(rightC.style.height, 10));
  }
}

function updateTocModeUI(isTocPage) {
  const toggleBtn = document.getElementById('btn-toc-mode-toggle');
  const spread = document.getElementById('book-spread');

  if (!isTocPage) {
    toggleBtn.classList.add('hidden');
    spread.classList.remove('toc-audio-off', 'toc-audio-on');
    return;
  }

  toggleBtn.classList.remove('hidden');
  if (tocAudioMode) {
    spread.classList.remove('toc-audio-off');
    spread.classList.add('toc-audio-on');
    toggleBtn.className = 'px-2.5 py-1 rounded-lg bg-blue-600 text-white border border-blue-700 text-xs font-bold shadow-xs transition';
    toggleBtn.innerHTML = `<i class="fa-solid fa-volume-high mr-1"></i><span>음원 ON</span>`;
  } else {
    spread.classList.remove('toc-audio-on');
    spread.classList.add('toc-audio-off');
    toggleBtn.className = 'px-2.5 py-1 rounded-lg bg-slate-200 text-slate-700 border border-slate-300 text-xs font-bold shadow-xs transition';
    toggleBtn.innerHTML = `<i class="fa-solid fa-volume-xmark mr-1"></i><span>음원 OFF</span>`;
  }
}

function toggleTocInteractionMode() {
  tocAudioMode = !tocAudioMode;
  updateTocModeUI(true);
}

async function navigateToDestination(dest) {
  try {
    const destArray = (typeof dest === 'string') ? await pdfDoc.getDestination(dest) : dest;
    if (Array.isArray(destArray) && destArray[0]) {
      const idx = (typeof destArray[0] === 'object') ? await pdfDoc.getPageIndex(destArray[0]) : destArray[0];
      currentPage = idx + 1;
      await renderCurrentView();
    }
  } catch (e) {}
}

export function prevPage() {
  if (currentPage <= 1) return;
  if (!isSpreadMode) currentPage--;
  else currentPage = hasCoverPage ? ((currentPage <= 3) ? 1 : currentPage - 2) : ((currentPage <= 2) ? 1 : currentPage - 2);
  renderCurrentView();
}

export function nextPage() {
  if (currentPage >= totalPages) return;
  if (!isSpreadMode) currentPage++;
  else currentPage = (hasCoverPage && currentPage === 1) ? 2 : Math.min(totalPages, currentPage + 2);
  renderCurrentView();
}

export function goToPage(val) {
  const num = parseInt(val, 10);
  if (!isNaN(num) && num >= 1 && num <= totalPages) {
    currentPage = num;
    renderCurrentView();
  }
}

function toggleSpreadMode() {
  isSpreadMode = !isSpreadMode;
  document.getElementById('label-spread').textContent = isSpreadMode ? '2쪽보기' : '1쪽보기';
  renderCurrentView();
}

function toggleCoverMode() {
  hasCoverPage = !hasCoverPage;
  document.getElementById('label-cover').textContent = hasCoverPage ? '표지포함' : '표지미포함';
  renderCurrentView();
}

function updateBottomNavUI() {
  document.getElementById('current-page-num').textContent = currentPage;
  document.getElementById('page-slider').value = currentPage;
  document.getElementById('direct-page-input').value = currentPage;
}
