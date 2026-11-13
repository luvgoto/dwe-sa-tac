import { SPOTS_SYNC_URL, DEFAULT_SONG_SPOTS, isVocaTrackId } from '../config/r2-config.js';

let songSpotsData = JSON.parse(JSON.stringify(DEFAULT_SONG_SPOTS || {}));

export function getSpotsForPage(pageNum) {
  return songSpotsData[String(pageNum)] || [];
}

export function setSpotsForPage(pageNum, list) {
  songSpotsData[String(pageNum)] = list;
}

export function isVocaLinkSpot(spot) {
  return Boolean(spot && (spot.shape === 'voca' || spot.type === 'voca-link'));
}

export function updateSyncBadge(state, text) {
  const badge = document.getElementById('sync-status-badge');
  if (!badge) return;
  if (state === 'saving') {
    badge.className = 'ml-1 px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold text-[10px] flex items-center gap-1';
    badge.innerHTML = `<i class="fa-solid fa-rotate fa-spin"></i><span>${text || '저장 중...'}</span>`;
  } else if (state === 'error') {
    badge.className = 'ml-1 px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-bold text-[10px] flex items-center gap-1';
    badge.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i><span>${text || '오프라인 저장됨'}</span>`;
  } else {
    badge.className = 'ml-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px] flex items-center gap-1';
    badge.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i><span>${text || '클라우드 동기화됨'}</span>`;
  }
}

export async function loadSpotsFromCloud() {
  const localBackup = JSON.parse(localStorage.getItem('dwe_song_circles') || 'null');
  if (localBackup) {
    songSpotsData = { ...songSpotsData, ...localBackup };
  }
  if (!SPOTS_SYNC_URL) return;

  try {
    const res = await fetch(`${SPOTS_SYNC_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const cloudData = await res.json();
      if (cloudData && typeof cloudData === 'object' && Object.keys(cloudData).length > 0) {
        songSpotsData = cloudData;
        localStorage.setItem('dwe_song_circles', JSON.stringify(songSpotsData));
        updateSyncBadge('saved', '클라우드 동기화됨');
      } else if (Object.keys(songSpotsData).length > 0) {
        await saveSpotsToCloud();
      }
    }
  } catch (e) {
    console.warn('클라우드 동기화 로드 실패:', e);
    updateSyncBadge('error', '로컬 모드');
  }
}

export async function saveSpotsToCloud() {
  localStorage.setItem('dwe_song_circles', JSON.stringify(songSpotsData));
  if (!SPOTS_SYNC_URL) return;

  updateSyncBadge('saving', '클라우드 저장 중...');
  try {
    const res = await fetch(SPOTS_SYNC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(songSpotsData)
    });
    if (res.ok) {
      updateSyncBadge('saved', '클라우드 저장 완료');
    } else {
      updateSyncBadge('error', '서버 응답 오류');
    }
  } catch (e) {
    console.warn('클라우드 자동 저장 실패:', e);
    updateSyncBadge('error', '로컬 임시저장됨');
  }
}

export function detectDefaultVocaEndPage(startPage, anchorY = 0, totalPages = 500) {
  let lastVocaPage = startPage;
  const maxScan = Math.min(totalPages || 500, startPage + 12);

  for (let p = startPage; p <= maxScan; p++) {
    const spots = getSpotsForPage(p);
    if (p > startPage) {
      const hasNextVocaBadge = spots.some(s => isVocaLinkSpot(s));
      if (hasNextVocaBadge) break;
    } else {
      const hasLowerVocaBadge = spots.some(s => isVocaLinkSpot(s) && s.y > anchorY + 4);
      if (hasLowerVocaBadge) return startPage;
    }

    const hasVocaCards = spots.some(s => !isVocaLinkSpot(s) && isVocaTrackId(s.track));
    if (hasVocaCards) {
      lastVocaPage = p;
    } else if (p > startPage) {
      break;
    }
  }
  return lastVocaPage;
}

export function collectVocaCardsInRange(startPage, endPage, anchorY = 0) {
  const fromP = Math.max(1, Number(startPage) || 1);
  const toP = Math.max(fromP, Number(endPage) || fromP);
  const collected = [];

  for (let p = fromP; p <= toP; p++) {
    const spots = getSpotsForPage(p);
    const pageVocaSpots = spots.filter(s => {
      if (isVocaLinkSpot(s) || !isVocaTrackId(s.track)) return false;
      if (p === fromP && anchorY > 0 && s.y < anchorY - 4) return false;
      return true;
    });

    pageVocaSpots.sort((a, b) => {
      if (Math.abs(a.y - b.y) > 5.0) {
        return a.y - b.y;
      }
      return a.x - b.x;
    });

    pageVocaSpots.forEach(s => {
      const normalized = String(s.track).toLowerCase();
      if (!collected.includes(normalized)) {
        collected.push(normalized);
      }
    });
  }
  return collected;
}
