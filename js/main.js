import { initBookViewer, pauseBookAudio, goToPage, getCurrentPage, renderCurrentView, toggleFullscreen as toggleBookFs } from './book/pdf-viewer.js';
import { disableSpotEditMode } from './book/spot-editor.js';
import { initTacPlayer, switchTacView, loadCustomCardList, stopAllTacPlayback } from './tac/card-player.js';

let activeAppMode = 'book'; // 'book' | 'tac'
let isFullscreenMode = false;
let isParentMode = false;

export function getActiveAppMode() {
  return activeAppMode;
}

export function getIsParentMode() {
  return isParentMode;
}

function setParentMode(enabled) {
  isParentMode = enabled;
  document.querySelectorAll('.parent-only-control').forEach(el => {
    el.classList.toggle('hidden', !enabled);
  });
  document.getElementById('btn-parent-lock').classList.toggle('hidden', !enabled);

  if (!enabled) {
    disableSpotEditMode();
    if (activeAppMode === 'tac') {
      switchTacView('card');
    }
  }
}

function bindParentSecretTap(element) {
  if (!element) return;
  let tapCount = 0;
  let tapTimer = null;

  element.addEventListener('click', (e) => {
    tapCount++;
    clearTimeout(tapTimer);

    if (tapCount >= 5) {
      tapCount = 0;
      e.stopPropagation();
      setParentMode(!isParentMode);
      return;
    }

    tapTimer = setTimeout(() => {
      tapCount = 0;
    }, 1500);
  });
}

export function switchToBook(targetPage = null) {
  stopAllTacPlayback();
  document.getElementById('btn-autoplay')?.classList.add('hidden');
  activeAppMode = 'book';

  document.getElementById('section-tac').classList.add('hidden');
  document.getElementById('section-book').classList.remove('hidden');
  document.getElementById('brand-tac').classList.add('hidden');
  document.getElementById('header-controls-tac').classList.add('hidden');

  document.getElementById('brand-book').classList.remove('hidden');
  document.getElementById('header-controls-book').classList.remove('hidden');

  toggleBookFs(isFullscreenMode);

  if (targetPage) {
    goToPage(targetPage);
  } else {
    renderCurrentView();
  }
}

export function switchToTac(options = {}) {
  pauseBookAudio();
  activeAppMode = 'tac';

  document.getElementById('section-book').classList.add('hidden');
  document.getElementById('section-tac').classList.remove('hidden');

  document.getElementById('brand-book').classList.add('hidden');
  document.getElementById('header-controls-book').classList.add('hidden');

  document.getElementById('brand-tac').classList.remove('hidden');
  document.getElementById('header-controls-tac').classList.remove('hidden');

  if (options.cards && options.cards.length > 0) {
    loadCustomCardList(options.cards, options.autoPlay || false);
  } else if (options.card) {
    loadCustomCardList([options.card], options.autoPlay || false, true);
  } else {
    switchTacView(options.subView || 'card');
  }
}

function applyFullscreenUI(isFs) {
  isFullscreenMode = isFs;
  document.getElementById('top-panel').classList.toggle('hidden', isFs);
  document.getElementById('top-exit-hotspot').classList.toggle('hidden', !isFs);
  document.getElementById('btn-floating-exit').classList.toggle('hidden', !isFs);
  document.getElementById('fs-icon').className = isFs ? 'fa-solid fa-compress' : 'fa-solid fa-expand';

  // 일반 모드에서는 상단 헤더(top-14) 아래, 전체화면에서는 우측 최상단(top-3)에 배치
  const floatingBox = document.getElementById('floating-top-controls');
  if (floatingBox) {
    floatingBox.classList.toggle('top-3', isFs);
    floatingBox.classList.toggle('top-14', !isFs);
  }

  if (activeAppMode === 'book') {
    toggleBookFs(isFs);
  }
}

function isMobileOrApp() {
  const isTouchMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && window.innerWidth <= 1024);
  const isStandaloneApp = window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches;
  return isTouchMobile || isStandaloneApp;
}

function toggleFullscreen(forceState) {
  const target = (typeof forceState === 'boolean') ? forceState : !isFullscreenMode;

  // 모바일 또는 설치된 앱(TWA/PWA)에서는 OS 경고창 방지를 위해 내부 UI만 전환
  if (isMobileOrApp()) {
    applyFullscreenUI(target);
    return;
  }

  // PC 일반 브라우저에서는 윈도우 작업표시줄까지 가리는 전체화면 API 실행
  if (target) {
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen()
        .then(() => applyFullscreenUI(true))
        .catch(() => applyFullscreenUI(true));
    } else {
      applyFullscreenUI(true);
    }
  } else {
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen()
        .then(() => applyFullscreenUI(false))
        .catch(() => applyFullscreenUI(false));
    } else {
      applyFullscreenUI(false);
    }
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  bindParentSecretTap(document.getElementById('brand-book'));
  bindParentSecretTap(document.getElementById('brand-tac'));
  document.getElementById('btn-parent-lock').addEventListener('click', () => setParentMode(false));

  document.getElementById('btn-switch-to-book').addEventListener('click', () => switchToBook(getCurrentPage()));
  document.getElementById('btn-switch-to-tac').addEventListener('click', () => switchToTac());
  document.getElementById('brand-tac').addEventListener('click', () => switchTacView('card'));
  document.getElementById('btn-fullscreen').addEventListener('click', () => toggleFullscreen());
  document.getElementById('top-exit-hotspot').addEventListener('click', () => toggleFullscreen(false));
  document.getElementById('btn-floating-exit').addEventListener('click', () => toggleFullscreen(false));
  document.addEventListener('fullscreenchange', () => {
    if (!isMobileOrApp()) {
      applyFullscreenUI(!!document.fullscreenElement);
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isFullscreenMode) {
      toggleFullscreen(false);
    }
  });

  initTacPlayer();
  await initBookViewer({
    initialPage: 1,
    onOpenTacCards: (cards) => switchToTac({ cards, autoPlay: false })
  });

  const params = new URLSearchParams(window.location.search);
  const initialMode = params.get('mode');
  const cardsParam = params.get('cards');
  const cardParam = params.get('card');
  const pageParam = parseInt(params.get('fromPage') || params.get('page'), 10);

  if (!isNaN(pageParam) && pageParam >= 1) {
    goToPage(pageParam);
  }

  if (initialMode === 'tac' || cardsParam || cardParam) {
    if (cardsParam) {
      switchToTac({ cards: cardsParam.split(',') });
    } else if (cardParam) {
      switchToTac({ card: cardParam });
    } else {
      switchToTac();
    }
  }
});