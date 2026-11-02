# Aurora Guide Introduction Implementation Plan

> Execute inline on `main`. One feature, one commit.

**Goal:** Give people who have never used a tool like this a plain-language introduction to what Aurora Swapper is, what it does, what it does not do, and what they need before starting.

**Architecture:** The existing read-only offline guide gains one leading section. The section describes this application rather than the pinned upstream release, so it does not change when Aurora is updated. The library empty state links to it, because a newcomer otherwise never finds the guide at all.

**Spec:** `docs/superpowers/specs/2026-09-26-aurora-swapper-design.md`, section 使用指南.

## Constraints

- The guide stays read-only: no INI edits, no script execution, no automatic downloads.
- Upstream-derived content stays pinned to `aurora-v1.1.2` / `1d22875d05fac2d7ffb86ed912b943ce1a6e915a`; the new section describes the app and is version-independent.
- Chinese and English carry the same points in the same order, so the section cannot drift between languages.
- Explain boundaries honestly: not a trainer, no anti-cheat bypass, not every game supports it, a higher frame rate is not a lower latency.
- Do not advertise a frame-rate number as a guaranteed improvement.

## Task 1: The introduction section

- [x] Add an `intro` section as the first section: 一句话说清它是什么 / 它只做三件事 / 它不是什么 / 开始前你需要准备 / 名词速查.
- [x] Keep Chinese and English point-for-point equivalent.
- [x] Add search tokens so beginners can find it by 超分, 代理 DLL, Upscaling, Proxy.

## Task 2: Presentation

- [x] Render `- ` prefixed lines as a list instead of a paragraph.
- [x] Open the introduction by default; point the guide subtitle at it.
- [x] Add a "第一次用？先看这是什么" entry to the empty library.

## Task 3: Verification

- [x] `npm test`: 162 passed, 0 failed.
- [x] New regressions for the section's existence, bilingual shape, beginner-term search, default expansion, list rendering, and the empty-library entry point.
- [x] Launch the app and confirm the section reads correctly in Chinese and English.

## Notes

- The empty-library button reuses the existing `show('guide')` navigation; no new IPC.
- `guide-list` styles reuse the guide's existing surfaces and theme colours.
- The `- ` prefix is only used inside the new section. Existing entries keep their
  original paragraph rendering, so adding this chapter does not change how the
  six shipped sections read.
