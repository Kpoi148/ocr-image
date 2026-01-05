const OCR_MENU_ID = 'ocr-image';
const DEBUG = true;
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
  await offscreenCreating;
  offscreenCreating = null;
  debugLog('offscreen document ready');
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
      try {
        const tabId = _sender.tab?.id;
        if (!tabId) {
          sendResponse({ ok: false, error: 'Missing tabId' });
          return;
        }
        await ensureOffscreenDocument();
        debugLog('forward ocr-run to offscreen', {
          tabId,
          requestId: message.requestId
        });
        chrome.runtime.sendMessage({
          action: 'ocr-run',
          tabId,
          srcUrl: message.srcUrl,
          requestId: message.requestId
        });
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }
  if (message && (message.action === 'ocr-result' || message.action === 'ocr-error' || message.action === 'ocr-progress')) {
    if (!message.tabId) {
      return;
    }
    debugLog('forward result to tab', {
      action: message.action,
      tabId: message.tabId,
      requestId: message.requestId
    });
    chrome.tabs.sendMessage(message.tabId, message, { frameId: 0 });
    return;
  }
  if (!message || message.action !== 'fetch-image' || !message.url) {
    return;
  }

  (async () => {
    try {
      debugLog('fetch-image request', message.url);
      const response = await fetch(message.url, { credentials: 'include' });
      if (!response.ok) {
        throw new Error(`Khong the tai anh (${response.status})`);
      }
      const buffer = await response.arrayBuffer();
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      sendResponse({ ok: true, buffer, contentType });
      debugLog('fetch-image success', { contentType, bytes: buffer.byteLength });
    } catch (error) {
      debugLog('fetch-image error', error.message);
      sendResponse({ ok: false, error: error.message });
    }
  })();

  return true;
});
