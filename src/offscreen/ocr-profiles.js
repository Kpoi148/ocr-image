(() => {
  if (globalThis.OcrProfiles) {
    return;
  }

  const BASE_PREPROCESS_OPTIONS = Object.freeze({
    grayscale: true,
    contrast: 0.5,
    threshold: false
  });

  const DOCUMENT_BLOCK_PARAMETERS = Object.freeze({
    tessedit_pageseg_mode: '6',
    preserve_interword_spaces: '1'
  });

  const PROFILES = Object.freeze([
    Object.freeze({
      id: 'document-block',
      label: 'Document Block',
      preprocess: Object.freeze({ ...BASE_PREPROCESS_OPTIONS }),
      tesseract: DOCUMENT_BLOCK_PARAMETERS
    }),
    Object.freeze({
      id: 'document-block-inverted',
      label: 'Document Block Inverted',
      preprocess: Object.freeze({ ...BASE_PREPROCESS_OPTIONS, invert: true }),
      tesseract: DOCUMENT_BLOCK_PARAMETERS
    })
  ]);

  function getProfilesForJob(_job) {
    return PROFILES;
  }

  function getProfileById(id) {
    return PROFILES.find(profile => profile.id === id) || null;
  }

  globalThis.OcrProfiles = Object.freeze({
    CACHE_VERSION: 'v2',
    getProfilesForJob,
    getProfileById
  });
})();
