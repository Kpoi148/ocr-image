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
  const extractButton = document.getElementById('extractButton');
  const resultText = document.getElementById('resultText');
  const progressDiv = document.getElementById('progress');
  const srcUrl = new URLSearchParams(window.location.search).get('src');

  if (srcUrl) {
    uploadInput.disabled = true;
    extractButton.disabled = true;
    runOcrFromSrcUrl(srcUrl, resultText, progressDiv);
  }

  extractButton.addEventListener('click', async () => {
    const file = uploadInput.files[0];
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
