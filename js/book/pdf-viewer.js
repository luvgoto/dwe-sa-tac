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
let isSpreadMode = window.innerWidth >= window.innerHeight;
let userManualSpreadOverride = false;
let hasCoverPage = true;
let isRendering = false;
let isFullscreenMode = false;
let tocAudioMode = false;

let currentLeftPageNum = null;
let currentRightPageNum = null;
let onOpenTacCardsCallback = null;

function isMobileDevice() {
  return window.innerWidth <= 920 || ('ontouchstart' in window && Math.min(window.innerWidth, window.innerHeight) <= 600);
}

function showRotateToast() {
  const toast = document.getElementById('rotate-toast');
  if (!toast) return;
  toast.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add('hidden'), 2600);
}

function updateSpreadButtonLabel() {
  const labelEl = document.getElementById('label-spread');
  if (labelEl) labelEl.textContent = isSpreadMode ? '2쪽' : '1쪽';
}

function syncSpreadModeByViewport() {
  if (userManualSpreadOverride) return;
  const shouldSpread = window.innerWidth >= window.innerHeight;
  if (isSpreadMode !== shouldSpread) {
    isSpreadMode = shouldSpread;
    updateSpreadButtonLabel();
  }
}

export function getCurrentPage() {
  return currentPage;
}

export function pauseBookAudio() {
  stopAllBookAudio();
  const tocBtn = document.getElementById('btn-toc-mode-toggle');
  if (tocBtn) tocBtn.classList.add('hidden');
  // TAC 모드 진입 시 숨겨진 송북 캔버스 메모리를 해제해 구형 태블릿 RAM 확보
  ['canvas-left', 'canvas-right'].forEach(id => {
    const c = document.getElementById(id);
    if (c && c.width > 0) {
      c.width = 0;
      c.height = 0;
    }
  });
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

  syncSpreadModeByViewport();
  updateSpreadButtonLabel();

  setAudioStateCallback(refreshAllSongLayers);

  initSpotEditor({
    getPdfDoc: () => pdfDoc,
    getTotalPages: () => totalPages,
    getPageForSide: (side) => (side === 'left' ? currentLeftPageNum : currentRightPageNum),
    refreshLayers: refreshAllSongLayers
  });

  bindViewerEvents();

  const FALLBACK_PDF_URL = 'https://raw.githubusercontent.com/luvgoto/dwe-sa-tac/main/songbook.pdf';
  const loadingTextEl = document.querySelector('#loading-box p');

  async function loadPdfWithProgress(url, timeoutMs = 6000) {
    const loadingTask = window.pdfjsLib.getDocument({
      url,
      disableRange: true,
      disableStream: true
    });

    let started = false;
    const timer = setTimeout(() => {
      if (!started) {
        loadingTask.destroy().catch(() => {});
      }
    }, timeoutMs);

    loadingTask.onProgress = ({ loaded, total }) => {
      started = true;
      clearTimeout(timer);
      if (loadingTextEl && total > 0) {
        const pct = Math.min(100, Math.round((loaded / total) * 100));
        loadingTextEl.textContent = `송북 문서를 불러오고 있습니다... (${pct}%)`;
      }
    };

    try {
      const doc = await loadingTask.promise;
      clearTimeout(timer);
      return doc;
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  }

  try {
    const spotsPromise = loadSpotsFromCloud();
    let loadedPdf;
    try {
      loadedPdf = await loadPdfWithProgress(PDF_URL, 6000);
    } catch (r2Err) {
      console.warn('R2 PDF 로드 지연/실패, 백업 주소로 전환:', r2Err);
      if (loadingTextEl) loadingTextEl.textContent = '백업 서버에서 송북을 불러오고 있습니다...';
      loadedPdf = await loadPdfWithProgress(FALLBACK_PDF_URL, 15000);
    }

    await spotsPromise;
    pdfDoc = loadedPdf;
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

  // 스와이프 + 책 좌우 끝(18%) 탭/클릭으로 페이지 넘김
  let touchStartX = 0;
  let touchStartY = 0;
  let lastTouchTime = 0;
  const viewerEl = document.getElementById('viewer-container');
  const spreadEl = document.getElementById('book-spread');

  function handleEdgeNavigation(clientX) {
    const targetBox = (spreadEl && !spreadEl.classList.contains('hidden')) ? spreadEl : viewerEl;
    const rect = targetBox.getBoundingClientRect();
    if (rect.width <= 0) return;

    const ratioX = (clientX - rect.left) / rect.width;
    if (ratioX <= 0.18) {
      prevPage();
    } else if (ratioX >= 0.82) {
      nextPage();
    }
  }

  viewerEl.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].clientX;
    touchStartY = e.changedTouches[0].clientY;
  }, { passive: true });

  viewerEl.addEventListener('touchend', e => {
    lastTouchTime = Date.now();
    if (isEditModeActive()) return;
    if (e.target.closest('.song-spot, .link-layer a')) return;

    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const diffX = endX - touchStartX;
    const diffY = endY - touchStartY;

    // 1. 가로 스와이프
    if (Math.abs(diffX) > 55 && Math.abs(diffX) > Math.abs(diffY)) {
      if (diffX < 0) nextPage();
      else prevPage();
      return;
    }

    // 2. 제자리 짧은 탭 -> 책 좌측 18% 또는 우측 18% 영역 터치 시 페이지 이동
    if (Math.abs(diffX) < 12 && Math.abs(diffY) < 12) {
      handleEdgeNavigation(endX);
    }
  }, { passive: true });

  // 데스크톱 마우스 클릭: 책(또는 뷰어) 좌/우 끝 18% 영역 클릭으로 페이지 넘김
  viewerEl.addEventListener('click', e => {
    if (Date.now() - lastTouchTime < 500) return;
    if (isEditModeActive()) return;
    if (e.target.closest('.song-spot, .link-layer a')) return;

    handleEdgeNavigation(e.clientX);
  });

  let resizeTimer;
  const handleViewportChange = () => {
    syncSpreadModeByViewport();
    if (getActiveAppMode() !== 'book') return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderCurrentView, 150);
  };

  window.addEventListener('resize', handleViewportChange);
  window.addEventListener('orientationchange', () => setTimeout(handleViewportChange, 150));
}

export async function renderCurrentView() {
  if (!pdfDoc || isRendering) return;
  isRendering = true;
  try {
    const container = document.getElementById('viewer-container');
    const compact = isMobileDevice();
    const horizontalMargin = isFullscreenMode ? 0 : (compact ? 4 : 32);
    const verticalMargin = isFullscreenMode ? 0 : (compact ? 4 : 20);

    const availW = Math.max(100, container.clientWidth - horizontalMargin);
    const availH = Math.max(100, container.clientHeight - verticalMargin);
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

  if (!isTocPage || getActiveAppMode() !== 'book') {
    toggleBtn.classList.add('hidden');
    spread.classList.remove('toc-audio-off', 'toc-audio-on');
    return;
  }

  toggleBtn.classList.remove('hidden');
  if (tocAudioMode) {
    spread.classList.remove('toc-audio-off');
    spread.classList.add('toc-audio-on');
    toggleBtn.className = 'w-8 h-8 rounded-full bg-[#2B4C7E]/90 hover:bg-[#2B4C7E] text-sky-200 border border-sky-200/50 ring-2 ring-sky-300/30 text-xs shadow-md backdrop-blur-md flex items-center justify-center transition';
    toggleBtn.innerHTML = `<i class="fa-solid fa-volume-high"></i>`;
  } else {
    spread.classList.remove('toc-audio-on');
    spread.classList.add('toc-audio-off');
    toggleBtn.className = 'w-8 h-8 rounded-full bg-[#172554]/75 hover:bg-[#172554]/90 text-white border border-white/20 text-xs shadow-md backdrop-blur-md flex items-center justify-center transition';
    toggleBtn.innerHTML = `<i class="fa-solid fa-volume-xmark"></i>`;
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

async function toggleSpreadMode() {
  userManualSpreadOverride = true;
  isSpreadMode = !isSpreadMode;
  updateSpreadButtonLabel();

  if (isMobileDevice()) {
    try {
      if (isSpreadMode) {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen().catch(() => {});
        }
        if (screen.orientation && screen.orientation.lock) {
          await screen.orientation.lock('landscape');
        } else {
          showRotateToast();
        }
      } else {
        if (screen.orientation && screen.orientation.lock) {
          await screen.orientation.lock('portrait').catch(() => {});
        }
      }
    } catch {
      if (isSpreadMode && window.innerWidth < window.innerHeight) {
        showRotateToast();
      }
    }
  }

  renderCurrentView();
}

function toggleCoverMode() {
  hasCoverPage = !hasCoverPage;
  const labelEl = document.getElementById('label-cover');
  if (labelEl) labelEl.textContent = hasCoverPage ? '표지포함' : '표지미포함';
  renderCurrentView();
}

function updateBottomNavUI() {
  document.getElementById('current-page-num').textContent = currentPage;
  document.getElementById('page-slider').value = currentPage;
  document.getElementById('direct-page-input').value = currentPage;
}