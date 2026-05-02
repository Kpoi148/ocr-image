(() => {
  const POPUP_STATE_KEY = 'ocr:popup-state';

  function getStorageArea() {
    return globalThis.chrome?.storage?.session || globalThis.chrome?.storage?.local;
  }

  async function getPopupState() {
    const storage = getStorageArea();
    if (!storage) {
      return null;
    }

    const data = await storage.get(POPUP_STATE_KEY);
    return data[POPUP_STATE_KEY] || null;
  }

  async function setPopupState(state) {
    const storage = getStorageArea();
    if (!storage) {
      return;
    }

    await storage.set({
      [POPUP_STATE_KEY]: {
        ...state,
        updatedAt: Date.now()
      }
    });
  }

  async function updatePopupState(patch) {
    const current = await getPopupState();
    const next = {
      ...(current || {}),
      ...patch
    };
    await setPopupState(next);
    return next;
  }

  async function clearPopupState() {
    const storage = getStorageArea();
    if (!storage) {
      return;
    }

    await storage.remove(POPUP_STATE_KEY);
  }

  globalThis.OcrPopupState = {
    get: getPopupState,
    set: setPopupState,
    update: updatePopupState,
    clear: clearPopupState
  };
})();
