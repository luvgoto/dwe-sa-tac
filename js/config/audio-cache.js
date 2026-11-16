export function registerSongPlayingChecker() {}

// fetch / Cache Storage 블로킹 없이 원본 URL을 0ms 즉시 반환
export async function getPlayableVocaUrl(rawUrl) {
  return rawUrl || '';
}

export async function prefetchVocaUrlsSequentially() {}

export function abortPrefetch() {}