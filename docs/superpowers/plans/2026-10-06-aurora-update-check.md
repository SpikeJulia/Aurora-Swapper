# Aurora Upstream Update Check Implementation Plan

> Execute inline in the existing `aurora-swapper` worktree. Preserve all existing uncommitted work; this task does not commit or merge it.

**Goal:** Check Aurora's upstream release on startup, at most once per 24 hours, and offer an explicit download action when the upstream package changes.

**Architecture:** A standalone checker caches Release metadata in `userData/aurora-update-check.json`. IPC reads the current package and derives its status from version and digest; renderer shows the result in the package summary and Settings. Existing verified downloading remains the only package activation path.

**Spec:** `docs/superpowers/specs/2026-09-26-aurora-swapper-design.md`, plus the user's approved startup/24-hour frequency.

## Constraints

- Do not edit `src/aurora/` or modify installed games during checks.
- Keep language-based source defaults and explicit online source selection.
- Manual checks bypass the 24-hour cache; concurrent requests share one lookup.
- Failed checks remain visibly failed, with manual retry; failure never means “up to date”.
- Local packages without trusted version/digest have an unknown comparison state.
- SHA-256 detects same-tag republishing; a numerically older upstream tag is not advertised as an upgrade.
- Metadata lookups time out after 10 seconds. Cache write failure does not disable packages.
- Verified downloads refresh checker metadata so old cached results cannot keep advertising an update.
- Reduce the coffee badge to 44px with a 24px icon.

## Task 1: Checker and regression coverage

- [x] Add `test/aurora/package-update.test.js` for notification, persistent 24-hour caching, forced retry, concurrency, invalid metadata, timeout, local/unknown versions, source selection, and cache write failures.
- [x] Run the tests and observe failure because the checker is absent.
- [x] Add `src/aurora-package-update.js`, reusing the downloader's Release reader and source policy.
- [x] Run `node --test test/aurora/package-update.test.js test/aurora/package-download.test.js`.

## Task 2: App integration

- [x] Add read-only check IPC and preload API; initialize checker lazily with a separate userData cache file.
- [x] Add startup lookup, manual check/retry, and visible update/download states in the library summary and Settings.
- [x] Add Chinese and English copy; re-render after language changes, package selection, and downloads.
- [x] Apply the coffee badge size adjustment.

## Task 3: Verification

- [x] Run `npm test` and syntax/diff checks.
- [x] Exercise the actual renderer with isolated Electron fixtures: update reminder while collapsed, download action, retry failure, and English/Chinese text.
- [x] Capture rendered evidence outside the repository and check the coffee badge height.
- [x] Review only this task's edits. Report whether a new Windows portable build was produced.

## Verification evidence (2026-10-06)

- `npm test`: 152 passed, 0 failed, including a regression for synchronous IPC-bridge failure followed by manual retry.
- `node --test test/library-sort-state.test.js`: 4 passed, 0 failed.
- Syntax checks passed for main, preload, downloader, checker, renderer update controller, renderer and translations; `git diff --check` passed.
- Both real upstream metadata endpoints returned `aurora-v1.1.2`; no archive was downloaded and no user package/game state was written during this check.
- The Browser plugin and Playwright were unavailable. QA instead loaded the real application renderer in an isolated Electron BrowserWindow with fixture IPC. Update/download/retry, Chinese/English, collapsed summary visibility, dark mode and QR Escape dismissal passed with zero console errors. Coffee badge measured 44px, icon 24px, no horizontal overflow at 860px viewport width.
- Screenshots: `/private/tmp/aurora-update-qa.Qdmvsn/library-update.png`, `library-update-dark.png`, `about-compact.png`. The isolated Electron profile was cleaned after exit.
- No reviewer-subagent tool was available; scoped inline review caught and fixed the synchronous failure lock issue. No commit, merge, Windows rebuild, or changes to `src/aurora/` were made by this task. The existing portable EXE does not include these edits yet.
