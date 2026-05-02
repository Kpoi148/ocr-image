(() => {
  if (globalThis.OcrLanguages) {
    return;
  }

  const DEFAULT_LANGUAGE = 'eng+vie';
  const STORAGE_KEY = 'ocr:language';
  const OPTIONS = Object.freeze([
    { value: DEFAULT_LANGUAGE, label: 'English + Tiếng Việt' },
    { value: 'vie', label: 'Tiếng Việt' },
    { value: 'eng', label: 'English' }
  ]);
  const values = new Set(OPTIONS.map(option => option.value));

  function normalize(language) {
    return values.has(language) ? language : DEFAULT_LANGUAGE;
  }

  async function getStored() {
    const storage = globalThis.chrome?.storage?.local;
    if (!storage) {
      return DEFAULT_LANGUAGE;
    }

    const data = await storage.get(STORAGE_KEY);
    return normalize(data[STORAGE_KEY]);
  }

  async function setStored(language) {
    const normalized = normalize(language);
    const storage = globalThis.chrome?.storage?.local;
    if (storage) {
      await storage.set({ [STORAGE_KEY]: normalized });
    }
    return normalized;
  }

  globalThis.OcrLanguages = Object.freeze({
    DEFAULT_LANGUAGE,
    OPTIONS,
    normalize,
    getStored,
    setStored
  });
})();
