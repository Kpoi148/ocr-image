const DEBUG = true;
const PREPROCESS_OPTIONS = {
  grayscale: true,
  contrast: 0.25,
  threshold: true
};

function debugLog(...args) {
  if (DEBUG) {
    console.log('[OCR OFFSCREEN]', ...args);
  }
}

async function fetchImageBlob(url) {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Khong the tai anh (${response.status})`);
  }
  return await response.blob();
}

function clampByte(value) {
  if (value < 0) return 0;
  if (value > 255) return 255;
  return value;
}

function computeOtsuThreshold(histogram, total) {
  let sum = 0;
  for (let i = 0; i < 256; i += 1) {
    sum += i * histogram[i];
  }

  let sumB = 0;
  let wB = 0;
  let max = 0;
  let threshold = 128;

  for (let i = 0; i < 256; i += 1) {
    wB += histogram[i];
    if (wB === 0) {
      continue;
    }
    const wF = total - wB;
    if (wF === 0) {
      break;
    }
    sumB += i * histogram[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > max) {
      max = between;
      threshold = i;
    }
  }

  return threshold;
}

async function preprocessImage(blob, options) {
  const bitmap = await createImageBitmap(blob);
  const width = bitmap.width;
  const height = bitmap.height;
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height)
    : document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  if (typeof bitmap.close === 'function') {
    bitmap.close();
  }

  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;
  const totalPixels = width * height;

  const histogram = options.threshold ? new Uint32Array(256) : null;
  const contrastFactor = options.contrast ? (1 + options.contrast) : 1;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    let gray = options.grayscale ? (0.299 * r + 0.587 * g + 0.114 * b) : r;
    if (options.contrast) {
      gray = 128 + (gray - 128) * contrastFactor;
    }
    gray = clampByte(gray) | 0;
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
    data[i + 3] = 255;
    if (histogram) {
      histogram[gray] += 1;
    }
  }

  if (histogram) {
    const threshold = computeOtsuThreshold(histogram, totalPixels);
    for (let i = 0; i < data.length; i += 4) {
      const value = data[i] > threshold ? 255 : 0;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
    }
  }

  context.putImageData(imageData, 0, 0);

  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type: 'image/png' });
  }
  return new Promise(resolve => {
    canvas.toBlob(resolved => resolve(resolved), 'image/png');
  });
}

function sendProgress(tabId, requestId, status, progress) {
  chrome.runtime.sendMessage({
    action: 'ocr-progress',
    tabId,
    requestId,
    status,
    progress
  });
}

async function runOcrJob(job) {
  const { srcUrl, tabId, requestId } = job;
  debugLog('run job', { tabId, requestId, srcUrl });

  let worker;
  try {
    sendProgress(tabId, requestId, 'preprocessing', 0);
    const imageBlob = await fetchImageBlob(srcUrl);
    const processedBlob = await preprocessImage(imageBlob, PREPROCESS_OPTIONS);
    sendProgress(tabId, requestId, 'preprocessing', 1);

    worker = await Tesseract.createWorker('eng+vie', 1, {
      logger: message => {
        if (message && (message.status || typeof message.progress === 'number')) {
          sendProgress(
            tabId,
            requestId,
            message.status || '',
            typeof message.progress === 'number' ? message.progress : null
          );
        }
      },
      workerPath: chrome.runtime.getURL('assets/tesseractjs/worker.min.js'),
      corePath: chrome.runtime.getURL('assets/tesseractjs/tesseract-core.wasm.js'),
      langPath: chrome.runtime.getURL('assets/tesseractjs/lang-data'),
      workerBlobURL: false
    });
    const { data: { text } } = await worker.recognize(processedBlob);
    chrome.runtime.sendMessage({
      action: 'ocr-result',
      tabId,
      requestId,
      text
    });
    debugLog('job done', { tabId, requestId });
  } catch (error) {
    chrome.runtime.sendMessage({
      action: 'ocr-error',
      tabId,
      requestId,
      error: error.message
    });
    debugLog('job error', error.message);
  } finally {
    if (worker) {
      await worker.terminate();
    }
  }
}

const queue = [];
let isRunning = false;

async function processQueue() {
  if (isRunning || queue.length === 0) {
    return;
  }
  isRunning = true;
  const job = queue.shift();
  await runOcrJob(job);
  isRunning = false;
  processQueue();
}

chrome.runtime.onMessage.addListener(message => {
  if (!message || message.action !== 'ocr-run' || !message.srcUrl) {
    return;
  }
  queue.push({
    srcUrl: message.srcUrl,
    tabId: message.tabId,
    requestId: message.requestId
  });
  processQueue();
});
