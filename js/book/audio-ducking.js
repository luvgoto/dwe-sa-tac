import { isVocaTrackId, getAudioUrlForTrack } from '../config/r2-config.js';

const songAudioEl = document.getElementById('song-audio');
const vocaAudioEl = document.getElementById('voca-audio');
const preloadedAudioUrls = new Set();

let audioCtx = null;
let songGainNode = null;
let isSongDucking = false;
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

function initSongGainDucking() {
  try {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      audioCtx = new AudioContextClass();
      const source = audioCtx.createMediaElementSource(songAudioEl);
      songGainNode = audioCtx.createGain();
      songGainNode.gain.value = 1.0;
      source.connect(songGainNode);
      songGainNode.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  } catch (e) {
    console.warn('Web Audio Gain 초기화 폴백:', e);
  }
}

function fadeSongVolume(targetLevel, durationSec) {
  initSongGainDucking();
  if (songGainNode && audioCtx) {
    const now = audioCtx.currentTime;
    songGainNode.gain.cancelScheduledValues(now);
    songGainNode.gain.setValueAtTime(songGainNode.gain.value, now);
    songGainNode.gain.linearRampToValueAtTime(targetLevel, now + durationSec);
  } else {
    songAudioEl.volume = targetLevel;
  }
}

function duckSongForVoca() {
  if (!songAudioEl.paused && !isSongDucking) {
    isSongDucking = true;
    fadeSongVolume(0.15, 0.25);
  }
}

function restoreSongAfterVoca() {
  if (isSongDucking) {
    isSongDucking = false;
    fadeSongVolume(1.0, 0.4);
  }
}

export function preloadTrackList(spotsList) {
  (spotsList || []).forEach(spot => {
    if (spot.shape === 'voca' || spot.type === 'voca-link') return;
    const url = getAudioUrlForTrack(spot.track);
    if (url && !preloadedAudioUrls.has(url)) {
      preloadedAudioUrls.add(url);
      fetch(url, { mode: 'cors', cache: 'force-cache' }).catch(() => {
        preloadedAudioUrls.delete(url);
      });
    }
  });
}

export function playOrPauseR2Song(trackId, spotKey) {
  const targetUrl = getAudioUrlForTrack(trackId);
  if (!targetUrl) return;

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
    vocaAudioEl.play().catch(() => restoreSongAfterVoca());
    if (onPlaybackStateChange) onPlaybackStateChange();
  } else {
    initSongGainDucking();
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
      fadeSongVolume(0.15, 0.1);
    } else {
      isSongDucking = false;
      fadeSongVolume(1.0, 0.1);
    }
    songAudioEl.src = targetUrl;
    songAudioEl.play().catch(err => console.warn('노래 재생 오류:', err));
    if (onPlaybackStateChange) onPlaybackStateChange();
  }
}

export function stopAllBookAudio() {
  songAudioEl.pause();
  vocaAudioEl.pause();
  activeSongSpotKey = null;
  activeVocaSpotKey = null;
  isSongDucking = false;
  if (onPlaybackStateChange) onPlaybackStateChange();
}

songAudioEl.addEventListener('ended', () => {
  activeSongSpotKey = null;
  isSongDucking = false;
  if (onPlaybackStateChange) onPlaybackStateChange();
});

vocaAudioEl.addEventListener('ended', () => {
  activeVocaSpotKey = null;
  restoreSongAfterVoca();
  if (onPlaybackStateChange) onPlaybackStateChange();
});
