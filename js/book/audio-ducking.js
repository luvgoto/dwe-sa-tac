import { isVocaTrackId, getAudioUrlForTrack } from '../config/r2-config.js';

const songAudioEl = document.getElementById('song-audio');
const vocaAudioEl = document.getElementById('voca-audio');

let isSongDucking = false;
let volumeFadeTimer = null;
let activeSongSpotKey = null;
let activeVocaSpotKey = null;
let onPlaybackStateChange = null;

// 연타 방어용 토큰, 타이머, AbortController
let songPlayToken = 0;
let vocaPlayToken = 0;
let vocaDebounceTimer = null;
let songDebounceTimer = null;
let activeVocaFetchController = null;

// 송북 내 VOCA(단어) 음원용 메모리 Blob 캐시 (중간 끊김 원천 방지)
const bookVocaBlobCache = new Map();
const MAX_BOOK_VOCA_CACHE = 20;

async function fetchBookVocaPlayableUrl(trackId, rawUrl, signal, timeoutMs = 3500) {
  if (bookVocaBlobCache.has(trackId)) {
    const cached = bookVocaBlobCache.get(trackId);
    bookVocaBlobCache.delete(trackId);
    bookVocaBlobCache.set(trackId, cached);
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

    if (bookVocaBlobCache.size >= MAX_BOOK_VOCA_CACHE) {
      const oldestKey = bookVocaBlobCache.keys().next().value;
      const oldestUrl = bookVocaBlobCache.get(oldestKey);
      bookVocaBlobCache.delete(oldestKey);
      URL.revokeObjectURL(oldestUrl);
    }
    bookVocaBlobCache.set(trackId, blobUrl);
    return blobUrl;
  } catch (err) {
    clearTimeout(timeoutId);
    if (signal && signal.aborted) throw err;
    return rawUrl;
  }
}

// 모바일 오디오 하드웨어 절전 방지
let keepAliveCtx = null;
function wakeMobileAudioHardware() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!keepAliveCtx) keepAliveCtx = new AudioCtx();
    if (keepAliveCtx.state === 'suspended') {
      keepAliveCtx.resume().catch(() => {});
    }
    const osc = keepAliveCtx.createOscillator();
    const gain = keepAliveCtx.createGain();
    gain.gain.value = 0.00001;
    osc.connect(gain);
    gain.connect(keepAliveCtx.destination);
    osc.start(0);
    osc.stop(keepAliveCtx.currentTime + 0.05);
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
  const steps = 10;
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
    fadeSongVolume(0.15, 250);
  }
}

function restoreSongAfterVoca() {
  if (isSongDucking) {
    isSongDucking = false;
    fadeSongVolume(1.0, 400);
  }
}

export function preloadTrackList() {
  // Intentionally no-op to prevent concurrent stream bandwidth contention
}

export function playOrPauseR2Song(trackId, spotKey) {
  wakeMobileAudioHardware();

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

    const isCached = bookVocaBlobCache.has(trackId);
    vocaDebounceTimer = setTimeout(async () => {
      if (token !== vocaPlayToken || activeVocaSpotKey !== spotKey) return;
      activeVocaFetchController = new AbortController();
      try {
        const playableUrl = await fetchBookVocaPlayableUrl(trackId, targetUrl, activeVocaFetchController.signal, 3500);
        if (token !== vocaPlayToken || activeVocaSpotKey !== spotKey) return;
        vocaAudioEl.src = playableUrl;
        vocaAudioEl.currentTime = 0;
        await vocaAudioEl.play();
        if (onPlaybackStateChange) onPlaybackStateChange();
      } catch (err) {
        if (activeVocaFetchController.signal.aborted) return;
        console.warn('보카 재생 오류:', err);
        restoreSongAfterVoca();
      }
    }, isCached ? 0 : 90);
  } else {
    if (activeSongSpotKey === spotKey && songAudioEl.src) {
      if (songAudioEl.paused) {
        songAudioEl.play().catch(() => {});
      } else {
        songAudioEl.pause();
      }
      if (onPlaybackStateChange) onPlaybackStateChange();
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
    // 이전 노래 스트리밍 연결을 완전히 비워 대역폭 충돌 방지
    songAudioEl.pause();
    songAudioEl.removeAttribute('src');
    songAudioEl.load();
    if (onPlaybackStateChange) onPlaybackStateChange();

    clearTimeout(songDebounceTimer);
    songDebounceTimer = setTimeout(() => {
      if (token !== songPlayToken || activeSongSpotKey !== spotKey) return;
      songAudioEl.src = targetUrl;
      songAudioEl.play().catch(err => {
        if (token !== songPlayToken) return;
        console.warn('노래 재생 오류:', err);
      });
      if (onPlaybackStateChange) onPlaybackStateChange();
    }, 100);
  }
}

export function stopAllBookAudio() {
  songPlayToken++;
  vocaPlayToken++;
  clearTimeout(vocaDebounceTimer);
  clearTimeout(songDebounceTimer);
  if (activeVocaFetchController) activeVocaFetchController.abort();
  clearInterval(volumeFadeTimer);
  songAudioEl.pause();
  vocaAudioEl.pause();
  songAudioEl.volume = 1.0;
  activeSongSpotKey = null;
  activeVocaSpotKey = null;
  isSongDucking = false;
  if (onPlaybackStateChange) onPlaybackStateChange();
}

songAudioEl.addEventListener('ended', () => {
  activeSongSpotKey = null;
  isSongDucking = false;
  songAudioEl.volume = 1.0;
  if (onPlaybackStateChange) onPlaybackStateChange();
});

vocaAudioEl.addEventListener('ended', () => {
  activeVocaSpotKey = null;
  restoreSongAfterVoca();
  if (onPlaybackStateChange) onPlaybackStateChange();
});