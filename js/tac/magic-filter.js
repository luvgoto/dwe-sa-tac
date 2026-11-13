let currentMagicImageData = null;

export function captureMagicImageData(imgElement, filterCanvas, filterCtx) {
  try {
    filterCanvas.width = imgElement.naturalWidth || imgElement.width || 630;
    filterCanvas.height = imgElement.naturalHeight || imgElement.height || 300;
    filterCtx.drawImage(imgElement, 0, 0);
    currentMagicImageData = filterCtx.getImageData(0, 0, filterCanvas.width, filterCanvas.height);
  } catch (e) {
    console.warn('Canvas 이미지 접근 제약:', e);
    currentMagicImageData = null;
  }
}

export function resetMagicFilterUI(imgElement, filterCanvas, magicControls, isMagic) {
  currentMagicImageData = null;
  filterCanvas.classList.add('hidden');
  imgElement.classList.remove('hidden');

  if (isMagic) {
    magicControls.classList.remove('hidden');
    updateMagicFilterButtonsUI('original');
  } else {
    magicControls.classList.add('hidden');
  }
}

export function applyMagicFilter(mode, imgElement, filterCanvas, filterCtx) {
  updateMagicFilterButtonsUI(mode);

  if (mode === 'original') {
    filterCanvas.classList.add('hidden');
    imgElement.classList.remove('hidden');
    return;
  }

  if (!currentMagicImageData) {
    if (imgElement.complete && imgElement.naturalWidth) {
      captureMagicImageData(imgElement, filterCanvas, filterCtx);
    }
    if (!currentMagicImageData) return;
  }

  imgElement.classList.add('hidden');
  filterCanvas.classList.remove('hidden');

  const output = filterCtx.createImageData(currentMagicImageData);
  const data = output.data;
  const orig = currentMagicImageData.data;
  const width = filterCanvas.width;
  const height = filterCanvas.height;

  const bottomCutoffY = height * 0.78;
  const numberCutoffX = width * 0.89;
  const numberCutoffY = height * 0.22;

  for (let i = 0; i < orig.length; i += 4) {
    const pixelIndex = i / 4;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);

    const r = orig[i];
    const g = orig[i + 1];
    const b = orig[i + 2];
    const a = orig[i + 3];

    if (x > numberCutoffX && y < numberCutoffY) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = a;
      continue;
    }

    if (y > bottomCutoffY) {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
      continue;
    }

    if (mode === 'red-only') {
      const rawDensity = Math.max(0, 255 - g);
      const greenExcess = Math.max(0, ((g + b) / 2) - r);
      const effectiveDensity = rawDensity - (greenExcess * 0.85);

      if (effectiveDensity < 22) {
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
      } else {
        const factor = Math.min(1, Math.pow((effectiveDensity - 20) / 85, 0.78));
        data[i] = Math.round(255 - (255 - 225) * factor);
        data[i + 1] = Math.round(255 - (255 - 35) * factor);
        data[i + 2] = Math.round(255 - (255 - 35) * factor);
      }
      data[i + 3] = a;
    } else if (mode === 'green-only') {
      const rawDensity = Math.max(0, 255 - r);
      const greenBias = (g + b) / 2 - r;
      const inkDensity = rawDensity + Math.max(-20, greenBias * 0.5);

      if (inkDensity < 22) {
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
      } else {
        const factor = Math.min(1, Math.pow((inkDensity - 20) / 85, 0.8));
        data[i] = Math.round(255 - (255 - 0) * factor);
        data[i + 1] = Math.round(255 - (255 - 130) * factor);
        data[i + 2] = Math.round(255 - (255 - 110) * factor);
      }
      data[i + 3] = a;
    }
  }

  filterCtx.putImageData(output, 0, 0);
}

function updateMagicFilterButtonsUI(mode) {
  const btnOrig = document.getElementById('btn-filter-orig');
  const btnRed = document.getElementById('btn-filter-red');
  const btnGreen = document.getElementById('btn-filter-green');

  btnOrig.className = `w-12 h-12 sm:w-14 sm:h-14 rounded-full font-black text-xs sm:text-sm tracking-tight transition shadow-lg flex items-center justify-center border-2 border-white/90 btn-jelly ${
    mode === 'original'
      ? 'bg-slate-900 text-white ring-3 ring-amber-300 scale-105'
      : 'bg-slate-700/80 hover:bg-slate-700 text-slate-100 opacity-90'
  }`;

  btnRed.className = `w-12 h-12 sm:w-14 sm:h-14 rounded-full font-black text-xs sm:text-sm tracking-tight transition shadow-lg flex items-center justify-center border-2 border-white/90 btn-jelly ${
    mode === 'red-only'
      ? 'bg-red-600 text-white ring-3 ring-amber-300 scale-105'
      : 'bg-red-700/80 hover:bg-red-600 text-red-100 opacity-90'
  }`;

  btnGreen.className = `w-12 h-12 sm:w-14 sm:h-14 rounded-full font-black text-xs sm:text-sm tracking-tight transition shadow-lg flex items-center justify-center border-2 border-white/90 btn-jelly ${
    mode === 'green-only'
      ? 'bg-emerald-600 text-white ring-3 ring-amber-300 scale-105'
      : 'bg-emerald-800/80 hover:bg-emerald-700 text-emerald-100 opacity-90'
  }`;
}
