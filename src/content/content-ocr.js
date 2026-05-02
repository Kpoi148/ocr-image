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

  const HOST_ID = 'ocr-extension-host';

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
    // Walk up DOM to find image if clicked on wrapper
    const url = getImageUrlFromElement(target);
    if (url) {
      lastRightClickSrc = url;
      debugLog('right click image', url);
    } else {
      debugLog('right click non-image');
    }
  });

  // --- UI Logic with Shadow DOM ---

  function createShadowStyles() {
    return `
      :host {
        all: initial;
        z-index: 2147483647;
      }
      .ocr-overlay {
        position: fixed;
        right: 20px;
        bottom: 20px;
        width: 380px;
        max-width: calc(100vw - 40px);
        background: #ffffff;
        color: #0f172a;
        border-radius: 12px;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
        font-family: 'Inter', system-ui, -apple-system, sans-serif;
        border: 1px solid #e2e8f0;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes slideIn {
        from { transform: translateY(20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      .ocr-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        background: #f8fafc;
        border-bottom: 1px solid #e2e8f0;
      }
      .ocr-title {
        font-size: 14px;
        font-weight: 600;
        color: #0f172a;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .ocr-actions {
        display: flex;
        gap: 8px;
      }
      .ocr-btn {
        border: 1px solid #cbd5e1;
        background: #ffffff;
        color: #475569;
        border-radius: 6px;
        width: 28px;
        height: 28px;
        padding: 0;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }
      .ocr-btn:hover {
        background: #f1f5f9;
        color: #0f172a;
        border-color: #94a3b8;
      }
      .ocr-btn svg {
        width: 16px;
        height: 16px;
      }
      .ocr-btn--copy:hover {
        color: #10b981;
        border-color: #10b981;
        background: #ecfdf5;
      }
      .ocr-btn--close:hover {
        color: #ef4444;
        border-color: #ef4444;
        background: #fef2f2;
      }
      .ocr-body {
        padding: 16px;
      }
      .ocr-status {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
        font-size: 12px;
        font-weight: 500;
        color: #64748b;
      }
      .ocr-progress-track {
        height: 4px;
        background: #f1f5f9;
        border-radius: 99px;
        overflow: hidden;
        margin-bottom: 12px;
      }
      .ocr-progress-bar {
        height: 100%;
        background: #6366f1;
        border-radius: 99px;
        width: 0%;
        transition: width 0.3s ease;
      }
      .ocr-result {
        width: 100%;
        min-height: 120px;
        padding: 8px;
        font-size: 13px;
        line-height: 1.5;
        color: #334155;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        resize: vertical;
        box-sizing: border-box;
      }
      .ocr-result:focus {
        outline: none;
        border-color: #6366f1;
        background: #ffffff;
      }
    `;
  }

  function ensureOverlay() {
    let host = document.getElementById(HOST_ID);
    let shadow = null;

    if (!host) {
      host = document.createElement('div');
      host.id = HOST_ID;
      // High Z-index for host wrapper itself to sit on top
      host.style.position = 'fixed';
      host.style.zIndex = '2147483647';
      host.style.bottom = '0';
      host.style.right = '0';
      // Pointer events none to let clicks pass through empty areas? 
      // Actually we position the overlay inside fixed.
      // Let's make host 0x0 fixed.
      host.style.width = '0';
      host.style.height = '0';

      document.body.appendChild(host);
      shadow = host.attachShadow({ mode: 'open' });

      const style = document.createElement('style');
      style.textContent = createShadowStyles();
      shadow.appendChild(style);

      const overlay = document.createElement('div');
      overlay.className = 'ocr-overlay';
      overlay.innerHTML = `
        <div class="ocr-header">
          <div class="ocr-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 7V5C3 3.89543 3.89543 3 5 3H7M17 3H19C20.1046 3 21 3.89543 21 5V7M21 17V19C21 20.1046 20.1046 21 19 21H17M7 21H5C3.89543 21 3 20.1046 3 19V17M10 9H14M12 9V15M9 15H15"></path>
            </svg>
            OCR Result
          </div>
          <div class="ocr-actions">
            <button class="ocr-btn ocr-btn--copy" id="btn-copy" title="Copy">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
            <button class="ocr-btn ocr-btn--close" id="btn-close" title="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
        <div class="ocr-body">
          <div class="ocr-status">
            <span id="status-text">Đang khởi tạo...</span>
            <span id="percent-text">0%</span>
          </div>
          <div class="ocr-progress-track">
            <div id="progress-bar" class="ocr-progress-bar"></div>
          </div>
          <textarea id="result-text" class="ocr-result" readonly placeholder="Waiting for text..."></textarea>
        </div>
      `;
      shadow.appendChild(overlay);

      // Event Listeners
      const closeBtn = shadow.getElementById('btn-close');
      closeBtn.addEventListener('click', () => {
        host.remove(); // Safest way to clear state
      });

      const copyBtn = shadow.getElementById('btn-copy');
      const resultText = shadow.getElementById('result-text');

      copyBtn.addEventListener('click', async () => {
        if (!resultText.value) return;
        try {
          // Copy from Shadow DOM needs careful handling on some browsers, but Clipboard API is standard
          await navigator.clipboard.writeText(resultText.value);
          const statusText = shadow.getElementById('status-text');
          const original = statusText.textContent;
          statusText.textContent = 'Đã Copy!';
          statusText.style.color = '#10b981';
          setTimeout(() => {
            statusText.textContent = original;
            statusText.style.color = '';
          }, 2000);
        } catch (err) {
          console.error('Copy failed', err);
        }
      });
    } else {
      shadow = host.shadowRoot;
    }

    return {
      host,
      shadow,
      overlay: shadow.querySelector('.ocr-overlay'),
      statusText: shadow.getElementById('status-text'),
      percentText: shadow.getElementById('percent-text'),
      progressBar: shadow.getElementById('progress-bar'),
      resultText: shadow.getElementById('result-text')
    };
  }

  function updateProgress(message, ui) {
    if (message && typeof message.progress === 'number') {
      const p = Math.round(message.progress * 100);
      ui.progressBar.style.width = `${p}%`;
      ui.percentText.textContent = `${p}%`;
    }
    if (message && message.status) {
      ui.statusText.textContent = message.status;
    }
  }

  let isRunning = false;
  let activeRequestId = null;

  async function runOcrForImage(srcUrl) {
    debugLog('run OCR for image', srcUrl);

    // Always recreate or reset
    // If we want to support multiple overlays, we'd need ID management. 
    // For now, single overlay singleton is safer.

    const ui = ensureOverlay();
    ui.overlay.style.display = 'flex'; // Reset display
    ui.progressBar.style.background = '';
    ui.progressBar.style.width = '0%';
    ui.percentText.textContent = '0%';
    ui.statusText.textContent = 'Đang gửi yêu cầu...';
    ui.resultText.value = '';

    if (isRunning) {
      ui.statusText.textContent = 'Đang có tiến trình chạy...';
      return; // Or queue it?
    }
    isRunning = true;

    activeRequestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    chrome.runtime.sendMessage(
      { action: 'ocr-offscreen', srcUrl, requestId: activeRequestId },
      response => {
        if (chrome.runtime.lastError) {
          ui.statusText.textContent = 'Lỗi kết nối';
          ui.resultText.value = chrome.runtime.lastError.message;
          isRunning = false;
          return;
        }
        if (!response?.ok) {
          ui.statusText.textContent = 'Lỗi khởi tạo';
          ui.resultText.value = response?.error || 'Unknown error';
          isRunning = false;
          return;
        }
        ui.statusText.textContent = 'Đang xử lý...';
        updateProgress({ progress: 0.1 }, ui);
      }
    );
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.action === 'get-last-image') {
      sendResponse({ srcUrl: lastRightClickSrc });
      return;
    }

    // Handle OCR messages
    // If it's an 'ocr-image' action, always start a new job
    if (message && message.action === 'ocr-image' && message.srcUrl) {
      runOcrForImage(message.srcUrl);
      return; // Do not process further in this listener for 'ocr-image'
    }

    // For progress/result/error, ensure it matches the active request
    if (!activeRequestId || message.requestId !== activeRequestId) {
      return;
    }

    const ui = ensureOverlay();

    if (message.action === 'ocr-progress') {
      updateProgress(message, ui);
    } else if (message.action === 'ocr-result') {
      ui.statusText.textContent = message.cached ? 'Hoàn thành (Cache)' : 'Hoàn thành';
      ui.resultText.value = message.text || '';
      ui.progressBar.style.width = '100%';
      ui.percentText.textContent = '100%';
      isRunning = false;
      activeRequestId = null;
    } else if (message.action === 'ocr-error') {
      ui.statusText.textContent = 'Thất bại';
      ui.resultText.value = message.error;
      ui.progressBar.style.width = '100%'; // Fill progress bar on error
      ui.progressBar.style.background = '#ef4444'; // Indicate error visually
      isRunning = false;
      activeRequestId = null;
    }
  });
})();
