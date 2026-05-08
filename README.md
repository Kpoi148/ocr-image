# OCR Text Extractor

Extract text from images directly in the browser (Chrome Extension MV3). OCR runs locally with Tesseract.js and supports English + Vietnamese.

## Table of contents
- Overview
- Features
- Architecture and flow
- Folder structure
- Install
- Usage
- Permissions and rationale
- Data and privacy
- Performance and caching
- Configuration
- Troubleshooting
- Agent guideline
- Contributing
- Links
- License

## Overview
The extension focuses on two main workflows:
- Popup: upload, drag and drop, or paste from the clipboard to OCR.
- Context menu: right click an image on a page to OCR quickly and show an overlay with results.

## Features
- **Offline OCR** with Tesseract.js (local assets, no external API calls).
- **Language support**: `eng+vie` by default, with popup options for `vie` and `eng`.
- **Profile-based OCR pipeline**: Runs a small sequence of OCR profiles for document text, thresholded scans, sparse screenshots, and inverted text instead of a single hard-coded pass.
- **Structured post-processing**: Filters OCR output using line and word confidence data before choosing the best candidate.
- **Image preprocessing**: Grayscale conversion, contrast tuning, bounded small-image upscaling, and optional thresholding, organized as reusable offscreen modules.
- **Shadow DOM overlay**: Style-isolated result overlay prevents conflicts with host page CSS.
- **Smart caching**: SHA-256 hash-based cache to avoid redundant OCR operations.
- **Warm worker**: Persistent Tesseract worker with auto-termination after idle timeout.

## Architecture and flow
All OCR processing is centralized in the offscreen document, ensuring consistent performance and memory efficiency. Both the Popup and Context Menu workflows share the same warm Tesseract worker. The offscreen stack is split into small script-loaded modules so the extension still works with `Load unpacked` and no build step.

```
User → Popup / Context Menu
     → Background Service Worker (message routing)
     → Offscreen Document
        ├─ OCR Profiles (`ocr-profiles.js`)
        ├─ Preprocess Module (`ocr-preprocess.js`)
        ├─ Tesseract Worker Runner (`offscreen.js`)
        ├─ Post-process Module (`ocr-postprocess.js`)
        └─ Result caching (SHA-256)
     → Results forwarded to:
        ├─ Popup UI
        └─ Content Script (Shadow DOM overlay)
```

Offscreen responsibilities:
- `src/offscreen/ocr-profiles.js`: declares which OCR profiles run and which Tesseract/preprocess settings each profile uses.
- `src/offscreen/ocr-preprocess.js`: owns content hashing and deterministic image preprocessing.
- `src/offscreen/ocr-postprocess.js`: owns structured OCR filtering, overlap cleanup, and candidate scoring/selection.
- `src/offscreen/offscreen.js`: owns queueing, worker lifecycle, cache lookup/write, progress reporting, and final message dispatch.
- `src/offscreen/offscreen.html`: loads the offscreen scripts in dependency order with no bundler.

## Folder structure
```
assets/
  icons/                      Extension icons
  tesseractjs/                Tesseract.js + wasm + lang data
src/
  background/                 Service worker, context menu, message routing
  content/                    Content script + overlay UI
  offscreen/                  Offscreen OCR runner + profiles + preprocess + postprocess
    offscreen.html            Offscreen document script loader
    offscreen.js              OCR orchestration, queue, worker lifecycle, cache
    ocr-profiles.js           OCR profile definitions
    ocr-preprocess.js         Hashing and image preprocessing
    ocr-postprocess.js        Structured OCR cleanup and candidate scoring
  popup/                      Popup UI
  shared/                     Shared extension-page helpers
manifest.json                 Manifest MV3
```

## Install
1. Open `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked"
4. Select the folder you store

No build step is required.

## Usage
Popup:
1. Click the extension icon
2. Drag and drop an image, click to select a file, or paste from the clipboard
3. Choose the OCR language if needed
4. Click "Trích xuất Text"

Context menu:
1. Right click an image on the page
2. Select "OCR: Trích xuất text từ ảnh"
3. View results in the bottom right overlay

## Permissions and rationale
- `activeTab`: interact with the current tab.
- `scripting`: inject the content script when needed.
- `contextMenus`: add the OCR menu for images.
- `offscreen`: run Tesseract in an offscreen document.
- `storage`: cache OCR results.
- `host_permissions`: access image URLs on web pages.

## Data and privacy
- OCR runs locally; no text is sent to a server.
- Images may be fetched from their URLs for OCR, depending on the source.
- Cache is stored in `chrome.storage.local` using image hashes.
- The selected OCR language is stored in `chrome.storage.local`.
- The latest popup OCR state is stored in `chrome.storage.session` so closing and reopening the popup can restore progress or results during the same browser session.

## Performance and caching
- **Profile sequence**: The default offscreen pipeline runs document, thresholded document, sparse screenshot, and inverted profiles, then chooses the strongest candidate from structured OCR output.
- **Warm worker**: Tesseract instance stays initialized and auto-terminates after ~5 minutes of idle time.
- **SHA-256 caching**: Image content is hashed and cached per OCR language and OCR pipeline version to avoid redundant OCR operations on identical images. Cache entries older than 7 days are pruned, and only the latest 100 OCR cache entries are kept.
- **Sequential queue**: OCR jobs are processed one at a time to prevent memory overload.

## Configuration
The popup language selector supports `eng+vie`, `vie`, and `eng`; the selected language is saved in `chrome.storage.local` and reused by popup and context-menu OCR. Debug logs are disabled by default. To temporarily enable debug logs, set `DEBUG = true` in:
- `src/background/index.js`
- `src/content/content-ocr.js`
- `src/offscreen/offscreen.js`

## Troubleshooting
- **Missing OCR menu**: Reload the page and ensure an image is present. The content script may not have initialized yet.
- **OCR not running**: Check the Console (F12) and confirm Tesseract worker and WASM files load successfully.
- **Images from restricted domains**: May be blocked by CSP or CORS policies.
- **Stylized/3D fonts**: The profile-based pipeline helps, but Tesseract still has inherent limitations with highly stylized fonts (gradient, 3D effects, artistic typography). For better accuracy with such fonts, consider commercial OCR APIs.
- **Unexpected repeated fragments**: Inspect the raw OCR lines in the offscreen context before changing heuristics. Candidate selection and overlap cleanup live in `src/offscreen/ocr-postprocess.js`.
- **Empty results**: If structured post-processing rejects too much text, the extension falls back to the raw OCR candidate text when the filtered output is too short.

## Agent guideline
Project architecture, clean-code rules, privacy rules, and manual test expectations are documented in `AGENT_GUIDELINE.md`.

## Contributing
PRs and issues are welcome. For large changes, please open an issue first.

## Links
- GitHub: https://github.com/Kpoi148

## License
MIT License. See `LICENSE`.
