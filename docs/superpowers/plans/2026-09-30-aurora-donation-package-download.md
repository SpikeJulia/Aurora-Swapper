# Aurora Donation and Package Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a quiet About-page donation card and a verified Aurora Release downloader with local selection, language-based source defaults, and safe failure behavior.

**Architecture:** Keep the existing `src/aurora/` installation core unchanged and add a shared source-policy module plus an outer download/extraction service. The main process owns network, archive extraction, checksum verification, cache promotion, and store updates; the renderer only chooses local/download actions and displays progress. The downloaded directory is passed through the existing `validatePackage` contract before it becomes the active package.

**Tech Stack:** Node.js built-in test runner, Electron IPC/contextBridge, native `fetch`, `extract-zip`, `7zip-bin`, existing renderer HTML/CSS/i18n.

**Spec:** `docs/superpowers/specs/2026-09-26-aurora-swapper-design.md`

## Global Constraints

- Work only in the `aurora-swapper` worktree and branch.
- Do not modify existing installation behavior in `src/aurora/`; consume `validatePackage` as a black box.
- Aurora installation and repair continue to call only `runtime_sync.ps1`; never run `setup_windows.bat`.
- A valid package is an extracted directory containing `OptiScaler.dll` and `runtime_sync.ps1`, and not containing `OptiScaler.sln`.
- The official metadata source is the Aurora GitHub Release API for `abc354402600/OptiScaler-Aurora`; the domestic default mirrors the same metadata and asset URLs through a fixed HTTPS proxy.
- A release asset must provide a SHA-256 digest; checksum failure, extraction failure, validation failure, cancellation, or network failure must leave the current valid package untouched.
- Language selects only the default source: any `zh*` code defaults to the domestic mirror; all other languages default to the official GitHub source. The user can switch source explicitly.
- New renderer copy must use i18n keys with English fallback; do not add a translation requirement for all 38 existing languages.
- The donation QR image is an optional About-page asset and must not block package installation or appear in the game workflow.

## Review Focus

- A GitHub release payload with a missing or malformed digest is rejected before extraction; test in Task 1.
- A mirror response with the wrong bytes is rejected even when the HTTP request succeeds; test in Task 2.
- An archive with a wrapper directory is accepted only after its extracted directory passes the existing package validator; test in Task 2.
- A failed download must not replace an already configured package path; test in Task 2 and the IPC contract in Task 3.
- A non-Chinese language must not accidentally select the mirror, while `zh-TW` must still use the Chinese default; test in Task 1.

### Task 1: Release source policy and manifest parsing

**Files:**
- Create: `src/shared/aurora-package-source.js`
- Create: `test/aurora/package-source.test.js`
- Modify: `docs/superpowers/specs/2026-09-26-aurora-swapper-design.md`

**Interfaces:**
- Produces `preferredSource(language) -> 'mirror' | 'official'`.
- Produces `sourceDefinition(source) -> { id, label, apiUrl, assetUrl(url) }`.
- Produces `releaseAsset(payload) -> { version, tag, name, url, digest, size }` and rejects assets without a valid SHA-256 digest.

- [x] **Step 1: Write the failing tests**

  Cover `zh`, `zh-TW`, `en`, and `ja`; source URL rewriting; selection of an Aurora `.7z` asset over source archives; and rejection of missing/malformed digests.

- [x] **Step 2: Run the source-policy tests and verify they fail for the missing module**

  Run: `node --test test/aurora/package-source.test.js`
  Expected: FAIL because `src/shared/aurora-package-source.js` does not exist yet.

- [x] **Step 3: Implement the source policy and manifest parser**

  Use `https://api.github.com/repos/abc354402600/OptiScaler-Aurora/releases/latest`, `https://gh-proxy.com/` as the mirror prefix, and accept only HTTPS GitHub asset URLs ending in `.7z` or `.zip` whose API `digest` matches `sha256:<64 hex characters>`.

- [x] **Step 4: Run the source-policy tests and verify they pass**

  Run: `node --test test/aurora/package-source.test.js`
  Expected: all source-policy tests pass.

- [x] **Step 5: Update the design specification**

  Replace the first-version local-only/non-download scope with the approved two-source behavior, checksum requirement, cache location, and explicit statement that only `runtime_sync.ps1` is executed for installation.

### Task 2: Verified archive download and cache promotion

**Files:**
- Create: `src/aurora-package-download.js`
- Create: `test/aurora/package-download.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces `downloadAuroraPackage({ source, language, cacheRoot, signal, onProgress, fetchImpl, downloadFile, extractArchive, validatePackage }) -> Promise<{ ok, packageRoot, version, tag, digest, source, cached }>`.
- The service downloads to a temporary directory, verifies SHA-256, extracts `.7z` through `7zip-bin` or `.zip` through `extract-zip`, finds a validated package directory, and atomically promotes it under `cacheRoot`.

- [x] **Step 1: Write failing service tests**

  Test successful promotion from a wrapper directory, checksum mismatch preserving a pre-existing package path, missing digest rejection, and abort propagation. Inject fake network/download/extraction functions so the tests never access the network or execute an archive binary.

- [x] **Step 2: Run the service tests and verify the expected failures**

  Run: `node --test test/aurora/package-download.test.js`
  Expected: FAIL because the downloader module and exported function do not exist.

- [x] **Step 3: Add `7zip-bin` as a runtime dependency and implement the service**

  Keep all downloaded data under the supplied cache root. Use a staging directory and atomic rename; never delete or overwrite the active package on an error. Reject symlinks and unsafe extracted paths, and report progress as `{ phase, received, total }`.

- [x] **Step 4: Run the service tests and verify they pass**

  Run: `node --test test/aurora/package-download.test.js`
  Expected: all service tests pass.

### Task 3: Main-process store and IPC integration

**Files:**
- Create: `test/aurora/package-download-ipc.test.js`
- Modify: `main.js`
- Modify: `preload.js`

**Interfaces:**
- Adds `window.lab.downloadAuroraPackage(source)` and `window.lab.cancelAuroraPackageDownload()`.
- Adds `window.lab.onAuroraPackageProgress(handler)`.
- Adds `aurora-download-package`, `aurora-cancel-package-download`, and `aurora-package-progress` IPC contracts.

- [x] **Step 1: Write failing IPC contract tests**

  Assert that preload exposes the download/cancel/progress methods, main registers both handlers, the language is read from the saved state when source is omitted, and the package store is written only after the service returns `ok: true`.

- [x] **Step 2: Run the IPC contract tests and verify they fail**

  Run: `node --test test/aurora/package-download-ipc.test.js`
  Expected: FAIL because the new IPC names and preload methods are absent.

- [x] **Step 3: Implement the IPC bridge**

  Use `app.getPath('userData')/aurora-packages` as the cache root. Preserve `packageRoot`, `packageVersion`, `packageDigest`, and `packageSource` only after successful promotion. Use an `AbortController` per download and send progress to the invoking renderer.

- [x] **Step 4: Run the IPC contract tests and verify they pass**

  Run: `node --test test/aurora/package-download-ipc.test.js`
  Expected: all IPC contract tests pass.

### Task 4: Renderer choices and donation card

**Files:**
- Create: `assets/donation/aurora-donation.png`
- Create: `test/aurora/package-download-ui.test.js`
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/renderer.js`
- Modify: `src/renderer/style.css`
- Modify: `src/renderer/i18n.js`

**Interfaces:**
- The library package bar and Settings row expose separate local and online actions.
- The download dialog shows the language-derived default source, lets the user switch source, displays progress/status, and leaves the local picker available.
- About renders a visible but quiet support card after license attribution with the supplied QR image at a constrained aspect-preserving size.

- [x] **Step 1: Write failing UI contract tests**

  Assert the two package actions, download dialog IDs/source choices, progress listener wiring, donation image path, and i18n keys exist; assert the donation card is under About rather than the game library.

- [x] **Step 2: Run the UI contract tests and verify they fail**

  Run: `node --test test/aurora/package-download-ui.test.js`
  Expected: FAIL because the new markup, image, and renderer wiring do not exist.

- [x] **Step 3: Add the UI and copy**

  Preserve the existing local chooser behavior. Add Chinese and English strings, derive the default from `getLang()` via the shared source policy, and keep the QR at roughly 240–280px on desktop with a responsive smaller size on narrow windows.

- [x] **Step 4: Run the UI contract tests and verify they pass**

  Run: `node --test test/aurora/package-download-ui.test.js`
  Expected: all UI contract tests pass.

### Task 5: Full verification and packaging readiness

**Files:**
- Modify: `docs/superpowers/plans/2026-09-30-aurora-donation-package-download.md`

- [x] **Step 1: Run the Aurora suite**

  Run: `npm test` -> 110 tests passed, 0 failed.

- [x] **Step 2: Run the legacy suite for regression evidence**

  Run: `npm run test:legacy` -> 281 tests, 268 passed, 11 failed, 2 skipped. The failures are the pre-existing profile/BETA/Xbox/Overlay/Community/shader/source-environment cases; none exercises the new Aurora package downloader or donation card.

- [ ] **Step 3: Run the Electron UI smoke test**

  Run: `npm run test:ui` reaches the renderer but stops in the existing test fixture at `installOptions(...)`: the fixture expects the old HTML-string return value, while the current renderer returns `{ html, packageOk, storeOk, recordOk, record }`. The new UI contract suite remains green (`4/4`), and the renderer now guards the optional progress listener so older fixtures do not throw.

- [x] **Step 4: Run the requested Windows portable packaging command**

  Run: `ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/" npx electron-builder --win portable --x64` -> exit 0. Produced `dist/Aurora-Swapper-0.1.0-portable.exe` (77M); the packaged ASAR contains the donation image and both new downloader/source modules. Windows runtime installation was not verified on Mac.

- [x] **Step 5: Record verification evidence and final review notes**

  Existing user changes in the dirty worktree were preserved; no commit or merge was created. The implementation review found no new edits under `src/aurora/` for this feature; the downloader consumes its validator at the outer boundary.
