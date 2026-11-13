let ocrWorker = null;

export async function ensureOcrWorker() {
  if (ocrWorker) return ocrWorker;
  if (typeof window.Tesseract === 'undefined') return null;
  ocrWorker = await window.Tesseract.createWorker('eng');
  await ocrWorker.setParameters({
    tessedit_char_whitelist: '0123456789',
    tessedit_pageseg_mode: '7'
  });
  return ocrWorker;
}

export async function detectCardNumberFromCorner(pdfDoc, pageNum, centerXPercent, centerYPercent, rectW, rectH) {
  try {
    if (!pdfDoc) return '';
    const page = await pdfDoc.getPage(pageNum);
    const hiViewport = page.getViewport({ scale: 3.5 });
    const hiCanvas = document.createElement('canvas');
    hiCanvas.width = Math.floor(hiViewport.width);
    hiCanvas.height = Math.floor(hiViewport.height);
    const hiCtx = hiCanvas.getContext('2d');
    await page.render({ canvasContext: hiCtx, viewport: hiViewport }).promise;

    const cardCenterX = (centerXPercent / 100) * hiCanvas.width;
    const cardCenterY = (centerYPercent / 100) * hiCanvas.height;
    const cardWidthPx = (rectW / 100) * hiCanvas.width;
    const cardHeightPx = (rectH / 100) * hiCanvas.width;

    const cardRightX = cardCenterX + (cardWidthPx / 2);
    const cardTopY = cardCenterY - (cardHeightPx / 2);

    const badgeBoxPx = Math.round(hiCanvas.width * 0.036);
    const marginRightPx = Math.round(hiCanvas.width * 0.002);
    const marginTopPx = Math.round(hiCanvas.width * 0.002);

    const sx = Math.max(0, Math.round(cardRightX - badgeBoxPx - marginRightPx));
    const sy = Math.max(0, Math.round(cardTopY + marginTopPx));
    const sw = Math.min(hiCanvas.width - sx, badgeBoxPx);
    const sh = Math.min(hiCanvas.height - sy, badgeBoxPx);

    const previewCanvas = document.getElementById('ocr-preview-canvas');
    if (previewCanvas) {
      previewCanvas.classList.remove('hidden');
      const pCtx = previewCanvas.getContext('2d');
      pCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
      pCtx.drawImage(hiCanvas, sx, sy, sw, sh, 0, 0, previewCanvas.width, previewCanvas.height);
    }

    const worker = await ensureOcrWorker();
    if (!worker) return '';

    const scale = 4;
    const pad = 24;
    const procCanvas = document.createElement('canvas');
    procCanvas.width = Math.round(sw * scale) + pad * 2;
    procCanvas.height = Math.round(sh * scale) + pad * 2;
    const ctx = procCanvas.getContext('2d');

    const thresholds = [165, 140, 190];
    for (const thresh of thresholds) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, procCanvas.width, procCanvas.height);
      ctx.drawImage(hiCanvas, sx, sy, sw, sh, pad, pad, Math.round(sw * scale), Math.round(sh * scale));

      const imgData = ctx.getImageData(pad, pad, Math.round(sw * scale), Math.round(sh * scale));
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const isWhiteDigit = (r > thresh && g > thresh && b > thresh);
        const val = isWhiteDigit ? 0 : 255;
        d[i] = d[i + 1] = d[i + 2] = val;
      }
      ctx.putImageData(imgData, pad, pad);

      const { data: { text } } = await worker.recognize(procCanvas);
      const digits = (text || '').replace(/\D/g, '');
      if (digits) {
        const num = parseInt(digits, 10);
        if (num >= 1 && num <= 510) {
          return `v${String(num).padStart(3, '0')}`;
        }
      }
    }
    return '';
  } catch (e) {
    console.warn('카드 번호 OCR 실패:', e);
    return '';
  }
}
