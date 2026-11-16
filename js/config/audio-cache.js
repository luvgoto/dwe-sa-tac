const CACHE_NAME = 'dwe-voca-audio-v1';

// 최근 사용한 ObjectURL 30개만 가볍게 유지 (RAM 절약)
const objectUrlPool = new Map();
const MAX_OBJECT_URLS = 30;

// 진행 중인 미리읽기(Prefetch) 중단 컨트롤러
let prefetchController = null;
let isSongPlayingChecker = () => false;

export function registerSongPlayingChecker(fn) {
  isSongPlayingChecker = fn;
}

function rememberObjectUrl(rawUrl, blobUrl) {
  if (objectUrlPool.has(rawUrl)) {
    const existing = objectUrlPool.get(rawUrl);
    objectUrlPool.delete(rawUrl);
    objectUrlPool.set(rawUrl, existing);
    return existing;
  }
  if (objectUrlPool.size >= MAX_OBJECT_URLS) {
    const oldestKey = objectUrlPool.keys().next().value;
    const oldestUrl = objectUrlPool.get(oldestKey);
    objectUrlPool.delete(oldestKey);
    URL.revokeObjectURL(oldestUrl);
  }
  objectUrlPool.set(rawUrl, blobUrl);
  return blobUrl;
}

// 1순위: 사용자가 직접 클릭/재생 요청한 단어 음원 가져오기
export async function getPlayableVocaUrl(rawUrl, signal, timeoutMs = 4000) {
  if (!rawUrl) return '';

  // 사용자가 누르면 뒤에서 돌던 미리읽기 즉시 양보(중단)
  abortPrefetch();

  // 1) 이미 메모리에 활성화된 ObjectURL이 있으면 0ms 반환
  if (objectUrlPool.has(rawUrl)) {
    return rememberObjectUrl(rawUrl, objectUrlPool.get(rawUrl));
  }

  // 2) 브라우저 디스크 Cache Storage 확인 (송북 <-> TAC 공유)
  if ('caches' in window) {
    try {
      const cache = await caches.open(CACHE_NAME);
      const cachedRes = await cache.match(rawUrl);
      if (cachedRes) {
        const blob = await cachedRes.blob();
        return rememberObjectUrl(rawUrl, URL.createObjectURL(blob));
      }
    } catch {}
  }

  // 3) 네트워크에서 받아서 Cache Storage에 영구 저장 후 반환
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch(rawUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return rawUrl;

    if ('caches' in window) {
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(rawUrl, res.clone());
      } catch {}
    }

    const blob = await res.blob();
    return rememberObjectUrl(rawUrl, URL.createObjectURL(blob));
  } catch (err) {
    clearTimeout(timer);
    if (signal && signal.aborted) throw err;
    return rawUrl;
  }
}

// 2순위: 유휴 시간(Idle)에 1개씩만 조용히 디스크 캐시에 저장
export async function prefetchVocaUrlsSequentially(urls = []) {
  abortPrefetch();
  if (!('caches' in window) || urls.length === 0) return;

  const controller = new AbortController();
  prefetchController = controller;

  try {
    const cache = await caches.open(CACHE_NAME);
    for (const rawUrl of urls) {
      if (controller.signal.aborted) return;
      // 송북에서 노래가 재생 중이면 대역폭 보호를 위해 즉시 양보
      if (isSongPlayingChecker()) return;
      if (!rawUrl || objectUrlPool.has(rawUrl)) continue;

      const alreadyCached = await cache.match(rawUrl);
      if (alreadyCached) continue;

      const res = await fetch(rawUrl, { signal: controller.signal });
      if (res.ok) {
        await cache.put(rawUrl, res);
      }
    }
  } catch {}
}

export function abortPrefetch() {
  if (prefetchController) {
    prefetchController.abort();
    prefetchController = null;
  }
}