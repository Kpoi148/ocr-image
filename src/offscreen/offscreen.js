const DEBUG = false;
const ACTIONS = globalThis.OcrActions;
const LANGUAGES = globalThis.OcrLanguages;
const PROFILES = globalThis.OcrProfiles;
const PREPROCESS = globalThis.OcrPreprocess;
const POSTPROCESS = globalThis.OcrPostprocess;
const WORKER_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const OCR_CACHE_PREFIX = `ocr:${PROFILES.CACHE_VERSION}:`;
const OCR_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const OCR_CACHE_MAX_ENTRIES = 100;

let warmWorker = null;
let warmWorkerPromise = null;
let warmWorkerLanguage = null;
let warmWorkerPromiseLanguage = null;
let warmWorkerParametersSignature = null;
let workerIdleTimer = null;
let workerProgressContext = null;
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

  return response.blob();
}

async function getImageBlobForJob(job) {
  if (job.imageStoreId) {
    const blob = await OcrImageStore.get(job.imageStoreId);
    if (!blob) {
      throw new Error('Khong tim thay anh trong bo nho tam');
    }
    return blob;
  }

  return fetchImageBlob(job.srcUrl);
}

async function cleanupJobImage(job) {
  if (!job.imageStoreId) {
    return;
  }

  try {
    await OcrImageStore.remove(job.imageStoreId);
  } catch (error) {
    debugLog('temporary image cleanup error', error.message);
  }
}

function getCacheKey(hash, language) {
  return `${OCR_CACHE_PREFIX}${LANGUAGES.normalize(language)}:${hash}`;
}

async function getCachedResult(hash, language) {
  const key = getCacheKey(hash, language);
  if (chrome?.storage?.local) {
    const data = await chrome.storage.local.get(key);
    return data[key] || null;
  }

  return memoryCache.get(key) || null;
}

async function pruneCachedResults() {
  if (!chrome?.storage?.local) {
    return;
  }

  try {
    const now = Date.now();
    const data = await chrome.storage.local.get(null);
    const entries = Object.entries(data)
      .filter(([key, value]) => key.startsWith(OCR_CACHE_PREFIX) && value && typeof value === 'object')
      .map(([key, value]) => ({
        key,
        createdAt: typeof value.createdAt === 'number' ? value.createdAt : 0
      }));

    const keysToRemove = new Set(
      entries
        .filter(entry => !entry.createdAt || now - entry.createdAt > OCR_CACHE_MAX_AGE_MS)
        .map(entry => entry.key)
    );

    const freshEntries = entries
      .filter(entry => !keysToRemove.has(entry.key))
      .sort((a, b) => b.createdAt - a.createdAt);

    freshEntries
      .slice(OCR_CACHE_MAX_ENTRIES)
      .forEach(entry => keysToRemove.add(entry.key));

    if (keysToRemove.size) {
      await chrome.storage.local.remove([...keysToRemove]);
      debugLog('pruned OCR cache entries', keysToRemove.size);
    }
  } catch (error) {
    debugLog('OCR cache prune error', error.message);
  }
}

async function setCachedResult(hash, language, entry) {
  const key = getCacheKey(hash, language);
  if (chrome?.storage?.local) {
    await chrome.storage.local.set({ [key]: entry });
    await pruneCachedResults();
    return;
  }

  memoryCache.set(key, entry);
}

function sendProgress(tabId, requestId, status, progress, language) {
  chrome.runtime.sendMessage({
    action: ACTIONS.OCR_PROGRESS,
    tabId,
    requestId,
    status,
    progress,
    language: LANGUAGES.normalize(language)
  });
}

function sendWorkerProgress(message) {
  if (!workerProgressContext || !message || (!message.status && typeof message.progress !== 'number')) {
    return;
  }

  sendProgress(
    workerProgressContext.tabId,
    workerProgressContext.requestId,
    message.status || '',
    typeof message.progress === 'number' ? message.progress : null,
    workerProgressContext.language
  );
}

function clearWorkerIdleTimer() {
  if (workerIdleTimer) {
    clearTimeout(workerIdleTimer);
    workerIdleTimer = null;
  }
}

function resetWarmWorkerState() {
  warmWorker = null;
  warmWorkerLanguage = null;
  warmWorkerParametersSignature = null;
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
      resetWarmWorkerState();
    }
  }, WORKER_IDLE_TIMEOUT_MS);
}

async function terminateWarmWorker() {
  if (!warmWorker) {
    return;
  }

  try {
    await warmWorker.terminate();
  } catch (error) {
    debugLog('worker terminate error', error.message);
  } finally {
    resetWarmWorkerState();
  }
}

function getParameterSignature(parameters) {
  const entries = Object.entries(parameters || {}).sort((left, right) => left[0].localeCompare(right[0]));
  return entries.length ? JSON.stringify(entries) : '';
}

async function ensureWorkerParameters(worker, parameters) {
  const signature = getParameterSignature(parameters);
  if (!signature || warmWorkerParametersSignature === signature) {
    return;
  }

  if (typeof worker.setParameters === 'function') {
    await worker.setParameters(parameters);
  }
  warmWorkerParametersSignature = signature;
}

async function getWarmWorker(language) {
  const normalizedLanguage = LANGUAGES.normalize(language);
  if (warmWorker && warmWorkerLanguage === normalizedLanguage) {
    return warmWorker;
  }

  if (warmWorker) {
    await terminateWarmWorker();
  }

  if (warmWorkerPromise && warmWorkerPromiseLanguage === normalizedLanguage) {
    return warmWorkerPromise;
  }

  debugLog('creating warm worker', normalizedLanguage);
  warmWorkerPromiseLanguage = normalizedLanguage;
  warmWorkerPromise = Tesseract.createWorker(normalizedLanguage, 1, {
    logger: sendWorkerProgress,
    workerPath: chrome.runtime.getURL('assets/tesseractjs/worker.min.js'),
    corePath: chrome.runtime.getURL('assets/tesseractjs/tesseract-core.wasm.js'),
    langPath: chrome.runtime.getURL('assets/tesseractjs/lang-data'),
    workerBlobURL: false
  });

  try {
    warmWorker = await warmWorkerPromise;
    warmWorkerLanguage = normalizedLanguage;
    warmWorkerParametersSignature = null;
    return warmWorker;
  } catch (error) {
    warmWorkerPromise = null;
    warmWorkerPromiseLanguage = null;
    throw error;
  } finally {
    warmWorkerPromise = null;
    warmWorkerPromiseLanguage = null;
  }
}

function getProfilePhaseProgress(profileIndex, totalProfiles, phase) {
  const baseProgress = 0.15;
  const profileSlice = 0.8 / Math.max(totalProfiles, 1);
  const profileStart = baseProgress + (profileIndex * profileSlice);

  if (phase === 'preprocess') {
    return profileStart;
  }

  return profileStart + (profileSlice * 0.5);
}

async function recognizeProfile(worker, imageBlob, language, profile, profileIndex, totalProfiles, tabId, requestId) {
  sendProgress(
    tabId,
    requestId,
    `preprocessing (${profileIndex + 1}/${totalProfiles})`,
    getProfilePhaseProgress(profileIndex, totalProfiles, 'preprocess'),
    language
  );

  const processedBlob = await PREPROCESS.preprocessImage(imageBlob, profile.preprocess);
  await ensureWorkerParameters(worker, profile.tesseract);

  sendProgress(
    tabId,
    requestId,
    `recognizing (${profileIndex + 1}/${totalProfiles})`,
    getProfilePhaseProgress(profileIndex, totalProfiles, 'recognize'),
    language
  );

  const { data } = await worker.recognize(processedBlob);
  return POSTPROCESS.buildCandidate(data, profile);
}

async function runOcrJob(job) {
  const { srcUrl, imageStoreId, tabId, requestId } = job;
  const language = LANGUAGES.normalize(job.language);
  debugLog('run job', { tabId, requestId, srcUrl, imageStoreId, language });

  clearWorkerIdleTimer();

  try {
    sendProgress(tabId, requestId, 'hashing', 0, language);
    const imageBlob = await getImageBlobForJob(job);
    const imageHash = await PREPROCESS.hashBlob(imageBlob);
    sendProgress(tabId, requestId, 'hashing', 1, language);

    const cached = await getCachedResult(imageHash, language);
    if (cached && cached.text) {
      chrome.runtime.sendMessage({
        action: ACTIONS.OCR_RESULT,
        tabId,
        requestId,
        text: cached.text,
        cached: true,
        language
      });
      debugLog('cache hit', imageHash);
      scheduleWorkerTermination();
      return;
    }

    const worker = await getWarmWorker(language);
    workerProgressContext = { tabId, requestId, language };

    const profiles = PROFILES.getProfilesForJob(job);
    if (!profiles.length) {
      throw new Error('Khong co OCR profile phu hop');
    }

    const candidates = [];
    for (let i = 0; i < profiles.length; i += 1) {
      const profile = profiles[i];
      const candidate = await recognizeProfile(
        worker,
        imageBlob,
        language,
        profile,
        i,
        profiles.length,
        tabId,
        requestId
      );
      candidates.push(candidate);
    }

    const bestCandidate = POSTPROCESS.chooseBestCandidate(candidates);
    const fallbackText = candidates.find(candidate => candidate.rawText)?.rawText || '';
    const finalText = bestCandidate?.text || fallbackText;

    debugLog('OCR candidate scores', candidates.map(candidate => ({
      profileId: candidate.profileId,
      score: candidate.score,
      averageConfidence: candidate.averageConfidence,
      repeatPenalty: candidate.repeatPenalty,
      overlapPenalty: candidate.overlapPenalty,
      words: candidate.totalWordCount
    })));

    await setCachedResult(imageHash, language, {
      text: finalText,
      srcUrl: srcUrl || 'popup-upload',
      language,
      createdAt: Date.now()
    });

    chrome.runtime.sendMessage({
      action: ACTIONS.OCR_RESULT,
      tabId,
      requestId,
      text: finalText,
      language
    });
    debugLog('job done', { tabId, requestId });
  } catch (error) {
    chrome.runtime.sendMessage({
      action: ACTIONS.OCR_ERROR,
      tabId,
      requestId,
      error: error.message,
      language
    });
    debugLog('job error', error.message);
  } finally {
    workerProgressContext = null;
    await cleanupJobImage(job);
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
  if (!message || message.action !== ACTIONS.OCR_RUN || (!message.srcUrl && !message.imageStoreId)) {
    return;
  }

  queue.push({
    srcUrl: message.srcUrl,
    imageStoreId: message.imageStoreId,
    tabId: message.tabId,
    requestId: message.requestId,
    language: message.language
  });
  processQueue();
});
