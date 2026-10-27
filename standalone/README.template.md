---
title: MOSS Blind Layout Check
emoji: 🧪
colorFrom: purple
colorTo: gray
sdk: static
app_file: index.html
license: apache-2.0
short_description: Blind A/B check of MOSS text and placement from local images
thumbnail: https://huggingface.co/spaces/alphabell/MOSS-Blind-Layout-Check/resolve/main/thumbnail.png
models:
  - OpenMOSS-Team/MOSS-Image-Base
  - OpenMOSS-Team/MOSS-Image-SFT
tags:
  - moss-image
  - blind-evaluation
  - text-rendering
  - layout
  - image-generation
  - educational
---

# MOSS Blind Layout Check

**Which generated image followed your target text layout more closely?**

[**Open the blind A/B check**](https://huggingface.co/spaces/alphabell/MOSS-Blind-Layout-Check). Import one editable [alphaBell MOSS Layout Studio](https://huggingface.co/spaces/alphabell/MOSS-Layout-Studio) draft or compiled MOSS layout prompt, then choose a Base output and an SFT output from your device. The page randomly labels the images A and B, hiding model names and file names while you inspect each target text region. Transcribe visible characters, draw or enter where the text landed, and mark missing or illegible text. Reveal the mapping only after both sides are annotated.

The export records manual text and box scores, source revisions, image SHA-256 hashes and generation settings. It never includes or uploads image bytes. The page runs entirely in your browser, with no inference or OCR. The result describes one user-supplied image pair, not overall Base-versus-SFT quality. Differences in prompt, seed, crop and generation settings can affect the pair.

Compiled MOSS prompts omit canvas size. Enter the exact original generation width and height before import; both local images must match those dimensions. Unicode graphemes and line breaks are scored literally. Missing text counts as a full miss, while illegible text is reported separately. [Format and conversion guide](https://huggingface.co/blog/alphabell/moss-layout-studio) · [Pinned OpenMOSS format](https://github.com/OpenMOSS/MOSS-Image/blob/52b87fca23acedc399d062d593bec388aee9926a/USERGUIDE.md#layout-prompts-experimental).

This Space is generated from the canonical [alphaBell MOSS Layout Studio source](https://github.com/alphabell-research/moss-layout-studio). Its scoring code and parser are copied byte-for-byte at release time; the standalone package only changes navigation back to the original editor. [Build manifest](build-manifest.json) · [Apache-2.0 license](LICENSE) · [Source attribution](NOTICE).

Serve this directory over HTTP to run it locally. Run `node --test tests/evaluate.test.mjs` for scoring and schema checks and `python3 verify_evaluator.py` after installing Playwright Chromium for the browser flow. No model weights, account or API key are needed.
