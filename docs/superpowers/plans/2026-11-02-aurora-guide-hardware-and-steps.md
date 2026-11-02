# Aurora Guide Hardware Requirements and Detailed Steps Implementation Plan

> Execute inline on `main`. One feature, one commit.

**Goal:** Tell a first-time user which graphics cards get which features, and turn the operating instructions into steps they can follow without guessing.

**Architecture:** The offline guide gains one new section for GPU support, because GPU capability is a property of the pinned upstream release rather than of this app. The existing operational sections get more concrete: named buttons, named acceptance criteria, and a repeatable test loop. The guide stays read-only.

**Spec:** `docs/superpowers/specs/2026-09-26-aurora-swapper-design.md`, section 使用指南.

## Constraints

- Hardware claims come from NVIDIA's official GeForce comparison, AMD's official FSR hardware table, and the upstream docs pinned to `aurora-v1.1.2`. Where two sources disagree, say so; do not pick one and present it as settled.
- A separate section, not a new article inside 什么是: the introduction section describes this app and stays version-independent.
- Do not promise per-game or per-model support. The game must offer an upscaling input, whatever the GPU can do.
- Steps name this app's buttons, not upstream `setup_windows.bat`. The app never runs the interactive setup script.
- Chinese and English carry the same points in the same order.

## Task 1: GPU and hardware requirements

- [x] New `hardware` section right after the introduction.
- [x] NVIDIA: RTX 50 / 40 / 30 / 20 / GTX 16 / 10, and laptop GPUs counting as their desktop counterpart.
- [x] AMD: RX 9000 / 7000 / 6000 / 5000, FSR versus DLSS routes, and the note that 6X does not apply.
- [x] Intel Arc plus a note on integrated and older cards.
- [x] Four gates that matter more than the GPU model: game upscaling input, rendering API, driver build, one proxy per game.

## Task 2: Detailed steps

- [x] 快速上手: each of the five steps says where to click, what success looks like, and what not to do.
- [x] 快速上手: new article explaining what every button in this app does.
- [x] 基础设置与保存: new article on finding the real game EXE folder via Task Manager, and the symptom of picking the wrong folder.
- [x] 调参思路: new article with a baseline → one change → same scene → one line of notes → revert loop.
- [x] 常见问题与恢复: new article on proxy conflicts with another mod loader.

## Task 3: Documentation and verification

- [x] `reviewedAt` moves to 2026-11-02 because the upstream documents were re-read on that date.
- [x] Design spec updated: eight sections, 51 entries, the new sources.
- [x] `npm test` passes.
- [x] New regressions cover the hardware section, the global bilingual shape, and the expanded steps.
- [x] Launch the app and confirm the new section and the expanded steps read correctly in Chinese and English.

## Notes

- The hardware section sits next to the introduction on purpose: a newcomer deciding whether it is worth installing reads 这是什么 and 显卡与硬件要求 before touching anything.
- NVIDIA's official page lists DLSS frame generation from RTX 30 and multi-frame generation from RTX 40; Aurora v1.1.2 leads with RTX 40 multi-frame generation up to 6X as community work.
- AMD's current table covers FSR4 machine-learning upscaling on RX 6000, while the upstream OptiScaler docs pinned to v1.1.2 still say RDNA3/RDNA4 only. The guide states both.
