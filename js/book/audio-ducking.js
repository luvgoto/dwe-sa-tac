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

let songPlayToken = 0;
let vocaPlayToken = 0;
let vocaDebounceTimer = null;
let songDebounceTimer = null;
let activeVocaFetchController = null;

// 연속 재생 & 셔플 플레이리스트 상태
let basePlaylist = [];      // [{ track, spotKey }, ...] 원본 순서
let activePlaylist = [];    // 실제 재생 순서 (순차 또는 셔플된 배열)
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

export function preloadTrackList() {
  // 페이지 이동 시 대량 프리로드로 연결 제한을 채우지 않도록 비활성화
}

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
  if (!targetUrl) {
    console.warn('[Audio] 재생할 URL이 비어 있습니다:', trackId);
    return;
  }

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
  updateFloatingSongCapsule();
  if (onPlaybackStateChange) onPlaybackStateChange();

  songDebounceTimer = setTimeout(() => {
    if (token !== songPlayToken || activeSongSpotKey !== spotKey) return;
    songAudioEl.src = targetUrl;
    songAudioEl.play()
      .then(() => {
        if (token === songPlayToken && onPlaybackStateChange) onPlaybackStateChange();
      })
      .catch(err => {
        if (token !== songPlayToken) return;
        console.warn('노래 재생 오류:', err);
      });
  }, 120);
}

/**
 * 목차 권별(SA1~SA4) 또는 표지 전체 연속/셔플 재생 시작
 * @param {Array<{track: string, spotKey: string}>} items
 * @param {number} startIndex - 처음 재생할 곡의 인덱스 (전체 셔플 시 -1)
 * @param {boolean} shuffle - 셔플 여부
 */
export function playSongPlaylist(items, startIndex = 0, shuffle = false) {
  if (!items || items.length === 0) return;
  wakeMobileAudioHardware();
  abortPrefetch();

  // 같은 곡을 다시 탭한 경우 일시정지/재개 토글
  if (startIndex >= 0 && items[startIndex]) {
    const clicked = items[startIndex];
    const targetUrl = getAudioUrlForTrack(clicked.track);
    if (activeSongSpotKey === clicked.spotKey && songAudioEl.src === targetUrl) {
      if (songAudioEl.paused) {
        songAudioEl.play().catch(() => {});
      } else {
        songAudioEl.pause();
      }
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
  updateFloatingSongCapsule();
}

export function playOrPauseR2Song(trackId, spotKey) {
  wakeMobileAudioHardware();
  abortPrefetch();

  const targetUrl = getAudioUrlForTrack(trackId);
  if (!targetUrl) {
    console.warn('[Audio] 재생할 URL이 비어 있습니다:', trackId);
    return;
  }

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
        console.warn('보카 재생 오류:', err);
        restoreSongAfterVoca();
      }
    }, 80);
  } else {
    // 본문 단일 곡 재생 시에는 플레이리스트 초기화
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
      if (onPlaybackStateChange) onPlaybackStateChange();
      return;
    }

    startTrackInternal(trackId, spotKey);
  }
}

function updateFloatingSongCapsule() {
  const capsule = document.getElementById('floating-song-capsule');
  const icon = document.getElementById('floating-song-icon');
  const shuffleBtn = document.getElementById('btn-floating-song-shuffle');
  const shuffleDiv = document.getElementById('floating-shuffle-divider');
  if (!capsule) return;

  const hasActiveSong = Boolean(activeSongSpotKey && songAudioEl.src && !songAudioEl.ended);
  capsule.classList.toggle('hidden', !hasActiveSong);

  if (hasActiveSong) {
    if (icon) {
      icon.className = songAudioEl.paused
        ? 'fa-solid fa-play text-emerald-300'
        : 'fa-solid fa-pause text-amber-300';
    }

    const hasQueue = basePlaylist.length > 1;
    if (shuffleBtn && shuffleDiv) {
      shuffleBtn.classList.toggle('hidden', !hasQueue);
      shuffleDiv.classList.toggle('hidden', !hasQueue);
      if (hasQueue) {
        shuffleBtn.className = isPlaylistShuffle
          ? 'w-8 h-8 bg-amber-400/25 text-amber-300 text-xs flex items-center justify-center transition'
          : 'w-8 h-8 hover:bg-white/15 text-white/55 text-xs flex items-center justify-center transition';
      }
    }
  }
}

export function toggleFloatingSongPause() {
  if (!activeSongSpotKey || !songAudioEl.src) return;
  if (songAudioEl.paused) {
    songAudioEl.play().catch(() => {});
  } else {
    songAudioEl.pause();
  }
  updateFloatingSongCapsule();
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
  updateFloatingSongCapsule();
  if (onPlaybackStateChange) onPlaybackStateChange();
}

songAudioEl.addEventListener('play', updateFloatingSongCapsule);
songAudioEl.addEventListener('pause', updateFloatingSongCapsule);

songAudioEl.addEventListener('ended', () => {
  // 플레이리스트에 다음 곡이 남아 있으면 자동 연속 재생
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
  updateFloatingSongCapsule();
  if (onPlaybackStateChange) onPlaybackStateChange();
});

vocaAudioEl.addEventListener('ended', () => {
  activeVocaSpotKey = null;
  restoreSongAfterVoca();
  if (onPlaybackStateChange) onPlaybackStateChange();
});

document.getElementById('btn-floating-song-toggle')?.addEventListener('click', toggleFloatingSongPause);
document.getElementById('btn-floating-song-shuffle')?.addEventListener('click', togglePlaylistShuffle);
document.getElementById('btn-floating-song-stop')?.addEventListener('click', stopAllBookAudio);