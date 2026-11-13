import { isVocaTrackId, getAudioUrlForTrack } from '../config/r2-config.js';

const songAudioEl = document.getElementById('song-audio');
const vocaAudioEl = document.getElementById('voca-audio');
const preloadedAudioUrls = new Set();

let isSongDucking = false;
let volumeFadeTimer = null;
let activeSongSpotKey = null;
let activeVocaSpotKey = null;
let onPlaybackStateChange = null;

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

export function preloadTrackList(spotsList) {
  (spotsList || []).forEach(spot => {
    if (spot.shape === 'voca' || spot.type === 'voca-link') return;
    const url = getAudioUrlForTrack(spot.track);
    if (url && !preloadedAudioUrls.has(url)) {
      preloadedAudioUrls.add(url);
      const tempAudio = new Audio();
      tempAudio.preload = 'metadata';
      tempAudio.src = url;
    }
  });
}

export function playOrPauseR2Song(trackId, spotKey) {
  const targetUrl = getAudioUrlForTrack(trackId);
  if (!targetUrl) {
    console.warn('[Audio] 재생할 URL이 비어 있습니다:', trackId);
    return;
  }

  if (isVocaTrackId(trackId)) {
    if (activeVocaSpotKey === spotKey && vocaAudioEl.src) {
      if (vocaAudioEl.paused) {
        duckSongForVoca();
        vocaAudioEl.play();
      } else {
        vocaAudioEl.pause();
        restoreSongAfterVoca();
      }
      if (onPlaybackStateChange) onPlaybackStateChange();
      return;
    }

    activeVocaSpotKey = spotKey;
    duckSongForVoca();
    vocaAudioEl.src = targetUrl;
    vocaAudioEl.play().catch(err => {
      console.warn('보카 재생 오류:', err);
      restoreSongAfterVoca();
    });
    if (onPlaybackStateChange) onPlaybackStateChange();
  } else {
    if (activeSongSpotKey === spotKey && songAudioEl.src) {
      if (songAudioEl.paused) {
        songAudioEl.play();
      } else {
        songAudioEl.pause();
      }
      if (onPlaybackStateChange) onPlaybackStateChange();
      return;
    }

    activeSongSpotKey = spotKey;
    if (!vocaAudioEl.paused) {
      isSongDucking = true;
      fadeSongVolume(0.15, 100);
    } else {
      isSongDucking = false;
      fadeSongVolume(1.0, 100);
    }
    songAudioEl.src = targetUrl;
    songAudioEl.play().catch(err => console.warn('노래 재생 오류:', err));
    if (onPlaybackStateChange) onPlaybackStateChange();
  }
}

export function stopAllBookAudio() {
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