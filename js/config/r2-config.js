export const PDF_URL = 'https://raw.githubusercontent.com/luvgoto/dwe-sa-tac/main/songbook.pdf';

export const R2_SONGS_BASE = 'https://dwe-songs.luvgoto.workers.dev/songs';
export const R2_VOCA_BASE = 'https://dwe-songs.luvgoto.workers.dev/audio';

export const WORKER_ROOT = 'https://dwe-songs.luvgoto.workers.dev';
export const SPOTS_SYNC_URL = `${WORKER_ROOT}/spots-data.json`;

// songs-data.js에 선언된 노래 목록 객체와 기본 좌표 객체를 변수명 후보에서 자동 탐색
function readGlobalVar(candidates) {
  for (const name of candidates) {
    try {
      const val = (0, eval)(`typeof ${name} !== "undefined" ? ${name} : undefined`);
      if (val && typeof val === 'object') return val;
    } catch {}
    if (window[name] && typeof window[name] === 'object') {
      return window[name];
    }
  }
  return {};
}

export const SONGS_DB = readGlobalVar(['SONGS_DB', 'SONG_FILES', 'SONGS_LIST', 'SONGS']);
export const DEFAULT_SONG_SPOTS = readGlobalVar(['DEFAULT_SONG_SPOTS', 'DEFAULT_SPOTS']);

export function isVocaTrackId(trackId) {
  return /^v\d+$/i.test(String(trackId));
}

export function getAudioUrlForTrack(trackId) {
  const idStr = String(trackId);
  if (isVocaTrackId(idStr)) {
    const numPart = idStr.slice(1).padStart(3, '0');
    return `${R2_VOCA_BASE}/${numPart}.mp3`;
  }
  const fileName = SONGS_DB[Number(idStr)] || SONGS_DB[idStr];
  if (!fileName) {
    console.warn('[Audio] 노래 파일명을 찾을 수 없습니다:', trackId, 'SONGS_DB 키 개수:', Object.keys(SONGS_DB).length);
    return '';
  }
  return `${R2_SONGS_BASE}/${encodeURIComponent(fileName)}`;
}

export function getR2VocaUrl(cardId) {
  const padded = String(cardId).padStart(3, '0');
  return `${R2_VOCA_BASE}/${padded}.mp3`;
}