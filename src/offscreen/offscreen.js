const DEBUG = true;
const PREPROCESS_OPTIONS = {
  grayscale: true,
  contrast: 0.25,
  threshold: true
};
const WORKER_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

let warmWorker = null;
let warmWorkerPromise = null;
let workerIdleTimer = null;
const memoryCache = new Map();

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

function bufferToHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const value = bytes[i].toString(16).padStart(2, '0');
    hex += value;
  }
  return hex;
}

async function hashBlob(blob) {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return bufferToHex(digest);
}

async function getCachedResult(hash) {
  const key = `ocr:${hash}`;
  if (chrome?.storage?.local) {
    const data = await chrome.storage.local.get(key);
    return data[key] || null;
  }
  return memoryCache.get(key) || null;
}

async function setCachedResult(hash, entry) {
  const key = `ocr:${hash}`;
  if (chrome?.storage?.local) {
    await chrome.storage.local.set({ [key]: entry });
    return;
  }
  memoryCache.set(key, entry);
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

function clearWorkerIdleTimer() {
  if (workerIdleTimer) {
    clearTimeout(workerIdleTimer);
    workerIdleTimer = null;
  }
}

function scheduleWorkerTermination() {
  clearWorkerIdleTimer();
  workerIdleTimer = setTimeout(async () => {
    if (!warmWorker) {
      return;
    }
    debugLog('worker idle timeout, terminating');
    try {
      await warmWorker.terminate();
    } catch (error) {
      debugLog('worker terminate error', error.message);
    } finally {
      warmWorker = null;
    }
  }, WORKER_IDLE_TIMEOUT_MS);
}

async function getWarmWorker(tabId, requestId) {
  if (warmWorker) {
    return warmWorker;
  }
  if (warmWorkerPromise) {
    return warmWorkerPromise;
  }
  debugLog('creating warm worker');
  warmWorkerPromise = Tesseract.createWorker('eng+vie', 1, {
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

  try {
    warmWorker = await warmWorkerPromise;
    return warmWorker;
  } catch (error) {
    warmWorkerPromise = null;
    throw error;
  } finally {
    warmWorkerPromise = null;
  }
}

async function runOcrJob(job) {
  const { srcUrl, tabId, requestId } = job;
  debugLog('run job', { tabId, requestId, srcUrl });

  clearWorkerIdleTimer();
  try {
    sendProgress(tabId, requestId, 'hashing', 0);
    sendProgress(tabId, requestId, 'preprocessing', 0);
    const imageBlob = await fetchImageBlob(srcUrl);
    const imageHash = await hashBlob(imageBlob);
    sendProgress(tabId, requestId, 'hashing', 1);
    const cached = await getCachedResult(imageHash);
    if (cached && cached.text) {
      chrome.runtime.sendMessage({
        action: 'ocr-result',
        tabId,
        requestId,
        text: cached.text,
        cached: true
      });
      debugLog('cache hit', imageHash);
      scheduleWorkerTermination();
      return;
    }
    const processedBlob = await preprocessImage(imageBlob, PREPROCESS_OPTIONS);
    sendProgress(tabId, requestId, 'preprocessing', 1);

    const worker = await getWarmWorker(tabId, requestId);
    const { data: { text } } = await worker.recognize(processedBlob);
    await setCachedResult(imageHash, {
      text,
      srcUrl,
      createdAt: Date.now()
    });
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
    scheduleWorkerTermination();
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
