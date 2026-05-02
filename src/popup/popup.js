// popup.js - Modernized with Message Passing & Premium UI Logic

const EXTENSION_ID = chrome.runtime.id;
const RUNNING_STATE_TIMEOUT_MS = 30 * 60 * 1000;
let activeRequestId = null;

// DOM Elements
const dropZone = document.getElementById('dropZone');
const dropFileName = document.getElementById('dropFileName');
const extractButton = document.getElementById('extractButton');
const resultText = document.getElementById('resultText');
const imageUpload = document.getElementById('imageUpload');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const progressStatus = document.getElementById('progressStatus');
const progressPercent = document.getElementById('progressPercent');
const copyBtn = document.getElementById('copyBtn');

function createImageStoreId() {
  return `popup-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Helper: Format Bytes
function formatBytes(bytes, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

// UI State Management
function setProcessingState(isProcessing, statusText = '') {
  if (isProcessing) {
    extractButton.disabled = true;
    extractButton.classList.add('btn-processing');
    extractButton.textContent = 'Đang xử lý...';
    progressContainer.style.display = 'block';
    progressStatus.textContent = statusText || 'Đang khởi tạo...';
    progressBar.style.width = '0%';
    progressPercent.textContent = '0%';
    resultText.classList.add('processing');
  } else {
    extractButton.disabled = false;
    extractButton.classList.remove('btn-processing');
    extractButton.textContent = 'Trích xuất Text';
    resultText.classList.remove('processing');
  }
}

function updateProgress(percent, text) {
  const normalizedPercent = Math.max(0, Math.min(1, percent));
  const displayPercent = Math.round(normalizedPercent * 100);
  progressBar.style.width = `${displayPercent}%`;
  progressPercent.textContent = `${displayPercent}%`;
  if (text) progressStatus.textContent = text;
}

function renderDoneState(state) {
  setProcessingState(false);
  progressContainer.style.display = 'block';
  progressStatus.textContent = state.statusText || (state.cached ? 'Hoàn thành (Cache)' : 'Hoàn thành');
  progressBar.style.width = '100%';
  progressPercent.textContent = '100%';
  resultText.value = state.text || '';
}

function renderErrorState(state) {
  setProcessingState(false);
  progressStatus.textContent = state.statusText || 'Thất bại';
  progressPercent.textContent = '0%';
  progressContainer.style.display = 'none';
  resultText.value = `⚠️ Lỗi: ${state.error || 'Unknown error'}`;
}

async function restorePopupState() {
  try {
    const state = await OcrPopupState.get();
    if (!state?.requestId) {
      return;
    }

    if (state.status === 'running') {
      const isStale = state.updatedAt && Date.now() - state.updatedAt > RUNNING_STATE_TIMEOUT_MS;
      if (isStale) {
        const staleState = await OcrPopupState.update({
          requestId: state.requestId,
          status: 'error',
          statusText: 'Thất bại',
          progress: 0,
          error: 'Tiến trình OCR trước đó đã quá thời gian chờ'
        });
        renderErrorState(staleState);
        return;
      }

      activeRequestId = state.requestId;
      setProcessingState(true, state.statusText || 'Đang xử lý...');
      updateProgress(typeof state.progress === 'number' ? state.progress : 0, state.statusText);
      resultText.value = state.text || '';
      return;
    }

    activeRequestId = null;
    if (state.status === 'done') {
      renderDoneState(state);
    } else if (state.status === 'error') {
      renderErrorState(state);
    }
  } catch (error) {
    console.error('Failed to restore popup state', error);
  }
}

// Core OCR Logic via Background
async function cleanupStoredImage(imageStoreId) {
  if (!imageStoreId) {
    return;
  }

  try {
    await OcrImageStore.remove(imageStoreId);
  } catch (error) {
    console.error('Failed to clean temporary image', error);
  }
}

async function runOcr(source) {
  if (activeRequestId) return; // Prevent double submit

  activeRequestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  setProcessingState(true, 'Đang gửi yêu cầu...');
  resultText.value = '';

  chrome.runtime.sendMessage({
    action: 'ocr-offscreen',
    srcUrl: source.srcUrl,
    imageStoreId: source.imageStoreId,
    requestId: activeRequestId
  }, (response) => {
    if (chrome.runtime.lastError) {
      cleanupStoredImage(source.imageStoreId);
      handleError(chrome.runtime.lastError.message);
      return;
    }
    if (!response?.ok) {
      cleanupStoredImage(source.imageStoreId);
      handleError(response?.error || 'Không thể khởi tạo OCR');
      return;
    }
    updateProgress(0.1, 'Đang xử lý background...');
  });
}

function handleError(msg) {
  setProcessingState(false);
  activeRequestId = null;
  resultText.value = `⚠️ Lỗi: ${msg}`;
  progressStatus.textContent = 'Thất bại';
  progressPercent.textContent = '0%';
  progressContainer.style.display = 'none'; // Hide progress on error after delay? Or keep red?
}

function handleSuccess(text, isCached) {
  setProcessingState(false);
  activeRequestId = null;
  resultText.value = text;
  progressStatus.textContent = isCached ? 'Hoàn thành (Cache)' : 'Hoàn thành';
  progressBar.style.width = '100%';
  progressPercent.textContent = '100%';

  // Auto-focus result for easy copy
  resultText.focus();
}

// Message Listener from Background/Offscreen
chrome.runtime.onMessage.addListener((message) => {
  if (!activeRequestId || message.requestId !== activeRequestId) return;

  if (message.action === 'ocr-progress') {
    const p = message.progress; // 0 to 1
    const s = message.status;
    if (typeof p === 'number') {
      updateProgress(p, s);
    } else {
      progressStatus.textContent = s;
    }
  } else if (message.action === 'ocr-result') {
    handleSuccess(message.text, message.cached);
  } else if (message.action === 'ocr-error') {
    handleError(message.error);
  }
});

// File Handling
let selectedFile = null;

function setSelectedFile(file) {
  selectedFile = file;
  if (file) {
    dropFileName.textContent = `${file.name} (${formatBytes(file.size)})`;
    dropZone.classList.add('has-file');
    // Auto preview or something?
  } else {
    dropFileName.textContent = '';
    dropZone.classList.remove('has-file');
  }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  // Check for URL params (from context menu)
  const params = new URLSearchParams(window.location.search);
  const srcParam = params.get('src');
  if (srcParam) {
    // Mode: Opened via Context Menu (less common now with Overlay, but good fallback)
    // Or if we want to support "Open in Popup" action
    dropZone.style.display = 'none';
    runOcr({ srcUrl: srcParam });
    return;
  }

  restorePopupState();
});

extractButton.addEventListener('click', async () => {
  if (selectedFile) {
    if (activeRequestId) {
      return;
    }

    const imageStoreId = createImageStoreId();
    setProcessingState(true, 'Đang chuẩn bị ảnh...');
    resultText.value = '';

    try {
      await OcrImageStore.put(imageStoreId, selectedFile, {
        name: selectedFile.name,
        type: selectedFile.type,
        size: selectedFile.size
      });
      runOcr({ imageStoreId });
    } catch (error) {
      await cleanupStoredImage(imageStoreId);
      handleError(error.message || 'Không thể chuẩn bị ảnh');
    }
  } else {
    // Shake animation or alert
    dropZone.style.borderColor = '#ff4444';
    setTimeout(() => dropZone.style.borderColor = '', 500);
  }
});

copyBtn.addEventListener('click', async () => {
  if (!resultText.value) return;
  try {
    await navigator.clipboard.writeText(resultText.value);
    const originalText = copyBtn.innerHTML;
    copyBtn.textContent = 'Đã Copy!';
    copyBtn.classList.add('copied');
    setTimeout(() => {
      copyBtn.innerHTML = originalText;
      copyBtn.classList.remove('copied');
    }, 2000);
  } catch (err) {
    console.error('Copy failed', err);
  }
});

// Drag & Drop / Paste / Input
dropZone.addEventListener('click', () => imageUpload.click());
imageUpload.addEventListener('change', () => setSelectedFile(imageUpload.files[0]));

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) {
    setSelectedFile(file);
  }
});

document.addEventListener('paste', (e) => {
  const items = e.clipboardData.items;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      setSelectedFile(file);
      break;
    }
  }
});
