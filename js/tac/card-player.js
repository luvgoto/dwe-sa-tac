import { getR2VocaUrl } from '../config/r2-config.js';
import { getPlayableVocaUrl, prefetchVocaUrlsSequentially, abortPrefetch } from '../config/audio-cache.js';
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
let idlePrefetchTimer = null;
let activeFetchController = null;
let audioPlayToken = 0;
let imageLoadToken = 0;
let activeCardLoaderImg = null;
let loadedAudioCardId = null;

const imgPreloadPool = [new Image(), new Image(), new Image(), new Image()];
const loadedImageIds = new Set();

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
  updateCardView();
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
  clearTimeout(idlePrefetchTimer);
  if (activeCardLoaderImg) {
    activeCardLoaderImg.onload = null;
    activeCardLoaderImg.onerror = null;
  }
  if (activeFetchController) activeFetchController.abort();
  abortPrefetch();
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
  document.getElementById('btn-autoplay')?.classList.add('hidden');

  const btnCard = document.getElementById('nav-btn-card');
  const btnQuiz = document.getElementById('nav-btn-quiz');
  const btnFilter = document.getElementById('nav-btn-filter');

  btnCard.className = 'h-7 sm:h-8 px-2.5 rounded-lg text-xs font-bold transition flex items-center justify-center bg-[#EDF2F7] text-[#2B4C7E] hover:bg-[#DCE7F5] border border-[#D5E2F2] btn-jelly';
  btnQuiz.className = 'h-7 sm:h-8 px-2.5 rounded-lg text-xs font-bold transition flex items-center justify-center bg-[#EDF2F7] text-[#2B4C7E] hover:bg-[#DCE7F5] border border-[#D5E2F2] btn-jelly';

  const parentHiddenClass = getIsParentMode() ? '' : 'hidden ';
  btnFilter.className = `${parentHiddenClass}parent-only-control h-7 sm:h-8 px-2.5 rounded-lg bg-[#EFE6D8] hover:bg-[#E5D7C3] text-[#4A3F35] border border-[#D8C7B0] text-xs font-bold flex items-center gap-1 transition btn-jelly`;

  if (view === 'card') {
    document.getElementById('view-card').classList.remove('hidden');
    document.getElementById('btn-autoplay')?.classList.remove('hidden');
    btnCard.className = 'h-7 sm:h-8 px-2.5 rounded-lg text-xs font-bold transition flex items-center justify-center bg-[#2B4C7E] text-white shadow-xs btn-jelly';
    updateCardView();
  } else if (view === 'quiz') {
    document.getElementById('view-quiz').classList.remove('hidden');
    btnQuiz.className = 'h-7 sm:h-8 px-2.5 rounded-lg text-xs font-bold transition flex items-center justify-center bg-[#2B4C7E] text-white shadow-xs btn-jelly';
    resetAndStartQuiz(selectedSet);
  } else if (view === 'filter') {
    document.getElementById('view-filter').classList.remove('hidden');
    btnFilter.className = `${parentHiddenClass}parent-only-control h-7 sm:h-8 px-2.5 rounded-lg bg-[#4A3F35] text-white border border-[#4A3F35] text-xs font-bold flex items-center gap-1 shadow-xs transition btn-jelly`;
    renderParentView();
  }
}

function scheduleNeighborPrefetch() {
  clearTimeout(idlePrefetchTimer);
  idlePrefetchTimer = setTimeout(() => {
    const len = currentPlaylist.length;
    if (len <= 1) return;

    [1, -1, 2, -2].forEach((offset, i) => {
      const target = currentPlaylist[(currentIndex + offset + len) % len];
      if (!target) return;
      const img = imgPreloadPool[i];
      img.decoding = 'async';
      img.onload = () => loadedImageIds.add(target.id);
      img.src = `images/${target.id}.jpg`;
      if (img.decode) img.decode().catch(() => {});
    });

    // 디스크 Cache Storage에 다음/이전 카드 1개씩 순차 저장
    const nextCardItem = currentPlaylist[(currentIndex + 1) % len];
    const prevCardItem = currentPlaylist[(currentIndex - 1 + len) % len];
    const audioUrls = [];
    if (nextCardItem) audioUrls.push(getR2VocaUrl(nextCardItem.id));
    if (prevCardItem && prevCardItem.id !== nextCardItem?.id) {
      audioUrls.push(getR2VocaUrl(prevCardItem.id));
    }
    prefetchVocaUrlsSequentially(audioUrls);
  }, 350);
}

function updateCardView() {
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

  const reqToken = ++imageLoadToken;
  const targetImgUrl = `images/${card.id}.jpg`;

  if (activeCardLoaderImg) {
    activeCardLoaderImg.onload = null;
    activeCardLoaderImg.onerror = null;
  }

  const loader = new Image();
  activeCardLoaderImg = loader;
  loader.decoding = 'async';

  loader.onload = () => {
    if (reqToken !== imageLoadToken) return;
    loadedImageIds.add(card.id);
    imgElement.classList.remove('hidden');
    imgElement.src = targetImgUrl;
    scheduleNeighborPrefetch();
  };

  loader.onerror = () => {
    if (reqToken !== imageLoadToken) return;
    imgElement.classList.add('hidden');
    filterCanvas.classList.add('hidden');
    fallbackBox.classList.remove('hidden');
    fallbackWord.textContent = card.word;
    fallbackText.textContent = `images/${card.id}.jpg 없음`;
  };

  loader.src = targetImgUrl;
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
  abortPrefetch();

  const card = currentPlaylist[currentIndex];
  if (!card) return;

  const token = ++audioPlayToken;
  audioPlayer.pause();
  clearTimeout(audioPlayDebounceTimer);
  if (activeFetchController) activeFetchController.abort();

  audioPlayDebounceTimer = setTimeout(async () => {
    if (token !== audioPlayToken) return;
    activeFetchController = new AbortController();

    try {
      const playableUrl = await getPlayableVocaUrl(getR2VocaUrl(card.id), activeFetchController.signal, 4000);
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
  }, useDebounce ? 80 : 0);
}

function nextCard() {
  if (currentPlaylist.length === 0) return;
  currentIndex = (currentIndex + 1) % currentPlaylist.length;
  updateCardView();
  playCurrentAudio(true, true);
}

function prevCard() {
  if (currentPlaylist.length === 0) return;
  currentIndex = (currentIndex - 1 + currentPlaylist.length) % currentPlaylist.length;
  updateCardView();
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
  const btn = document.getElementById('btn-autoplay');
  const icon = document.getElementById('autoplay-icon');
  if (icon) icon.className = 'fa-solid fa-pause text-sky-200';
  if (btn) {
    const hiddenClass = btn.classList.contains('hidden') ? 'hidden ' : '';
    btn.className = `${hiddenClass}w-8 h-8 rounded-full bg-[#2B4C7E]/90 hover:bg-[#2B4C7E] text-white border border-sky-200/50 ring-2 ring-sky-300/30 text-xs shadow-md backdrop-blur-md flex items-center justify-center transition btn-jelly`;
  }
  playCurrentAudio(true, false);
}

function stopAutoPlay() {
  isAutoPlaying = false;
  clearTimeout(autoPlayTimer);
  const btn = document.getElementById('btn-autoplay');
  const icon = document.getElementById('autoplay-icon');
  if (icon) icon.className = 'fa-solid fa-play';
  if (btn) {
    const hiddenClass = btn.classList.contains('hidden') ? 'hidden ' : '';
    btn.className = `${hiddenClass}w-8 h-8 rounded-full bg-[#172554]/75 hover:bg-[#172554]/90 text-white border border-white/20 text-xs shadow-md backdrop-blur-md flex items-center justify-center transition btn-jelly`;
  }
}