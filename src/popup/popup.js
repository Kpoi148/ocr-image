// popup.js - Logic OCR modular, dễ maintain

// Function để init Tesseract worker (sử dụng local paths)
async function initTesseract() {
  try {
    // Tạo worker với ngôn ngữ ngay từ đầu (v5+ syntax)
    const worker = await Tesseract.createWorker('eng+vie', 1, {  // 1 = OEM_LSTM_ONLY cho độ chính xác cao
      logger: m => updateProgress(m),  // Theo dõi progress
      workerPath: chrome.runtime.getURL('assets/tesseractjs/worker.min.js'),
      corePath: chrome.runtime.getURL('assets/tesseractjs/tesseract-core.wasm.js'),
      langPath: chrome.runtime.getURL('assets/tesseractjs/lang-data'),
      workerBlobURL: false
    });
    return worker;
  } catch (error) {
    console.error('Lỗi init Tesseract:', error);
    throw error;  // Ném lỗi để xử lý ở extractText
  }
}

// Function cập nhật progress (trực quan cho user)
function updateProgress(message) {
  const progressDiv = document.getElementById('progress');
  const progressBar = progressDiv.querySelector('progress');
  progressDiv.style.display = 'block';
  if (message && typeof message.progress === 'number') {
    progressBar.max = 1;
    progressBar.value = message.progress;
  }
  console.log('Progress:', message);  // Log chi tiết cho debug
}

// Function chính trích xuất text
async function extractText(imageInput) {
  let worker;
  try {
    worker = await initTesseract();
    const { data: { text } } = await worker.recognize(imageInput);
    return text;
  } catch (error) {
    console.error('Lỗi OCR toàn bộ:', error);
    return 'Có lỗi xảy ra: ' + error.message + '. Kiểm tra console để biết chi tiết.';
  } finally {
    if (worker) await worker.terminate();  // Luôn giải phóng resource
  }
}

function resetProgress(progressDiv) {
  const progressBar = progressDiv.querySelector('progress');
  if (progressBar) {
    progressBar.max = 1;
    progressBar.value = 0;
  }
}

async function getImageInputFromSrcUrl(srcUrl) {
  const trimmedUrl = srcUrl.trim();
  if (trimmedUrl.startsWith('data:') || trimmedUrl.startsWith('blob:')) {
    return trimmedUrl;
  }

  const response = await fetch(trimmedUrl, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Khong the tai anh (${response.status})`);
  }
  return await response.blob();
}

async function runOcrFromSrcUrl(srcUrl, resultText, progressDiv) {
  progressDiv.style.display = 'block';
  resetProgress(progressDiv);
  resultText.value = 'Dang tai anh...';
  try {
    const imageInput = await getImageInputFromSrcUrl(srcUrl);
    const text = await extractText(imageInput);
    resultText.value = text;
  } catch (error) {
    console.error('Loi tai anh tu URL:', error);
    resultText.value = 'Khong the tai anh de OCR: ' + error.message + '. Hay tai anh ve va upload thu cong.';
  } finally {
    progressDiv.style.display = 'none';
  }
}

// Event listeners (tách riêng để dễ thêm event mới)
document.addEventListener('DOMContentLoaded', () => {
  const uploadInput = document.getElementById('imageUpload');
  const dropZone = document.getElementById('dropZone');
  const dropFileName = document.getElementById('dropFileName');
  const extractButton = document.getElementById('extractButton');
  const resultText = document.getElementById('resultText');
  const progressDiv = document.getElementById('progress');
  const srcUrl = new URLSearchParams(window.location.search).get('src');
  let selectedFile = null;

  if (srcUrl) {
    uploadInput.disabled = true;
    dropZone.classList.add('drop-zone--disabled');
    dropZone.setAttribute('aria-disabled', 'true');
    dropZone.tabIndex = -1;
    extractButton.disabled = true;
    runOcrFromSrcUrl(srcUrl, resultText, progressDiv);
  }

  function setSelectedFile(file) {
    selectedFile = file;
    dropFileName.textContent = file ? file.name : '';
  }

  function triggerFilePicker() {
    if (uploadInput.disabled) {
      return;
    }
    uploadInput.click();
  }

  dropZone.addEventListener('click', () => {
    triggerFilePicker();
  });

  dropZone.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      triggerFilePicker();
    }
  });

  dropZone.addEventListener('dragover', event => {
    event.preventDefault();
    if (!uploadInput.disabled) {
      dropZone.classList.add('drop-zone--active');
    }
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drop-zone--active');
  });

  dropZone.addEventListener('drop', event => {
    event.preventDefault();
    dropZone.classList.remove('drop-zone--active');
    if (uploadInput.disabled) {
      return;
    }
    const file = event.dataTransfer.files[0];
    if (!file) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      alert('Vui lòng chọn file ảnh!');
      return;
    }
    setSelectedFile(file);
  });

  uploadInput.addEventListener('change', () => {
    setSelectedFile(uploadInput.files[0] || null);
  });

  extractButton.addEventListener('click', async () => {
    const file = selectedFile || uploadInput.files[0];
    if (!file) {
      alert('Vui lòng chọn ảnh!');
      return;
    }
    progressDiv.style.display = 'block';
    resetProgress(progressDiv);
    const imageUrl = URL.createObjectURL(file);
    try {
      const text = await extractText(imageUrl);
      resultText.value = text;
    } finally {
      URL.revokeObjectURL(imageUrl);
      progressDiv.style.display = 'none';
    }
  });
});
