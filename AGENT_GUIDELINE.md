# Agent Guideline

Guidelines for future agents and contributors working on this Chrome Extension MV3 project.

## Project Goals

- Keep OCR processing local in the browser. Do not add external OCR APIs, telemetry, analytics, or CDN runtime dependencies unless explicitly requested.
- Preserve the no-build workflow. The extension should keep working through `chrome://extensions` -> `Load unpacked`.
- Prioritize reliability, privacy, and predictable memory usage over clever abstractions.

## Architecture Boundaries

Keep responsibilities separated by extension context:

- `src/background/index.js`
  - Owns MV3 service worker responsibilities: context menu setup, message routing, offscreen lifecycle, and tab forwarding.
  - Should stay lightweight. Do not run OCR, image preprocessing, or DOM-heavy logic here.
  - If a new message action is added, document its direction and payload shape near the related handler.

- `src/offscreen/offscreen.js`
  - Owns the OCR pipeline: image loading, hashing, cache lookup/write, preprocessing, Tesseract worker lifecycle, queueing, progress, and final result creation.
  - Keep the OCR worker warm only when useful, and terminate it after idle time to control memory.
  - Keep jobs sequential unless there is a measured reason to change; parallel OCR can exhaust memory quickly.

- `src/content/content-ocr.js`
  - Owns page interaction and the result overlay.
  - Use Shadow DOM for UI isolation. Avoid leaking global styles into host pages.
  - Avoid heavy OCR/data processing in the page context.

- `src/popup/*`
  - Owns popup UI, local file selection, drag/drop, paste handling, progress display, copy behavior, and sending OCR requests.
  - Reuse the shared background/offscreen OCR flow instead of creating a separate OCR path.

- `src/shared/*`
  - Owns small dependency-free helpers shared by extension pages.
  - Keep shared scripts compatible with direct `<script>` loading and load them before dependent scripts.

- `assets/tesseractjs/*`
  - Treat bundled Tesseract files and language data as vendor assets.
  - Do not edit minified/vendor files manually. Replace them only as a deliberate dependency update.

## Message Flow Rules

Current intended flow:

```text
Popup or Content Script
  -> Background Service Worker: ocr-offscreen
  -> Offscreen Document: ocr-run
  -> Background Service Worker: ocr-progress | ocr-result | ocr-error
  -> Popup listener or Content Script overlay
```

Rules:

- Every OCR request must carry a `requestId`.
- Progress, result, and error messages must preserve the same `requestId`.
- Tab-originated requests must include `tabId` so background can forward results to the correct page.
- Popup-originated requests may use `tabId: null`; popup should filter by `requestId`.
- Background must persist popup-originated OCR state so closing and reopening the popup does not lose in-flight progress or the latest result.
- Avoid adding broadcast messages unless the receiving side has strict filtering.

## OCR Pipeline Rules

- Keep preprocessing deterministic and side-effect free.
- Cache by image content hash, not by URL. URLs can change or serve different content.
- When changing filters, preserve a fallback path for low-confidence or short OCR output.
- Tesseract language support is currently `eng+vie`. Do not remove either language without updating README and UI copy.
- Report useful progress statuses for long steps: hashing, preprocessing, recognizing, cache hit, completion, and errors.

## Code Style

- Use plain JavaScript compatible with Chrome Extension MV3.
- Prefer small named functions over large inline handlers when logic grows.
- Keep function responsibilities narrow and easy to test manually.
- Use early returns for validation and error paths.
- Avoid introducing global mutable state unless it represents extension lifecycle state, such as the warm worker, queue, or active request.
- Keep comments short and useful. Explain non-obvious extension constraints, not what each line does.
- Do not leave unused constants, dead handlers, duplicate markup, or debug-only branches in production paths.
- Keep naming consistent with existing actions and files: `ocr-*`, `requestId`, `srcUrl`, `tabId`.

## UI Rules

- Popup UI should stay compact and functional within the fixed extension popup size.
- Overlay UI must remain isolated, fixed-position, and easy to dismiss.
- Do not place host-page-dependent CSS outside Shadow DOM.
- Keep Vietnamese user-facing copy consistent and readable. If changing labels, update README examples when relevant.
- Progress UI should show both status and percent when the markup supports it.

## Privacy and Security Rules

- Do not send images or recognized text to external services.
- Be careful with `host_permissions`; keep them aligned with the actual image-fetching requirements.
- Avoid `eval`, remote scripts, inline dynamic script injection, or new CSP relaxations unless there is a documented Chrome Extension requirement.
- Do not log recognized text by default.
- Debug logs should be easy to disable and should not expose private OCR output.
- Prefer `chrome.storage.session` for restoring recent OCR UI state. Use `chrome.storage.local` for OCR text only when long-lived persistence is explicitly requested.

## Performance Rules

- Do not create a new Tesseract worker per request unless the warm-worker model is intentionally removed.
- Avoid parallel OCR jobs by default.
- Revoke object URLs when their lifecycle can be controlled.
- Avoid unnecessary base64 conversions for large images; prefer `Blob`, `ArrayBuffer`, and object URLs where appropriate.
- Keep cache growth in mind when adding new cached data. If adding metadata or multiple result variants, consider eviction.

## Manual Test Checklist

Before finishing changes that affect behavior, test at least the relevant items:

- Load unpacked extension in Chrome without manifest errors.
- Popup upload flow: select image -> OCR -> progress -> result -> copy.
- Popup drag/drop flow.
- Popup paste image flow.
- Context menu flow: right click image -> OCR overlay -> progress -> result -> copy -> close.
- Cache behavior: OCR the same image twice and confirm the cached result path still works.
- Restricted or cross-origin image behavior: errors should be visible and not break the extension.
- Console errors in background, popup, offscreen, and content script contexts.

## Change Discipline

- Keep changes scoped to the requested task.
- Update README when user-facing workflows, permissions, configuration, or architecture change.
- Do not modify license text unless explicitly requested.
- Do not reformat vendor assets or unrelated files.
- If a change affects the message contract, update all senders and receivers together.
