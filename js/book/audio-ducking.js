import { isVocaTrackId, getAudioUrlForTrack } from '../config/r2-config.js';
import { getPlayableVocaUrl, abortPrefetch, registerSongPlayingChecker } from '../config/audio-cache.js';

const songAudioEl = document.getElementById('song-audio');
const vocaAudioEl = document.getElementById('voca-audio');

registerSongPlayingChecker(() => !songAudioEl.paused && !songAudioEl.ended);

let isSongDucking = false;
let volumeFadeTimer = null;
let activeSongSpotKey = null;
let activeVocaSpotKey = null;
let onPlaybackStateChange = null;
let defaultPlayActionCallback = null;

let songPlayToken = 0;
let vocaPlayToken = 0;
let vocaDebounceTimer = null;
let songDebounceTimer = null;
let activeVocaFetchController = null;

let basePlaylist = [];
let activePlaylist = [];
let currentQueueIndex = -1;
let isPlaylistShuffle = false;

let keepAliveCtx = null;
function wakeMobileAudioHardware() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!keepAliveCtx) keepAliveCtx = new AudioCtx();
    if (keepAliveCtx.state === 'suspended') {
      keepAliveCtx.resume().catch(() => {});
    }
  } catch {}
}

export function setAudioStateCallback(cb) {
  onPlaybackStateChange = cb;
}

export function setDefaultPlayActionCallback(cb) {
  defaultPlayActionCallback = cb;
}

export function getActiveAudioKeys() {
  return {
    activeSongSpotKey: (activeSongSpotKey && !songAudioEl.paused) ? activeSongSpotKey : null,
    activeVocaSpotKey: (activeVocaSpotKey && !vocaAudioEl.paused) ? activeVocaSpotKey : null
  };
}

function fadeSongVolume(targetLevel, durationMs) {
  clearInterval(volumeFadeTimer);
  const startVol = songAudioEl.volume;
  const steps = 8;
  const stepTime = Math.max(15, Math.floor(durationMs / steps));
  let currentStep = 0;

  volumeFadeTimer = setInterval(() => {
    currentStep++;
    const nextVol = startVol + ((targetLevel - startVol) * (currentStep / steps));
    songAudioEl.volume = Math.max(0, Math.min(1, nextVol));
    if (currentStep >= steps) {
      clearInterval(volumeFadeTimer);
      songAudioEl.volume = targetLevel;
    }
  }, stepTime);
}

function duckSongForVoca() {
  if (!songAudioEl.paused && !isSongDucking) {
    isSongDucking = true;
    fadeSongVolume(0.15, 220);
  }
}

function restoreSongAfterVoca() {
  if (isSongDucking) {
    isSongDucking = false;
    fadeSongVolume(1.0, 350);
  }
}

export function preloadTrackList() {}

function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildActiveQueue(items, startIndex, shuffle) {
  if (!shuffle) {
    return { queue: [...items], index: Math.max(0, startIndex) };
  }
  const startItem = items[startIndex];
  if (startItem) {
    const rest = items.filter((_, idx) => idx !== startIndex);
    return { queue: [startItem, ...shuffleArray(rest)], index: 0 };
  }
  return { queue: shuffleArray(items), index: 0 };
}

function startTrackInternal(trackId, spotKey) {
  const targetUrl = getAudioUrlForTrack(trackId);
  if (!targetUrl) return;

  const token = ++songPlayToken;
  activeSongSpotKey = spotKey;
  if (!vocaAudioEl.paused) {
    isSongDucking = true;
    fadeSongVolume(0.15, 100);
  } else {
    isSongDucking = false;
    fadeSongVolume(1.0, 100);
  }
  songAudioEl.pause();
  clearTimeout(songDebounceTimer);
  updateFloatingControlsUI(true);
  if (onPlaybackStateChange) onPlaybackStateChange();

  songDebounceTimer = setTimeout(() => {
    if (token !== songPlayToken || activeSongSpotKey !== spotKey) return;
    songAudioEl.src = targetUrl;
    songAudioEl.play()
      .then(() => {
        if (token === songPlayToken) {
          updateFloatingControlsUI();
          if (onPlaybackStateChange) onPlaybackStateChange();
        }
      })
      .catch(err => {
        if (token !== songPlayToken) return;
        console.warn('노래 재생 오류:', err);
        updateFloatingControlsUI();
      });
  }, 120);
}

export function playSongPlaylist(items, startIndex = 0, shuffle = false) {
  if (!items || items.length === 0) return;
  wakeMobileAudioHardware();
  abortPrefetch();

  // 같은 곡을 한 번 더 터치하면 일시정지/재개 토글
  if (startIndex >= 0 && items[startIndex]) {
    const clicked = items[startIndex];
    const targetUrl = getAudioUrlForTrack(clicked.track);
    if (activeSongSpotKey === clicked.spotKey && songAudioEl.src === targetUrl) {
      if (songAudioEl.paused) {
        songAudioEl.play().catch(() => {});
      } else {
        songAudioEl.pause();
      }
      updateFloatingControlsUI();
      if (onPlaybackStateChange) onPlaybackStateChange();
      return;
    }
  }

  basePlaylist = [...items];
  isPlaylistShuffle = shuffle;
  const built = buildActiveQueue(basePlaylist, startIndex, shuffle);
  activePlaylist = built.queue;
  currentQueueIndex = built.index;

  const first = activePlaylist[currentQueueIndex];
  if (first) {
    startTrackInternal(first.track, first.spotKey);
  }
}

export function playPrevInPlaylist() {
  if (activePlaylist.length <= 1) return;
  if (songAudioEl.currentTime > 3) {
    songAudioEl.currentTime = 0;
    if (songAudioEl.paused) songAudioEl.play().catch(() => {});
    return;
  }
  currentQueueIndex = (currentQueueIndex - 1 + activePlaylist.length) % activePlaylist.length;
  const prevItem = activePlaylist[currentQueueIndex];
  if (prevItem) {
    startTrackInternal(prevItem.track, prevItem.spotKey);
  }
}

export function playNextInPlaylist() {
  if (activePlaylist.length <= 1) return;
  currentQueueIndex = (currentQueueIndex + 1) % activePlaylist.length;
  const nextItem = activePlaylist[currentQueueIndex];
  if (nextItem) {
    startTrackInternal(nextItem.track, nextItem.spotKey);
  }
}

export function togglePlaylistShuffle() {
  if (basePlaylist.length <= 1) return;
  isPlaylistShuffle = !isPlaylistShuffle;

  const currentItem = activePlaylist[currentQueueIndex];
  if (isPlaylistShuffle) {
    const rest = basePlaylist.filter(item => !currentItem || item.spotKey !== currentItem.spotKey);
    activePlaylist = currentItem ? [currentItem, ...shuffleArray(rest)] : shuffleArray(basePlaylist);
    currentQueueIndex = 0;
  } else {
    activePlaylist = [...basePlaylist];
    currentQueueIndex = currentItem
      ? Math.max(0, activePlaylist.findIndex(item => item.spotKey === currentItem.spotKey))
      : 0;
  }
  updateFloatingControlsUI();
}

export function playOrPauseR2Song(trackId, spotKey) {
  wakeMobileAudioHardware();
  abortPrefetch();

  const targetUrl = getAudioUrlForTrack(trackId);
  if (!targetUrl) return;

  if (isVocaTrackId(trackId)) {
    if (activeVocaSpotKey === spotKey && vocaAudioEl.src) {
      if (vocaAudioEl.paused) {
        duckSongForVoca();
        vocaAudioEl.play().catch(() => {});
      } else {
        vocaAudioEl.pause();
        restoreSongAfterVoca();
      }
      if (onPlaybackStateChange) onPlaybackStateChange();
      return;
    }

    const token = ++vocaPlayToken;
    activeVocaSpotKey = spotKey;
    duckSongForVoca();
    vocaAudioEl.pause();
    clearTimeout(vocaDebounceTimer);
    if (activeVocaFetchController) activeVocaFetchController.abort();
    if (onPlaybackStateChange) onPlaybackStateChange();

    vocaDebounceTimer = setTimeout(async () => {
      if (token !== vocaPlayToken || activeVocaSpotKey !== spotKey) return;
      activeVocaFetchController = new AbortController();

      try {
        const playableUrl = await getPlayableVocaUrl(targetUrl, activeVocaFetchController.signal, 4000);
        if (token !== vocaPlayToken || activeVocaSpotKey !== spotKey) return;
        vocaAudioEl.src = playableUrl;
        vocaAudioEl.currentTime = 0;
        await vocaAudioEl.play();
        if (token === vocaPlayToken && onPlaybackStateChange) onPlaybackStateChange();
      } catch (err) {
        if (activeVocaFetchController.signal.aborted) return;
        restoreSongAfterVoca();
      }
    }, 80);
  } else {
    // 본문 단일 곡 재생 시 플레이리스트 초기화
    basePlaylist = [];
    activePlaylist = [];
    currentQueueIndex = -1;
    isPlaylistShuffle = false;

    if (activeSongSpotKey === spotKey && songAudioEl.src === targetUrl) {
      if (songAudioEl.paused) {
        songAudioEl.play().catch(() => {});
      } else {
        songAudioEl.pause();
      }
      updateFloatingControlsUI();
      if (onPlaybackStateChange) onPlaybackStateChange();
      return;
    }

    startTrackInternal(trackId, spotKey);
  }
}

export function updateFloatingControlsUI(forceStarting = false) {
  const icon = document.getElementById('floating-song-icon');
  const shuffleBtn = document.getElementById('btn-floating-song-shuffle');
  const row2 = document.getElementById('floating-row-2');

  const hasActiveSong = Boolean(activeSongSpotKey && (forceStarting || (songAudioEl.src && !songAudioEl.ended)));
  const isPlayingNow = hasActiveSong && (forceStarting || !songAudioEl.paused);
  const hasQueue = basePlaylist.length > 1;

  if (icon) {
    icon.className = isPlayingNow
      ? 'fa-solid fa-pause text-amber-300'
      : 'fa-solid fa-play text-emerald-300';
  }

  if (shuffleBtn) {
    shuffleBtn.className = (hasQueue && isPlaylistShuffle)
      ? 'flex-1 h-full bg-amber-400/25 text-amber-300 text-[10px] flex items-center justify-center transition'
      : 'flex-1 h-full hover:bg-white/15 text-white/55 text-[10px] flex items-center justify-center transition';
  }

  // 음악이 실제로 재생 중(isPlayingNow)이고 표지/목차 플레이리스트일 때만 캡슐 노출
  if (row2) {
    row2.classList.toggle('hidden', !(isPlayingNow && hasQueue));
  }

  window.dispatchEvent(new Event('floating-controls-sync'));
}

export function toggleFloatingSongPause() {
  const hasActiveSong = Boolean(activeSongSpotKey && songAudioEl.src && !songAudioEl.ended);
  if (!hasActiveSong) {
    if (defaultPlayActionCallback) defaultPlayActionCallback();
    return;
  }

  if (songAudioEl.paused) {
    songAudioEl.play().catch(() => {});
  } else {
    songAudioEl.pause();
  }
  updateFloatingControlsUI();
  if (onPlaybackStateChange) onPlaybackStateChange();
}

export function stopAllBookAudio() {
  songPlayToken++;
  vocaPlayToken++;
  clearTimeout(vocaDebounceTimer);
  clearTimeout(songDebounceTimer);
  if (activeVocaFetchController) activeVocaFetchController.abort();
  abortPrefetch();
  clearInterval(volumeFadeTimer);
  songAudioEl.pause();
  songAudioEl.currentTime = 0;
  vocaAudioEl.pause();
  songAudioEl.volume = 1.0;
  activeSongSpotKey = null;
  activeVocaSpotKey = null;
  isSongDucking = false;
  basePlaylist = [];
  activePlaylist = [];
  currentQueueIndex = -1;
  isPlaylistShuffle = false;
  updateFloatingControlsUI();
  if (onPlaybackStateChange) onPlaybackStateChange();
}

songAudioEl.addEventListener('play', () => updateFloatingControlsUI());
songAudioEl.addEventListener('pause', () => updateFloatingControlsUI());

songAudioEl.addEventListener('ended', () => {
  if (activePlaylist.length > 0 && currentQueueIndex + 1 < activePlaylist.length) {
    currentQueueIndex++;
    const nextItem = activePlaylist[currentQueueIndex];
    if (nextItem) {
      startTrackInternal(nextItem.track, nextItem.spotKey);
      return;
    }
  }

  activeSongSpotKey = null;
  isSongDucking = false;
  songAudioEl.volume = 1.0;
  basePlaylist = [];
  activePlaylist = [];
  currentQueueIndex = -1;
  updateFloatingControlsUI();
  if (onPlaybackStateChange) onPlaybackStateChange();
});

vocaAudioEl.addEventListener('ended', () => {
  activeVocaSpotKey = null;
  restoreSongAfterVoca();
  if (onPlaybackStateChange) onPlaybackStateChange();
});

document.getElementById('btn-floating-song-prev')?.addEventListener('click', playPrevInPlaylist);
document.getElementById('btn-floating-song-toggle')?.addEventListener('click', toggleFloatingSongPause);
document.getElementById('btn-floating-song-next')?.addEventListener('click', playNextInPlaylist);
document.getElementById('btn-floating-song-shuffle')?.addEventListener('click', togglePlaylistShuffle);