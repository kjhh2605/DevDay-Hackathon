# Immersive Shorts motion pack

An additive pack of screen workflows, creative transformations, and recording adapters. The original Motion Kit pieces remain available. Every new piece has `pack: immersive-2026-10` in its metadata and is discoverable through the existing `mk.py list` and `mk.py clip` commands.

Research and output are separate: `content/research/immersive-motion-20261002/` contains 28 primary-source references and 72 **candidates**. The actual implemented/rendered inventory is generated at `content/projects/immersive-motion-kit/catalog.json`; candidates are never counted as delivered assets.

## Browse and render

```sh
python3 scripts/motion-kit/immersive.py list
python3 scripts/motion-kit/immersive.py render create-prompt-image-grid
python3 scripts/motion-kit/immersive.py catalog
python3 scripts/motion-kit/immersive.py verify
python3 scripts/motion-kit/immersive.py package
```

`render` without a slug processes the entire pack. Each output passes HyperFrames `check`, then a 30 fps, 1080×830 encode and ffprobe checks. A receipt binds source files, shared runtime, variables, input-media bytes, MP4 bytes and poster bytes. Missing or replaced posters are regenerated from the verified MP4. Individual source downloads are fresh ZIPs with the runtime, not unhosted HTML pages. A same-named stale file is hidden from the catalog. Browser audit results are not a substitute for visual review; those observations are recorded separately in the output project.

The pack uses the existing pinned HyperFrames 0.8.105 renderer. Each piece has a single deterministic timeline, local fonts/runtime, and a Korean `prompt.md` that describes how to recreate its motion. No inference, image generation service, or paid video generation is used in the illustrative examples.

## Use an illustration in a Short

Read the piece's `meta.json`. Its `vars` identify replaceable values; action and result should agree with the narration. Create a JSON object with those keys, then:

```sh
python3 scripts/motion-kit/immersive.py clip create-prompt-image-grid \
  --vars /absolute/path/vars.json \
  --rev /absolute/path/to/shorts/revision --id image_result
```

The command exports a source and media-box clip using the selected Shorts format's live tokens (default `shorts-standard-v1.5`), verifies the clip through `kit.Footage`, and prints a complete locked manifest entry. The entry is also saved under `sources/motion-kit/<id>.entry.json`. Add it to the episode's existing footage manifest and place its ID in cuts, just as with any footage clip. It does not rewrite an episode's story, voice, captions or manifest. Existing IDs refuse replacement; use a new revision or ID.

The existing entry point also works for ordinary default/text-variable pieces:

```sh
python3 scripts/motion-kit/mk.py clip demo-command-palette-dive \
  --vars vars.json --rev /absolute/path/to/revision --id command_demo
```

## Use a real screen recording

`record-*` pieces declare `recording` in their variables. Pass a local video file:

```sh
python3 scripts/motion-kit/immersive.py render record-linked-loupe \
  --media /absolute/path/screen-recording.mp4 --vars vars.json

python3 scripts/motion-kit/immersive.py clip record-camera-tour \
  --media /absolute/path/screen-recording.mp4 --vars vars.json \
  --rev /absolute/path/to/revision --id screen_tour \
  --label '직접 촬영 · 도구 사용 화면'
```

The importer checks source duration, measures its aspect ratio, stages the exact file into the isolated build, and derives a first-frame poster when the piece needs one. Custom exports get a fingerprint suffix and never replace catalog examples. Audio is intentionally muted so the Short's narration and mix own sound. The camera coordinates are authored parameters, not automatic cursor tracking or semantic detection; adjust them for the recorded interface. A clip cannot truthfully demonstrate a feature its source never shows.

Creative pieces that declare `image` also accept `--image /absolute/path/image.png` (PNG/JPEG/WebP). The importer stages and fingerprints those bytes, and the generated default artwork remains explicitly illustrative. Relative image paths resolve inside the piece or its brand folder and their bytes are frozen. Remote/data URLs are refused; use `--media` for video and its derived first-frame poster. The metadata’s text limits are enforced before rendering, without truncation.

## Choose by the narration's job

| Job | Starting point |
| --- | --- |
| Show a command becoming an actual action | `demo-command-palette-dive`, `demo-node-connect-run` |
| Explain a tool's editing operation | `demo-inspector-live-style`, `demo-component-detach-edit` |
| Reveal an image result and selection | `create-prompt-image-grid`, `create-contact-sheet-select` |
| Explain still-to-motion production | `create-still-to-motion-strip`, `create-timeline-to-storyboard` |
| Land a phrase after showing the process | `create-image-to-type-poster`, `create-paragraph-to-headline` |
| Preserve real evidence while enlarging detail | `record-linked-loupe`, `record-context-inset` |
| Show a dependency, tradeoff or comparison | `explain-workflow-branch-decision`, `explain-feature-priority-matrix` |

Do not use all effects in a single Short. A useful starting sequence is a 4–7 second causal demonstration followed by a short result hold. The metadata includes entry/exit states, concrete Shorts placement and suggested sound cues. Rendered examples are silent; sound cues describe possible edits, not included licensed sound files.

## Quality pass (2026-10-03)

An audit of the rendered pack found it still for 77% of its frames (median longest hold 2.4 s, against 40% and 0.8 s for
the core kit), with 12–17 px labels and one shared illustration. Every piece now links `brand/immersive-life.css` and
`brand/immersive-life.js` and calls `IMM.life(tl)` right before its final `tl.seek(0)`:

- **Camera that follows the action.** It reads the piece's own timeline at setup: where the cursor moves and which
  elements change (box, opacity, stroke drawing, fill, colour). It eases in toward them shortly before they act, never
  zooms past the point where everything visible still fits, and settles into a slow push-in during holds. Screen and
  create pieces move a layer inside their clipping window, so the headline and footer stay fixed; explain and record
  pieces move the whole frame within a small cap that HyperFrames' `motion_off_frame` check enforces.
- **Fades become entrances.** Opacity-only entrances get a short rise and settle; elements a piece already moves are left alone.
- **Type floor.** `python3 scripts/motion-kit/immersive_type_floor.py` regenerates `immersive-life.css`: text under 18 px
  is raised by 25%, capped at 18 px.
- **Illustrations.** `IC.art` variants 4–7 add a city, a portrait, a product and a plant; single-image pieces whose
  prompts do not name the arch use them. Multi-take pieces keep one subject on purpose.
- **No cut lines.** The camera may push text fully out of frame but never leaves a line half across the edge: a cut
  frame eases toward the gentlest push-in that cuts nothing (centred, anchored to one edge for a title bar on the very
  edge, a half push, and only then the full frame), and the check runs again after smoothing. A line the piece itself
  already runs across an edge at the original framing (a clipped card, a scroll, a reveal) does not hold the camera back.
- **Per-piece polish (2026-10-04).** Pieces whose own animation cut text or held still: the asset list in
  `demo-drag-asset-drop` slides away before the hero punch-in; `demo-inspector-live-style` and
  `demo-responsive-canvas-reflow` punch in less or lower; `demo-version-history-peel` fans the cards inside the window;
  `demo-scrub-timeline-zoom` counter-scales its labels so the timeline zoom no longer stretches type; the text in
  `create-text-path-carousel` arrives at once; `create-workflow-oner` types its prompt over the first two seconds; and
  the five `explain-*` pieces end 1.5–2 s after their last action instead of holding for 2–3 s. Text crossing an
  edge on purpose (shutter reveals, the canvas pan, scrolling, the palette dive) is left as designed.

## Validation

```sh
python3 scripts/motion-kit/test_immersive.py
pnpm exec vitest run scripts/test/motion-pack.test.ts
pnpm -r typecheck
pnpm guard:no-api
```

Examples are in `scripts/motion-kit/examples/immersive-*.json`. The catalog includes individual source ZIPs plus bulk MP4 and source downloads.

The regression suite verifies changed-source and replaced-byte rejection, shared-runtime invalidation, input capability checks, unsafe slugs, and invalid variables preserving an existing build. Full repository tests additionally require an FFmpeg build with the `subtitles`/libass filter (the locally installed `ffmpeg-full` provides it).
