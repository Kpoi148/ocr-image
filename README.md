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
- **Language support**: `eng+vie` (English + Vietnamese).
- **Multi-pass OCR**: Dual-pass recognition (normal + color-inverted) to capture both light and dark colored text.
- **Advanced noise reduction**: Heuristic filtering based on confidence scores, symbol density, and word length.
- **Image preprocessing**: Grayscale conversion with adaptive contrast enhancement.
- **Shadow DOM overlay**: Style-isolated result overlay prevents conflicts with host page CSS.
- **Premium UI design**: Modern, responsive interface with smooth animations and glassmorphism aesthetics.
- **Smart caching**: SHA-256 hash-based cache to avoid redundant OCR operations.
- **Warm worker**: Persistent Tesseract worker with auto-termination after idle timeout.

## Architecture and flow
All OCR processing is centralized in the offscreen document, ensuring consistent performance and memory efficiency. Both the Popup and Context Menu workflows share the same warm Tesseract worker.

```
User → Popup / Context Menu
     → Background Service Worker (message routing)
     → Offscreen Document (Tesseract worker)
        ├─ Multi-pass OCR (normal + inverted)
        ├─ Heuristic noise filtering
        └─ Result caching (SHA-256)
     → Results forwarded to:
        ├─ Popup UI
        └─ Content Script (Shadow DOM overlay)
```

## Folder structure
```
assets/
  icons/                      Extension icons
  tesseractjs/                Tesseract.js + wasm + lang data
src/
  background/                 Service worker, context menu, message routing
  content/                    Content script + overlay UI
  offscreen/                  Offscreen OCR worker
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
3. Click "Trich xuat Text"

Context menu:
1. Right click an image on the page
2. Select "OCR: Trich xuat text tu anh"
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
- The latest popup OCR state is stored in `chrome.storage.session` so closing and reopening the popup can restore progress or results during the same browser session.

## Performance and caching
- **Multi-pass OCR**: Runs recognition twice (normal + inverted) to handle colored/stylized fonts, approximately 60% slower than single-pass but significantly more accurate.
- **Warm worker**: Tesseract instance stays initialized and auto-terminates after ~5 minutes of idle time.
- **SHA-256 caching**: Image content is hashed and cached to avoid redundant OCR operations on identical images.
- **Sequential queue**: OCR jobs are processed one at a time to prevent memory overload.

## Configuration
There is no settings UI yet. To disable debug logs, set `DEBUG = false` in:
- `src/background/index.js`
- `src/content/content-ocr.js`
- `src/offscreen/offscreen.js`

## Troubleshooting
- **Missing OCR menu**: Reload the page and ensure an image is present. The content script may not have initialized yet.
- **OCR not running**: Check the Console (F12) and confirm Tesseract worker and WASM files load successfully.
- **Images from restricted domains**: May be blocked by CSP or CORS policies.
- **Stylized/3D fonts**: Multi-pass OCR helps but Tesseract has inherent limitations with highly stylized fonts (gradient, 3D effects, artistic typography). For better accuracy with such fonts, consider commercial OCR APIs (Google Vision, Azure Computer Vision).
- **Empty results**: If noise filtering is too aggressive, results may be discarded. The extension uses smart fallback to return raw OCR output when filtered results are too short.

## Agent guideline
Project architecture, clean-code rules, privacy rules, and manual test expectations are documented in `AGENT_GUIDELINE.md`.

## Contributing
PRs and issues are welcome. For large changes, please open an issue first.

## Links
- GitHub: https://github.com/Kpoi148

## License
MIT License. See `LICENSE`.
