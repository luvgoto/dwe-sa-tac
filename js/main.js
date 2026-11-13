import { initBookViewer, pauseBookAudio, goToPage, getCurrentPage, renderCurrentView, toggleFullscreen as toggleBookFs } from './book/pdf-viewer.js';
import { initTacPlayer, switchTacView, loadCustomCardList, stopAllTacPlayback } from './tac/card-player.js';

let activeAppMode = 'book'; // 'book' | 'tac'
let isFullscreenMode = false;

export function getActiveAppMode() {
  return activeAppMode;
}

export function switchToBook(targetPage = null) {
  stopAllTacPlayback();
  activeAppMode = 'book';

  document.getElementById('section-tac').classList.add('hidden');
  document.getElementById('section-book').classList.remove('hidden');

  document.getElementById('btn-switch-to-book').classList.add('hidden');
  document.getElementById('brand-tac').classList.add('hidden');
  document.getElementById('header-controls-tac').classList.add('hidden');

  document.getElementById('brand-book').classList.remove('hidden');
  document.getElementById('header-controls-book').classList.remove('hidden');

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

  document.getElementById('btn-switch-to-book').classList.remove('hidden');
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

  if (activeAppMode === 'book') {
    toggleBookFs(isFs);
  }
}

function toggleFullscreen(forceState) {
  const target = (typeof forceState === 'boolean') ? forceState : !isFullscreenMode;
  if (target) {
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => applyFullscreenUI(true));
    } else {
      applyFullscreenUI(true);
    }
  } else {
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => applyFullscreenUI(false));
    } else {
      applyFullscreenUI(false);
    }
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('btn-switch-to-book').addEventListener('click', () => switchToBook(getCurrentPage()));
  document.getElementById('btn-switch-to-tac').addEventListener('click', () => switchToTac());
  document.getElementById('brand-tac').addEventListener('click', () => switchTacView('card'));
  document.getElementById('btn-fullscreen').addEventListener('click', () => toggleFullscreen());
  document.getElementById('top-exit-hotspot').addEventListener('click', () => toggleFullscreen(false));
  document.getElementById('btn-floating-exit').addEventListener('click', () => toggleFullscreen(false));
  document.addEventListener('fullscreenchange', () => applyFullscreenUI(!!document.fullscreenElement));

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isFullscreenMode) {
      toggleFullscreen(false);
    }
  });

  const params = new URLSearchParams(window.location.search);
  const initialMode = params.get('mode');
  const cardsParam = params.get('cards');
  const cardParam = params.get('card');
  const pageParam = parseInt(params.get('fromPage') || params.get('page'), 10);

  initTacPlayer();
  await initBookViewer({
    initialPage: (!isNaN(pageParam) && pageParam >= 1) ? pageParam : 1,
    onOpenTacCards: (cards) => switchToTac({ cards, autoPlay: false })
  });

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
