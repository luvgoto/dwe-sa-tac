import { isVocaTrackId, getAudioUrlForTrack } from '../config/r2-config.js';

const songAudioEl = document.getElementById('song-audio');
const vocaAudioEl = document.getElementById('voca-audio');

let isSongDucking = false;
let volumeFadeTimer = null;
let activeSongSpotKey = null;
let activeVocaSpotKey = null;
let onPlaybackStateChange = null;

let songPlayToken = 0;
let vocaPlayToken = 0;
let vocaDebounceTimer = null;
let songDebounceTimer = null;

// 모바일 오디오 하드웨어 절전 방지 (최초 1회 및 절전 해제용)
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
  // 동시 연결 6개 제한 고갈 방지를 위해 프리로드 비활성화
}

export function playOrPauseR2Song(trackId, spotKey) {
  wakeMobileAudioHardware();

  const targetUrl = getAudioUrlForTrack(trackId);
  if (!targetUrl) {
    console.warn('[Audio] 재생할 URL이 비어 있습니다:', trackId);
    return;
  }

  if (isVocaTrackId(trackId)) {
    if (activeVocaSpotKey === spotKey && vocaAudioEl.src === targetUrl) {
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
    if (onPlaybackStateChange) onPlaybackStateChange();

    // 빠른 연타 시 마지막 터치만 1번 연결 (소켓 고갈 방지)
    vocaDebounceTimer = setTimeout(() => {
      if (token !== vocaPlayToken || activeVocaSpotKey !== spotKey) return;
      vocaAudioEl.src = targetUrl;
      vocaAudioEl.play()
        .then(() => {
          if (token === vocaPlayToken && onPlaybackStateChange) onPlaybackStateChange();
        })
        .catch(err => {
          if (token !== vocaPlayToken) return;
          console.warn('보카 재생 오류:', err);
          restoreSongAfterVoca();
        });
    }, 150);
  } else {
    if (activeSongSpotKey === spotKey && songAudioEl.src === targetUrl) {
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
    songAudioEl.pause();
    clearTimeout(songDebounceTimer);
    if (onPlaybackStateChange) onPlaybackStateChange();

    // 빠른 연타 시 마지막 곡만 1번 연결 (.load() 호출 금지 -> 좀비 소켓 차단)
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
    }, 150);
  }
}

export function stopAllBookAudio() {
  songPlayToken++;
  vocaPlayToken++;
  clearTimeout(vocaDebounceTimer);
  clearTimeout(songDebounceTimer);
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