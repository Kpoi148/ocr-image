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
- Contributing
- Links
- License

## Overview
The extension focuses on two main workflows:
- Popup: upload, drag and drop, or paste from the clipboard to OCR.
- Context menu: right click an image on a page to OCR quickly and show an overlay with results.

## Features
- Offline OCR with Tesseract.js (local assets).
- Language support: `eng+vie`.
- Image preprocessing: grayscale + contrast + Otsu threshold.
- On page overlay with copy and close actions.
- SHA-256 cache to avoid redoing OCR.
- Warm worker with auto termination when idle.

## Architecture and flow
OCR always runs in an offscreen document to match MV3 requirements.

```
User -> Context menu / Popup
     -> background (service worker)
     -> offscreen (Tesseract worker)
     -> results / progress
     -> content script overlay
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

## Performance and caching
- Worker stays warm and auto terminates after ~5 minutes of idle time.
- SHA-256 cache avoids rerunning OCR for the same image.
- Queue processes OCR jobs sequentially to avoid overload.

## Configuration
There is no settings UI yet. To disable debug logs, set `DEBUG = false` in:
- `src/background/index.js`
- `src/content/content-ocr.js`
- `src/offscreen/offscreen.js`

## Troubleshooting
- Missing OCR menu: reload the page and make sure the page has an image.
- OCR not running: check the Console, confirm the worker and wasm files load.
- Images from restricted domains: may be blocked by CSP or CORS.

## Contributing
PRs and issues are welcome. For large changes, please open an issue first.

## Links
- GitHub: https://github.com/Kpoi148

## License
MIT License. See `LICENSE`.
