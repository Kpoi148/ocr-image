(() => {
  if (window.__ocrContentScriptReady) {
    return;
  }
  window.__ocrContentScriptReady = true;
  document.documentElement.setAttribute('data-ocr-ready', 'true');

  const DEBUG = true;
  const debugLog = (...args) => {
    if (DEBUG) {
      console.log('[OCR]', ...args);
    }
  };

  const OVERLAY_ID = 'ocr-extension-overlay';
  const STYLE_ID = 'ocr-extension-style';

  debugLog('content script loaded', { url: window.location.href });
  chrome.runtime.sendMessage({ action: 'content-ready', url: window.location.href }, response => {
    if (chrome.runtime.lastError) {
      debugLog('content-ready send failed', chrome.runtime.lastError.message);
      return;
    }
    debugLog('content-ready ack', response);
  });

  function getImageUrlFromElement(element) {
    if (!element) {
      return null;
    }
    const imgElement = element.tagName === 'IMG' ? element : element.closest('img');
    if (imgElement) {
      return imgElement.currentSrc || imgElement.src || null;
    }
    const styles = window.getComputedStyle(element);
    const background = styles ? styles.backgroundImage : null;
    if (background && background !== 'none') {
      const match = background.match(/url\\(["']?(.+?)["']?\\)/);
      return match ? match[1] : null;
    }
    return null;
  }

  let lastRightClickSrc = null;

  document.addEventListener('contextmenu', event => {
    const target = event.target;
    const url = getImageUrlFromElement(target);
    if (url) {
      lastRightClickSrc = url;
      debugLog('right click image', url);
    } else {
      debugLog('right click non-image');
    }
  });

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${OVERLAY_ID} {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        font-family: Arial, sans-serif;
      }
      #${OVERLAY_ID} .ocr-extension-panel {
        width: 360px;
        max-width: calc(100vw - 32px);
        background: #ffffff;
        color: #111111;
        border-radius: 10px;
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.2);
        border: 1px solid #e5e5e5;
        overflow: hidden;
      }
      #${OVERLAY_ID} .ocr-extension-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        background: #f4f4f4;
        border-bottom: 1px solid #e0e0e0;
      }
      #${OVERLAY_ID} .ocr-extension-title {
        font-size: 14px;
        font-weight: 700;
      }
      #${OVERLAY_ID} .ocr-extension-actions {
        display: flex;
        gap: 8px;
      }
      #${OVERLAY_ID} .ocr-extension-button {
        border: 1px solid #cccccc;
        background: #ffffff;
        color: #111111;
        border-radius: 6px;
        padding: 4px 8px;
        cursor: pointer;
        font-size: 12px;
      }
      #${OVERLAY_ID} .ocr-extension-button:hover {
        background: #f0f0f0;
      }
      #${OVERLAY_ID} .ocr-extension-body {
        padding: 10px 12px 12px;
      }
      #${OVERLAY_ID} .ocr-extension-status {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 12px;
        color: #444444;
        margin-bottom: 8px;
      }
      #${OVERLAY_ID} progress {
        width: 100%;
        height: 10px;
      }
      #${OVERLAY_ID} textarea {
        width: 100%;
        min-height: 160px;
        resize: vertical;
        border: 1px solid #cccccc;
        border-radius: 6px;
        padding: 8px;
        font-size: 12px;
        line-height: 1.4;
        color: #111111;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureOverlay() {
    ensureStyle();
    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      debugLog('create overlay');
      overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.innerHTML = `
        <div class="ocr-extension-panel">
          <div class="ocr-extension-header">
            <div class="ocr-extension-title">OCR Text</div>
            <div class="ocr-extension-actions">
              <button class="ocr-extension-button" id="ocr-extension-copy">Copy</button>
              <button class="ocr-extension-button" id="ocr-extension-close">Dong</button>
            </div>
          </div>
          <div class="ocr-extension-body">
            <div class="ocr-extension-status">
              <span id="ocr-extension-status-text">San sang</span>
            </div>
            <progress id="ocr-extension-progress" max="1" value="0"></progress>
            <textarea id="ocr-extension-result" readonly></textarea>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const closeButton = overlay.querySelector('#ocr-extension-close');
      closeButton.addEventListener('click', () => {
        debugLog('overlay closed');
        overlay.remove();
      });

      const copyButton = overlay.querySelector('#ocr-extension-copy');
      copyButton.addEventListener('click', async () => {
        const resultText = overlay.querySelector('#ocr-extension-result').value || '';
        try {
          await navigator.clipboard.writeText(resultText);
          overlay.querySelector('#ocr-extension-status-text').textContent = 'Da copy ket qua';
          debugLog('copy success');
        } catch (error) {
          console.error('Copy that bai:', error);
          overlay.querySelector('#ocr-extension-status-text').textContent = 'Copy that bai';
          debugLog('copy error', error.message);
        }
      });
    }

    return {
      overlay,
      statusText: overlay.querySelector('#ocr-extension-status-text'),
      progressBar: overlay.querySelector('#ocr-extension-progress'),
      resultText: overlay.querySelector('#ocr-extension-result')
    };
  }

  function showOverlayForDebug() {
    const ui = ensureOverlay();
    ui.overlay.style.display = 'block';
    ui.statusText.textContent = 'Overlay debug: san sang';
    ui.resultText.value = '';
  }

  function updateProgress(message, ui) {
    if (message && typeof message.progress === 'number') {
      ui.progressBar.value = message.progress;
    }
    if (message && message.status) {
      ui.statusText.textContent = message.status;
    }
    if (message && (message.status || typeof message.progress === 'number')) {
      debugLog('progress', message);
    }
  }

  let isRunning = false;
  let activeRequestId = null;

  async function runOcrForImage(srcUrl) {
    debugLog('run OCR for image', srcUrl);
    const ui = ensureOverlay();
    ui.overlay.style.display = 'block';
    ui.progressBar.value = 0;
    ui.statusText.textContent = 'Dang gui yeu cau OCR...';
    ui.resultText.value = '';

    if (isRunning) {
      ui.statusText.textContent = 'OCR dang chay, vui long doi...';
      debugLog('OCR already running');
      return;
    }
    isRunning = true;

    activeRequestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    chrome.runtime.sendMessage(
      { action: 'ocr-offscreen', srcUrl, requestId: activeRequestId },
      response => {
        if (chrome.runtime.lastError) {
          ui.statusText.textContent = 'Loi: khong the gui OCR';
          ui.resultText.value = chrome.runtime.lastError.message;
          debugLog('send OCR error', chrome.runtime.lastError.message);
          isRunning = false;
          return;
        }
        if (!response?.ok) {
          ui.statusText.textContent = 'Loi OCR';
          ui.resultText.value = response?.error || 'Khong the khoi tao OCR';
          debugLog('OCR start failed', response?.error);
          isRunning = false;
          return;
        }
        ui.statusText.textContent = 'Dang xu ly OCR...';
        debugLog('OCR request accepted', activeRequestId);
      }
    );
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.action === 'get-last-image') {
      debugLog('get-last-image request', lastRightClickSrc);
      sendResponse({ srcUrl: lastRightClickSrc });
      return;
    }
    if (message && message.action === 'ocr-progress' && message.requestId === activeRequestId) {
      const ui = ensureOverlay();
      updateProgress({ status: message.status, progress: message.progress }, ui);
      return;
    }
    if (message && message.action === 'ocr-result' && message.requestId === activeRequestId) {
      const ui = ensureOverlay();
      ui.statusText.textContent = 'Hoan thanh';
      ui.resultText.value = message.text || '';
      isRunning = false;
      activeRequestId = null;
      debugLog('OCR result received');
      return;
    }
    if (message && message.action === 'ocr-error' && message.requestId === activeRequestId) {
      const ui = ensureOverlay();
      ui.statusText.textContent = 'Loi OCR';
      ui.resultText.value = message.error || 'Co loi xay ra';
      isRunning = false;
      activeRequestId = null;
      debugLog('OCR error received', message.error);
      return;
    }
    if (!message || message.action !== 'ocr-image' || !message.srcUrl) {
      return;
    }
    debugLog('message received', message);
    runOcrForImage(message.srcUrl);
  });

  window.__ocrDebug = {
    show: () => showOverlayForDebug(),
    run: url => runOcrForImage(url),
    ping: () => 'ok'
  };
})();
