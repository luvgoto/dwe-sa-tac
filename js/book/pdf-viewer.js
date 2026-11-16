// 스와이프 + 페이지 좌우 끝(15%) 탭으로 페이지 넘김
  let touchStartX = 0;
  let touchStartY = 0;
  let lastTouchTime = 0;
  const viewerEl = document.getElementById('viewer-container');

  viewerEl.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].clientX;
    touchStartY = e.changedTouches[0].clientY;
  }, { passive: true });

  viewerEl.addEventListener('touchend', e => {
    lastTouchTime = Date.now();
    if (isEditModeActive()) return;
    if (e.target.closest('.song-spot, .link-layer a')) return;

    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const diffX = endX - touchStartX;
    const diffY = endY - touchStartY;

    // 1. 가로 스와이프
    if (Math.abs(diffX) > 55 && Math.abs(diffX) > Math.abs(diffY)) {
      if (diffX < 0) nextPage();
      else prevPage();
      return;
    }

    // 2. 제자리 짧은 탭 -> 화면 좌측 15% 또는 우측 15% 영역 터치 시 페이지 이동
    if (Math.abs(diffX) < 12 && Math.abs(diffY) < 12) {
      const rect = viewerEl.getBoundingClientRect();
      const ratioX = (endX - rect.left) / rect.width;
      if (ratioX <= 0.15) {
        prevPage();
      } else if (ratioX >= 0.85) {
        nextPage();
      }
    }
  }, { passive: true });

  // 데스크톱 마우스 클릭: 화면 좌/우 끝 15% 영역 클릭으로 페이지 넘김
  viewerEl.addEventListener('click', e => {
    // 터치 직후 발생하는 합성 click 이벤트만 무시 (PC 마우스는 정상 통과)
    if (Date.now() - lastTouchTime < 500) return;
    if (isEditModeActive()) return;
    if (e.target.closest('.song-spot, .link-layer a')) return;

    const rect = viewerEl.getBoundingClientRect();
    const ratioX = (e.clientX - rect.left) / rect.width;
    if (ratioX <= 0.15) {
      prevPage();
    } else if (ratioX >= 0.85) {
      nextPage();
    }
  });