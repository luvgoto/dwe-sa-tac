export const PDF_URL = 'https://raw.githubusercontent.com/luvgoto/dwe-sa-tac/main/songbook.pdf';

export const R2_SONGS_BASE = 'https://dwe-songs.luvgoto.workers.dev/songs';
export const R2_VOCA_BASE = 'https://dwe-songs.luvgoto.workers.dev/audio';

export const WORKER_ROOT = 'https://dwe-songs.luvgoto.workers.dev';
export const SPOTS_SYNC_URL = `${WORKER_ROOT}/spots-data.json`;

// 전역 스코프(songs-data.js)에 const로 선언된 변수를 자기 참조 없이 안전하게 읽기
const _globalSongsDb = (() => {
  try {
    return (0, eval)('typeof SONGS_DB !== "undefined" ? SONGS_DB : {}');
  } catch {
    return window.SONGS_DB || {};
  }
})();

const _globalDefaultSpots = (() => {
  try {
    return (0, eval)('typeof DEFAULT_SONG_SPOTS !== "undefined" ? DEFAULT_SONG_SPOTS : {}');
  } catch {
    return window.DEFAULT_SONG_SPOTS || {};
  }
})();

export const SONGS_DB = _globalSongsDb;
export const DEFAULT_SONG_SPOTS = _globalDefaultSpots;

export function isVocaTrackId(trackId) {
  return /^v\d+$/i.test(String(trackId));
}

export function getAudioUrlForTrack(trackId) {
  const idStr = String(trackId);
  if (isVocaTrackId(idStr)) {
    const numPart = idStr.slice(1).padStart(3, '0');
    return `${R2_VOCA_BASE}/${numPart}.mp3`;
  }
  const fileName = SONGS_DB[Number(idStr)];
  if (!fileName) return '';
  return `${R2_SONGS_BASE}/${encodeURIComponent(fileName)}`;
}

export function getR2VocaUrl(cardId) {
  const padded = String(cardId).padStart(3, '0');
  return `${R2_VOCA_BASE}/${padded}.mp3`;
}