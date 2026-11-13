export const PDF_URL = 'https://raw.githubusercontent.com/luvgoto/dwe-sa-tac/main/songbook.pdf';

export const R2_SONGS_BASE = (typeof window.R2_SONGS_BASE !== 'undefined')
  ? window.R2_SONGS_BASE
  : 'https://dwe-r2.luvgoto.workers.dev/songs';

export const R2_VOCA_BASE = (typeof window.R2_AUDIO_BASE !== 'undefined')
  ? window.R2_AUDIO_BASE
  : R2_SONGS_BASE.replace(/\/songs\/?$/, '/audio');

export const WORKER_ROOT = R2_SONGS_BASE.replace(/\/songs\/?$/, '');
export const SPOTS_SYNC_URL = WORKER_ROOT ? `${WORKER_ROOT}/spots-data.json` : '';

export const SONGS_DB = (typeof window.SONGS_DB !== 'undefined') ? window.SONGS_DB : {};
export const DEFAULT_SONG_SPOTS = (typeof window.DEFAULT_SONG_SPOTS !== 'undefined') ? window.DEFAULT_SONG_SPOTS : {};

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
