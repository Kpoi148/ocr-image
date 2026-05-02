(() => {
  if (globalThis.OcrActions) {
    return;
  }

  globalThis.OcrActions = Object.freeze({
    CONTENT_READY: 'content-ready',
    GET_LAST_IMAGE: 'get-last-image',
    OCR_ERROR: 'ocr-error',
    OCR_IMAGE: 'ocr-image',
    OCR_OFFSCREEN: 'ocr-offscreen',
    OCR_PROGRESS: 'ocr-progress',
    OCR_RESULT: 'ocr-result',
    OCR_RUN: 'ocr-run'
  });
})();
