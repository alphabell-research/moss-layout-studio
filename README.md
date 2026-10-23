---
title: MOSS Layout Studio
emoji: 🧩
colorFrom: gray
colorTo: purple
sdk: static
app_file: index.html
pinned: true
thumbnail: https://huggingface.co/spaces/alphabell/MOSS-Layout-Studio/resolve/main/thumbnail.png
license: apache-2.0
models:
  - OpenMOSS-Team/MOSS-Image-Base
tags:
  - moss-image
  - layout
  - text-to-image
  - prompt-engineering
  - debugging
short_description: Draw layouts and export MOSS-Image prompt JSON
---

# MOSS Layout Studio

Draw a poster, place exact text, and export the JSON layout for MOSS-Image-Base's experimental layout prompts. An independent alphaBell project.

**[Try MOSS Layout Studio](https://huggingface.co/spaces/alphabell/MOSS-Layout-Studio)** · [Source and checks](https://github.com/alphabell-research/moss-layout-studio)

![MOSS Layout Studio with an editable travel poster, exact text boxes and a centered model-coordinate readout.](preview.png)

Move and resize text, object and character boxes on a canvas. Keep Chinese copy, emoji and intended line breaks intact. Import an existing layout to edit it, or start from a composition preset.

The editor runs in your browser. It prepares layouts without model inference. Its wireframe shows placement and text, rather than a generated image. Drafts remain in memory until you download them; there is no autosave, analytics or uploaded prompt content.

## Two exports for two jobs

**Editable draft** keeps the canvas `width` and `height`, with top-left-origin absolute-pixel boxes in `[x_min, y_min, x_max, y_max]` order. Save this format to keep editing.

**Model prompt** uses center-origin absolute pixels in `[y_min, x_min, y_max, x_max]` order. It omits dimensions, following the upstream compiler. Use it with the same output width and height in your MOSS-Image generation settings.

For example, on a 1536 by 1024 canvas, a cup occupying `[176, 224, 800, 864]` in the draft becomes `[-288, -592, 352, 32]` in the model prompt. Fractional draft edges are enclosed at pixel boundaries before the canvas center is subtracted.

When importing a model prompt, choose its original canvas dimensions first. An editable draft carries its own dimensions. Resizing the editor canvas scales the composition when **Scale boxes with the canvas** is selected. With it off, pixel positions stay fixed; a resize that would put boxes outside the canvas is rejected. Changing dimensions in an upstream draft alone does not rescale its boxes.

Known optional metadata, palettes and item tags survive import and export. Unknown fields and duplicate JSON keys produce an error instead of silently discarding content. Editor IDs stay out of both exports. Overlapping items are allowed.

## Format reference

The coordinate convention follows the official [MOSS-Image user guide](https://github.com/OpenMOSS/MOSS-Image/blob/52b87fca23acedc399d062d593bec388aee9926a/USERGUIDE.md#layout-prompts-experimental). Editable-draft validation and compilation follow the [layout reference](https://github.com/OpenMOSS/MOSS-Image/blob/52b87fca23acedc399d062d593bec388aee9926a/skills/moss-image-prompt-enhancer/references/layout.md) and [compiler](https://github.com/OpenMOSS/MOSS-Image/blob/52b87fca23acedc399d062d593bec388aee9926a/skills/moss-image-prompt-enhancer/scripts/compile_prompt.py) at revision `52b87fca23acedc399d062d593bec388aee9926a`.

Dimensions must be positive integer multiples of 16. Resolution recommendations appear separately from format validation. The browser editor additionally requires dimensions within JavaScript's safe integer precision. Layout adherence and text rendering are properties of the image model and generation settings; this tool checks the layout representation.

The visual editor accepts canvas edges up to 8192 px and imported layouts with up to 200 elements in files smaller than 1 MB. These are interactive-editor limits, separate from the upstream schema and your generation hardware's capacity.

## Run and verify

Serve this directory with a static HTTP server, then open `index.html`.

```sh
python3 -m http.server 8000
```

The test suite needs Node.js and Python 3, with no model weights or third-party Python packages:

```sh
node --test tests/layout.test.mjs
python3 tests/reference_check.py
```

For the browser checks, install Playwright and Chromium, then run:

```sh
python3 -m pip install -r requirements-dev.txt
python3 verify.py
```

The browser suite covers all three presets, exact JSON round trips and downloads, keyboard movement and resizing, real touch dragging and resizing, mobile layout, undo and redo, strict imports, literal HTML text, clipboard denial and outbound network isolation. It also accepts `--base-url` to check a hosted static deployment.

The reference check compares 494 accepted and rejected draft inputs with an unchanged, hash-checked copy of the pinned upstream Python compiler. It covers non-square canvases, random layouts, edge rounding, Unicode, optional metadata, invalid geometry, duplicate keys and integer-literal dimensions. The separate module tests exercise import/export and editor resize behavior.

## License

Apache-2.0. See `LICENSE` and `NOTICE` for the upstream compiler reference and browser adaptation.
