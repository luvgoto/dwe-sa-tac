import { getR2VocaUrl } from '../config/r2-config.js';
import { CARDS, CARD_MAP, STAGE_THEMES } from './cards-data.js';
import { isFavoriteCard, toggleFavoriteCard } from './favorites.js';
import { captureMagicImageData, resetMagicFilterUI, applyMagicFilter } from './magic-filter.js';
import { initQuizEvents, resetAndStartQuiz } from './quiz-mode.js';
import { initParentSelect, renderParentView } from './parent-select.js';
import { getActiveAppMode, getIsParentMode } from '../main.js';

let selectedSet = new Set(CARDS.map(c => c.id));
let currentPlaylist = [...CARDS];
let currentIndex = 0;
let isAutoPlaying = false;
let autoPlayTimer = null;
let audioPlayDebounceTimer = null;
let imageLoadDebounceTimer = null;
let idlePrefetchTimer = null;
let activeFetchController = null;
let audioPlayToken = 0;
let imageLoadToken = 0;
let loadedAudioCardId = null;

// 이미지 프리로드 및 캐시 확인용 Set
const preloadedNextImg = new Image();
const preloadedPrevImg = new Image();
const loadedImageIds = new Set();

// 경량 메모리 Blob 캐시 (최근 25곡 유지 - 단일 audioPlayer 전용)
const vocaBlobCache = new Map();
const MAX_VOCA_CACHE = 25;

async function fetchVocaPlayableUrl(cardId, signal, timeoutMs = 3000) {
  const rawUrl = getR2VocaUrl(cardId);
  if (vocaBlobCache.has(cardId)) {
    const cached = vocaBlobCache.get(cardId);
    vocaBlobCache.delete(cardId);
    vocaBlobCache.set(cardId, cached);
    return cached;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch(rawUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) return rawUrl;

    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);

    if (vocaBlobCache.size >= MAX_VOCA_CACHE) {
      const oldestKey = vocaBlobCache.keys().next().value;
      const oldestUrl = vocaBlobCache.get(oldestKey);
      vocaBlobCache.delete(oldestKey);
      URL.revokeObjectURL(oldestUrl);
    }
    vocaBlobCache.set(cardId, blobUrl);
    return blobUrl;
  } catch (err) {
    clearTimeout(timeoutId);
    if (signal && signal.aborted) throw err;
    return rawUrl;
  }
}

// 모바일 오디오 하드웨어 절전 방지 (앞 1초 잘림 방지)
let tacAudioCtx = null;
function wakeTacAudioHardware() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!tacAudioCtx) tacAudioCtx = new AudioCtx();
    if (tacAudioCtx.state === 'suspended') {
      tacAudioCtx.resume().catch(() => {});
    }
    const osc = tacAudioCtx.createOscillator();
    const gain = tacAudioCtx.createGain();
    gain.gain.value = 0.00001;
    osc.connect(gain);
    gain.connect(tacAudioCtx.destination);
    osc.start(0);
    osc.stop(tacAudioCtx.currentTime + 0.05);
  } catch {}
}

const imgElement = document.getElementById('card-image');
const filterCanvas = document.getElementById('filter-canvas');
const filterCtx = filterCanvas.getContext('2d', { willReadFrequently: true });
const magicControls = document.getElementById('magic-filter-controls');
const fallbackBox = document.getElementById('image-fallback');
const fallbackWord = document.getElementById('fallback-word');
const fallbackText = document.getElementById('fallback-text');
const indicator = document.getElementById('card-indicator');
const stageBadge = document.getElementById('card-stage-badge');
const wordTitle = document.getElementById('card-word-title');
const tagsBox = document.getElementById('card-tags-box');
const audioPlayer = document.getElementById('audio-player');

export function initTacPlayer() {
  bindCardEvents();
  initQuizEvents(() => switchTacView('card'));
  initParentSelect(selectedSet, {
    onPlaySelected: (orderedCards) => {
      currentPlaylist = orderedCards;
      currentIndex = 0;
      switchTacView('card');
      startAutoPlay();
    },
    onClose: () => switchTacView('card')
  });
  updateCardView(false);
}

function bindCardEvents() {
  document.getElementById('nav-btn-card').addEventListener('click', () => switchTacView('card'));
  document.getElementById('nav-btn-quiz').addEventListener('click', () => switchTacView('quiz'));
  document.getElementById('nav-btn-filter').addEventListener('click', () => {
    if (!getIsParentMode()) return;
    switchTacView('filter');
  });

  document.getElementById('btn-card-fav').addEventListener('click', () => {
    const card = currentPlaylist[currentIndex];
    if (!card) return;
    const nowFav = toggleFavoriteCard(card.id);
    updateCardFavoriteUI(nowFav);
  });

  document.getElementById('btn-autoplay').addEventListener('click', toggleAutoPlay);
  document.getElementById('card-touch-area').addEventListener('click', toggleAudioPlayback);
  document.getElementById('magic-filter-controls').addEventListener('click', (e) => e.stopPropagation());

  document.getElementById('btn-filter-orig').addEventListener('click', () => applyMagicFilter('original', imgElement, filterCanvas, filterCtx));
  document.getElementById('btn-filter-red').addEventListener('click', () => applyMagicFilter('red-only', imgElement, filterCanvas, filterCtx));
  document.getElementById('btn-filter-green').addEventListener('click', () => applyMagicFilter('green-only', imgElement, filterCanvas, filterCtx));

  document.getElementById('btn-prev-card').addEventListener('click', prevCard);
  document.getElementById('btn-speaker').addEventListener('click', toggleAudioPlayback);
  document.getElementById('btn-next-card').addEventListener('click', nextCard);
  document.getElementById('btn-jump-card').addEventListener('click', jumpToCard);
  document.getElementById('jump-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') jumpToCard();
  });

  imgElement.addEventListener('error', () => {
    imgElement.classList.add('hidden');
    filterCanvas.classList.add('hidden');
    fallbackBox.classList.remove('hidden');
    const c = currentPlaylist[currentIndex];
    if (c) {
      fallbackWord.textContent = c.word;
      fallbackText.textContent = `images/${c.id}.jpg 없음`;
    }
  });

  imgElement.addEventListener('load', () => {
    fallbackBox.classList.add('hidden');
    imgElement.classList.remove('hidden');
    const card = currentPlaylist[currentIndex];
    if (card) {
      loadedImageIds.add(card.id);
      if (card.isMagic) {
        captureMagicImageData(imgElement, filterCanvas, filterCtx);
      }
    }
  });

  audioPlayer.addEventListener('play', () => updatePlayPauseUI(true));
  audioPlayer.addEventListener('pause', () => updatePlayPauseUI(false));
  audioPlayer.addEventListener('ended', () => {
    updatePlayPauseUI(false);
    if (isAutoPlaying) {
      clearTimeout(autoPlayTimer);
      autoPlayTimer = setTimeout(() => {
        if (isAutoPlaying) nextCard();
      }, 1200);
    }
  });
  audioPlayer.addEventListener('error', () => {
    if (isAutoPlaying) {
      clearTimeout(autoPlayTimer);
      autoPlayTimer = setTimeout(() => {
        if (isAutoPlaying) nextCard();
      }, 2500);
    }
  });

  let touchStartX = 0;
  const tacSection = document.getElementById('section-tac');
  tacSection.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; }, { passive: true });
  tacSection.addEventListener('touchend', e => {
    const diff = e.changedTouches[0].screenX - touchStartX;
    if (Math.abs(diff) > 50) {
      if (diff < 0) nextCard();
      else prevCard();
    }
  }, { passive: true });

  window.addEventListener('keydown', (e) => {
    if (getActiveAppMode() !== 'tac') return;
    if (document.getElementById('view-card').classList.contains('hidden')) return;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    if (e.key === 'ArrowLeft') prevCard();
    if (e.key === 'ArrowRight') nextCard();
  });
}

export function loadCustomCardList(cardTokens, autoPlay = false, singleJumpMode = false) {
  if (singleJumpMode && cardTokens.length === 1) {
    const numId = parseInt(String(cardTokens[0]).replace(/\D/g, ''), 10);
    if (!isNaN(numId) && numId >= 1 && numId <= 510) {
      const fIdx = currentPlaylist.findIndex(c => c.id === numId);
      if (fIdx !== -1) {
        currentIndex = fIdx;
      } else {
        currentPlaylist = [...CARDS];
        currentIndex = currentPlaylist.findIndex(c => c.id === numId);
      }
      switchTacView('card');
      if (autoPlay) playCurrentAudio(true, false);
      return;
    }
  }

  const orderedCards = [];
  const idSet = new Set();

  cardTokens.forEach(token => {
    const numId = parseInt(String(token).replace(/\D/g, ''), 10);
    if (!isNaN(numId) && CARD_MAP.has(numId) && !idSet.has(numId)) {
      idSet.add(numId);
      orderedCards.push(CARD_MAP.get(numId));
    }
  });

  if (orderedCards.length > 0) {
    currentPlaylist = orderedCards;
    selectedSet.clear();
    idSet.forEach(id => selectedSet.add(id));
    currentIndex = 0;
  }

  switchTacView('card');
  if (autoPlay) {
    startAutoPlay();
  }
}

export function stopAllTacPlayback() {
  audioPlayToken++;
  imageLoadToken++;
  clearTimeout(audioPlayDebounceTimer);
  clearTimeout(imageLoadDebounceTimer);
  clearTimeout(idlePrefetchTimer);
  if (activeFetchController) activeFetchController.abort();
  if (audioPlayer) {
    audioPlayer.pause();
    audioPlayer.currentTime = 0;
  }
  stopAutoPlay();
  updatePlayPauseUI(false);
}

export function switchTacView(view) {
  stopAllTacPlayback();

  if (view === 'filter' && !getIsParentMode()) {
    view = 'card';
  }

  document.getElementById('view-card').classList.add('hidden');
  document.getElementById('view-quiz').classList.add('hidden');
  document.getElementById('view-filter').classList.add('hidden');

  const btnCard = document.getElementById('nav-btn-card');
  const btnQuiz = document.getElementById('nav-btn-quiz');
  const btnFilter = document.getElementById('nav-btn-filter');

  btnCard.className = 'px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 btn-jelly';
  btnQuiz.className = 'px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 btn-jelly';

  const parentHiddenClass = getIsParentMode() ? '' : 'hidden ';
  btnFilter.className = `${parentHiddenClass}parent-only-control px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-300 btn-jelly`;

  if (view === 'card') {
    document.getElementById('view-card').classList.remove('hidden');
    btnCard.className = 'px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 bg-blue-600 text-white shadow-xs btn-jelly';
    updateCardView(false);
  } else if (view === 'quiz') {
    document.getElementById('view-quiz').classList.remove('hidden');
    btnQuiz.className = 'px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 bg-blue-600 text-white shadow-xs btn-jelly';
    resetAndStartQuiz(selectedSet);
  } else if (view === 'filter') {
    document.getElementById('view-filter').classList.remove('hidden');
    btnFilter.className = `${parentHiddenClass}parent-only-control px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 bg-slate-900 text-white shadow-xs btn-jelly`;
    renderParentView();
  }
}

function scheduleNeighborPrefetch() {
  clearTimeout(idlePrefetchTimer);
  idlePrefetchTimer = setTimeout(() => {
    if (currentPlaylist.length <= 1) return;
    const nextCardItem = currentPlaylist[(currentIndex + 1) % currentPlaylist.length];
    const prevCardItem = currentPlaylist[(currentIndex - 1 + currentPlaylist.length) % currentPlaylist.length];

    if (nextCardItem) {
      preloadedNextImg.onload = () => loadedImageIds.add(nextCardItem.id);
      preloadedNextImg.src = `images/${nextCardItem.id}.jpg`;
      fetchVocaPlayableUrl(nextCardItem.id, null, 2500).catch(() => {});
    }
    if (prevCardItem && prevCardItem.id !== nextCardItem?.id) {
      preloadedPrevImg.onload = () => loadedImageIds.add(prevCardItem.id);
      preloadedPrevImg.src = `images/${prevCardItem.id}.jpg`;
      fetchVocaPlayableUrl(prevCardItem.id, null, 2500).catch(() => {});
    }
  }, 450);
}

function updateCardView(useDebounce = false) {
  if (currentPlaylist.length === 0) return;
  if (currentIndex >= currentPlaylist.length) currentIndex = 0;
  if (currentIndex < 0) currentIndex = currentPlaylist.length - 1;

  const card = currentPlaylist[currentIndex];
  const stageConfig = STAGE_THEMES[card.stage] || STAGE_THEMES['1단계'];

  indicator.textContent = `${currentIndex + 1} / ${currentPlaylist.length}`;
  stageBadge.className = `px-3 py-1 rounded-full font-black text-white text-[11px] sm:text-xs shadow-xs tracking-wider ${stageConfig.bg}`;
  stageBadge.textContent = stageConfig.name;

  updateCardFavoriteUI(isFavoriteCard(card.id));

  wordTitle.textContent = card.isStory ? `STORY #${card.id}` : card.word;

  tagsBox.innerHTML = '';
  card.cats.forEach(cat => {
    const s = document.createElement('span');
    if (cat === 'MAGIC') {
      s.className = 'text-[10px] sm:text-[11px] font-black px-2.5 py-0.5 rounded-full bg-amber-400 text-slate-900 border border-amber-300 shadow-xs flex items-center gap-1';
      s.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles text-[9px]"></i> MAGIC`;
    } else {
      s.className = 'text-[10px] sm:text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200';
      s.textContent = cat;
    }
    tagsBox.appendChild(s);
  });

  resetMagicFilterUI(imgElement, filterCanvas, magicControls, card.isMagic);
  fallbackBox.classList.add('hidden');

  // 연타 시 중간 이미지 다운로드를 건너뛰어 화면이 음원보다 늦게 따라오는 현상 방지
  const token = ++imageLoadToken;
  clearTimeout(imageLoadDebounceTimer);

  const isImgCached = loadedImageIds.has(card.id);
  const imgDelayMs = (useDebounce && !isImgCached) ? 90 : 0;

  if (!isImgCached && imgDelayMs > 0) {
    // 연타 중 이전 카드 잔상이 남지 않도록 즉시 비움
    imgElement.removeAttribute('src');
  }

  imageLoadDebounceTimer = setTimeout(() => {
    if (token !== imageLoadToken) return;
    imgElement.src = `images/${card.id}.jpg`;
    scheduleNeighborPrefetch();
  }, imgDelayMs);
}

function updateCardFavoriteUI(isFav) {
  const btn = document.getElementById('btn-card-fav');
  const icon = document.getElementById('card-fav-icon');
  if (!btn || !icon) return;

  if (isFav) {
    btn.className = 'w-7 h-7 rounded-full bg-amber-100 hover:bg-amber-200 border border-amber-300 text-amber-500 flex items-center justify-center transition btn-jelly';
    icon.className = 'fa-solid fa-star text-xs';
  } else {
    btn.className = 'w-7 h-7 rounded-full bg-slate-100 hover:bg-amber-50 border border-slate-200 text-slate-400 flex items-center justify-center transition btn-jelly';
    icon.className = 'fa-regular fa-star text-xs';
  }
}

function updatePlayPauseUI(isPlaying) {
  const speakerIcon = document.getElementById('speaker-icon');
  const speakerBtn = document.getElementById('btn-speaker');

  if (isPlaying) {
    if (speakerIcon) speakerIcon.className = 'fa-solid fa-pause text-slate-900';
    if (speakerBtn) speakerBtn.className = 'w-14 h-14 min-w-[56px] min-h-[56px] sm:w-20 sm:h-16 sm:min-w-[80px] sm:min-h-[64px] bg-amber-400 hover:bg-amber-300 text-slate-900 font-black rounded-2xl shadow-md ring-4 ring-amber-300/40 flex items-center justify-center text-xl sm:text-2xl btn-jelly transform active:scale-95 transition shrink-0';
  } else {
    if (speakerIcon) speakerIcon.className = 'fa-solid fa-volume-high text-slate-900';
    if (speakerBtn) speakerBtn.className = 'w-14 h-14 min-w-[56px] min-h-[56px] sm:w-20 sm:h-16 sm:min-w-[80px] sm:min-h-[64px] bg-amber-400 hover:bg-amber-300 text-slate-900 font-black rounded-2xl shadow-md flex items-center justify-center text-xl sm:text-2xl btn-jelly transform active:scale-95 transition shrink-0';
  }
}

function toggleAudioPlayback() {
  wakeTacAudioHardware();

  const ripple = document.getElementById('touch-ripple');
  if (ripple) {
    ripple.classList.remove('opacity-0');
    ripple.classList.add('opacity-100');
    setTimeout(() => ripple.classList.remove('opacity-100'), 250);
  }

  const card = currentPlaylist[currentIndex];
  if (!card) return;

  if (loadedAudioCardId === card.id && !audioPlayer.paused && !audioPlayer.ended && audioPlayer.currentTime > 0) {
    audioPlayer.pause();
    updatePlayPauseUI(false);
  } else {
    playCurrentAudio(loadedAudioCardId !== card.id || audioPlayer.ended, false);
  }
}

function playCurrentAudio(reset = true, useDebounce = true) {
  wakeTacAudioHardware();

  const card = currentPlaylist[currentIndex];
  if (!card) return;

  const token = ++audioPlayToken;
  audioPlayer.pause();
  clearTimeout(audioPlayDebounceTimer);
  if (activeFetchController) activeFetchController.abort();

  const isCached = vocaBlobCache.has(card.id);
  const delayMs = (useDebounce && !isCached) ? 90 : 0;

  audioPlayDebounceTimer = setTimeout(async () => {
    if (token !== audioPlayToken) return;
    activeFetchController = new AbortController();

    try {
      const playableUrl = await fetchVocaPlayableUrl(card.id, activeFetchController.signal, 3000);
      if (token !== audioPlayToken) return;

      if (loadedAudioCardId !== card.id || audioPlayer.src !== playableUrl) {
        audioPlayer.src = playableUrl;
        loadedAudioCardId = card.id;
      }
      if (reset) audioPlayer.currentTime = 0;
      await audioPlayer.play();
      if (token === audioPlayToken) updatePlayPauseUI(true);
    } catch (e) {
      if (activeFetchController.signal.aborted) return;
      console.warn(e);
    }
  }, delayMs);
}

function nextCard() {
  if (currentPlaylist.length === 0) return;
  currentIndex = (currentIndex + 1) % currentPlaylist.length;
  updateCardView(true);
  playCurrentAudio(true, true);
}

function prevCard() {
  if (currentPlaylist.length === 0) return;
  currentIndex = (currentIndex - 1 + currentPlaylist.length) % currentPlaylist.length;
  updateCardView(true);
  playCurrentAudio(true, true);
}

function jumpToCard() {
  const val = parseInt(document.getElementById('jump-input').value, 10);
  if (!isNaN(val) && val >= 1 && val <= 510) {
    loadCustomCardList([val], true, true);
    document.getElementById('jump-input').value = '';
  }
}

function toggleAutoPlay() {
  if (isAutoPlaying) stopAutoPlay();
  else startAutoPlay();
}

function startAutoPlay() {
  if (currentPlaylist.length === 0) return;
  isAutoPlaying = true;
  document.getElementById('autoplay-icon').className = 'fa-solid fa-pause text-xs';
  document.getElementById('autoplay-text').textContent = 'PAUSE';
  document.getElementById('btn-autoplay').className = 'px-3.5 py-1 font-black rounded-full bg-pink-600 border border-pink-600 text-white animate-pulse transition flex items-center gap-1.5 shadow-xs btn-jelly text-xs';
  playCurrentAudio(true, false);
}

function stopAutoPlay() {
  isAutoPlaying = false;
  clearTimeout(autoPlayTimer);
  document.getElementById('autoplay-icon').className = 'fa-solid fa-play text-xs';
  document.getElementById('autoplay-text').textContent = 'PLAY ALL';
  document.getElementById('btn-autoplay').className = 'px-3.5 py-1 font-black rounded-full bg-white border border-pink-500 text-pink-600 hover:bg-pink-50 transition flex items-center gap-1.5 shadow-xs btn-jelly text-xs';
}