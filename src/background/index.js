importScripts('../shared/image-store.js', '../shared/ocr-state.js');

const OCR_MENU_ID = 'ocr-image';
const DEBUG = false;
let offscreenCreating = null;

function debugLog(...args) {
  if (DEBUG) {
    console.log('[OCR BG]', ...args);
  }
}

async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) {
    return;
  }
  if (offscreenCreating) {
    await offscreenCreating;
    return;
  }
  debugLog('creating offscreen document');
  offscreenCreating = chrome.offscreen.createDocument({
    url: 'src/offscreen/offscreen.html',
    reasons: ['DOM_PARSER'],
    justification: 'Run OCR with Tesseract in extension context.'
  });
  try {
    await offscreenCreating;
    debugLog('offscreen document ready');
  } finally {
    offscreenCreating = null;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  debugLog('onInstalled');
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: OCR_MENU_ID,
      title: 'OCR: Trich xuat text tu anh',
      contexts: ['image']
    });
    debugLog('context menu created');
  });
});

function startOcrInTab(tabId, srcUrl) {
  const message = { action: 'ocr-image', srcUrl };
  chrome.tabs.sendMessage(tabId, message, { frameId: 0 }, async () => {
    if (!chrome.runtime.lastError) {
      debugLog('message delivered to frame 0');
      return;
    }
    debugLog('sendMessage failed, injecting content script', chrome.runtime.lastError.message);
    const target = { tabId, frameIds: [0] };
    await chrome.scripting.executeScript({
      target,
      files: ['src/content/content-ocr.js']
    });
    debugLog('content script injected, retrying message');
    chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
  });
}

async function cleanupTemporaryImage(imageStoreId) {
  if (!imageStoreId) {
    return;
  }

  try {
    await OcrImageStore.remove(imageStoreId);
  } catch (error) {
    debugLog('temporary image cleanup failed', error.message);
  }
}

async function savePopupRequestStart(message) {
  try {
    await OcrPopupState.set({
      requestId: message.requestId,
      status: 'running',
      statusText: 'Đang gửi yêu cầu...',
      progress: 0,
      text: '',
      error: '',
      cached: false,
      source: message.imageStoreId ? 'popup-upload' : 'popup-url'
    });
  } catch (error) {
    debugLog('popup state start save failed', error.message);
  }
}

async function savePopupRequestFailure(requestId, errorMessage) {
  try {
    await OcrPopupState.update({
      requestId,
      status: 'error',
      statusText: 'Thất bại',
      progress: 0,
      error: errorMessage,
      cached: false
    });
  } catch (error) {
    debugLog('popup state failure save failed', error.message);
  }
}

async function savePopupOcrMessage(message) {
  try {
    const current = await OcrPopupState.get();
    if (current?.requestId && current.requestId !== message.requestId) {
      return;
    }

    if (message.action === 'ocr-progress') {
      if (current?.status === 'done' || current?.status === 'error') {
        return;
      }

      await OcrPopupState.update({
        requestId: message.requestId,
        status: 'running',
        statusText: message.status || current?.statusText || 'Đang xử lý...',
        progress: typeof message.progress === 'number' ? message.progress : current?.progress || 0,
        error: ''
      });
      return;
    }

    if (message.action === 'ocr-result') {
      await OcrPopupState.set({
        requestId: message.requestId,
        status: 'done',
        statusText: message.cached ? 'Hoàn thành (Cache)' : 'Hoàn thành',
        progress: 1,
        text: message.text || '',
        error: '',
        cached: Boolean(message.cached)
      });
      return;
    }

    if (message.action === 'ocr-error') {
      await OcrPopupState.set({
        requestId: message.requestId,
        status: 'error',
        statusText: 'Thất bại',
        progress: 0,
        text: '',
        error: message.error || 'Unknown error',
        cached: false
      });
    }
  } catch (error) {
    debugLog('popup state message save failed', error.message);
  }
}

chrome.contextMenus.onClicked.addListener(info => {
  debugLog('context menu clicked', {
    menuItemId: info.menuItemId,
    tabId: info.tabId,
    frameId: info.frameId,
    srcUrl: info.srcUrl,
    pageUrl: info.pageUrl
  });
  debugLog('context menu fields', info.menuItemId, info.tabId, info.srcUrl, info.pageUrl);

  if (info.menuItemId !== OCR_MENU_ID) {
    debugLog('context menu ignored', 'wrong menu id');
    return;
  }

  (async () => {
    try {
      let tabId = info.tabId;
      if (!tabId) {
        debugLog('tabId missing, fallback to active tab');
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = tabs[0]?.id;
      }
      if (!tabId) {
        debugLog('no active tab found, abort');
        return;
      }

      if (info.srcUrl) {
        startOcrInTab(tabId, info.srcUrl);
        return;
      }

      debugLog('srcUrl missing, asking content script');
      chrome.tabs.sendMessage(
        tabId,
        { action: 'get-last-image' },
        { frameId: 0 },
        response => {
          if (chrome.runtime.lastError) {
            debugLog('get-last-image failed', chrome.runtime.lastError.message);
            return;
          }
          if (!response?.srcUrl) {
            debugLog('get-last-image empty response');
            return;
          }
          debugLog('get-last-image success', response.srcUrl);
          startOcrInTab(tabId, response.srcUrl);
        }
      );
    } catch (error) {
      console.error('Khong the OCR tren trang hien tai:', error);
    }
  })();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.action === 'content-ready') {
    debugLog('content-ready', message.url);
    sendResponse({ ok: true });
    return;
  }
  if (message && message.action === 'ocr-offscreen') {
    (async () => {
      const tabId = _sender.tab?.id || null; // Allow null (e.g. from popup)
      const isPopupRequest = !tabId;
      try {
        if (isPopupRequest) {
          await savePopupRequestStart(message);
        }
        await ensureOffscreenDocument();
        debugLog('forward ocr-run to offscreen', {
          tabId,
          requestId: message.requestId,
          source: tabId ? 'content' : 'popup'
        });
        if (isPopupRequest) {
          await OcrPopupState.update({
            requestId: message.requestId,
            status: 'running',
            statusText: 'Đang xử lý background...',
            progress: 0.1
          });
        }
        chrome.runtime.sendMessage({
          action: 'ocr-run',
          tabId,
          srcUrl: message.srcUrl,
          imageStoreId: message.imageStoreId,
          requestId: message.requestId
        });
        sendResponse({ ok: true });
      } catch (error) {
        if (isPopupRequest) {
          await cleanupTemporaryImage(message.imageStoreId);
          await savePopupRequestFailure(message.requestId, error.message);
        }
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }
  if (message && (message.action === 'ocr-result' || message.action === 'ocr-error' || message.action === 'ocr-progress')) {
    (async () => {
      // If request came from a tab, forward result back to that tab
      if (message.tabId !== null && message.tabId !== undefined) {
        debugLog('forward result to tab', {
          action: message.action,
          tabId: message.tabId,
          requestId: message.requestId
        });
        chrome.tabs.sendMessage(message.tabId, message, { frameId: 0 });
      } else {
        debugLog('persist result (popup)', {
          action: message.action,
          requestId: message.requestId
        });
        await savePopupOcrMessage(message);
      }
      sendResponse({ ok: true });
    })();
    return true;
  }
});
