const DEBUG = true;

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

async function runOcrJob(job) {
  const { srcUrl, tabId, requestId } = job;
  debugLog('run job', { tabId, requestId, srcUrl });

  let worker;
  try {
    const imageBlob = await fetchImageBlob(srcUrl);
    worker = await Tesseract.createWorker('eng+vie', 1, {
      logger: message => {
        if (message && (message.status || typeof message.progress === 'number')) {
          chrome.runtime.sendMessage({
            action: 'ocr-progress',
            tabId,
            requestId,
            status: message.status || '',
            progress: typeof message.progress === 'number' ? message.progress : null
          });
        }
      },
      workerPath: chrome.runtime.getURL('assets/tesseractjs/worker.min.js'),
      corePath: chrome.runtime.getURL('assets/tesseractjs/tesseract-core.wasm.js'),
      langPath: chrome.runtime.getURL('assets/tesseractjs/lang-data'),
      workerBlobURL: false
    });
    const { data: { text } } = await worker.recognize(imageBlob);
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
