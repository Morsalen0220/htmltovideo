# What was fixed

1. **`npm run start` showed a blank window** (ERR_CONNECTION_REFUSED on localhost:5173).
   `electron/main.ts`: `isDev` was `NODE_ENV==='development' || !app.isPackaged`, which is always true when run from source.
   Now: `NODE_ENV==='development' && !app.isPackaged`.
2. **Preview kept playing by itself and fought the editor.** `src/components/Preview/Preview.tsx`: the neutralizer started with
   `_frozen = false`, so the page's own requestAnimationFrame loop kept calling seek(). Now starts frozen (`true`).
3. **Preview was tiny.** `<webview>` must stay `display:inline-flex`; it was forced to `block` (inline style and
   `Preview.css`). Fixed in both places.
4. **Scenes were detected wrongly** for files that write `const D=30000,SC=[[...]]` (the Bangladesh sample and any
   file declared that way). `src/engine/importer.ts` regex now also matches `,SC=`.
5. **Export would be shrunken with black bars.** `electron/renderer.ts` loaded the page without `?capture`, so the page's own
   fit() scaled the stage to ~90%. Now loads with `?capture` (via `pathToFileURL`, which also fixes Windows paths) and forces
   the stage to 1:1.
6. **Export memory at 4K:** frames are now written to FFmpeg with backpressure (waits for `drain`).
7. **Audio filter order:** trim -> fade-in -> volume -> delay -> fade-out (before, fade-in and trim ran after the delay).
8. `package.json`: `build` is now just `vite build` (the extra `tsc` step only produced a confusing
   `dist-electron/electron/` copy that is never used).

Export needs Chrome, Edge or Chromium installed (puppeteer-core does not download one),
or set PUPPETEER_EXECUTABLE_PATH.

## Round 2
9. **`SC` array with `//` comments** (e.g. `code_artifact.html`) was not detected, so scenes were split into equal parts
   (7.5 s each) instead of the real 7/8/8/8/8/8/7/6 s. `importer.ts` now scans the balanced bracket and ignores comments and
   trailing commas. Verified on all sample files.
10. In dev mode DevTools opened docked and squeezed the app; it now opens in a separate window (`mode: 'detach'`).

## Round 3
11. **Export produced only the first frame (ROOT CAUSE).** `NEUTRALIZE_SCRIPT` runs through `evaluateOnNewDocument`, i.e. before
    `<html>` exists. It did `(document.head || document.documentElement).appendChild(...)`, which threw
    `Cannot read properties of null (reading 'appendChild')`, so `window.__h2v` was never defined and every
    `__h2v?.seek()` call silently did nothing: all frames = frame 0. The style is now added when `<html>` exists,
    and the exporter fails with a clear error if the seek controller or the page's `seek()` is missing.
    Verified: 30 s promo -> 300 distinct frames across all scenes.
12. **New "Position" tab** (any selected item): Left / Right / Up / Down buttons with 1/5/10/50 px step, X/Y inputs,
    scale, rotate, reset. Uses CSS `translate`/`rotate`/`scale`, so it stacks on top of the page's own animation.
    Works in preview (live) and export. Files: `Properties/PositionTab.tsx`, `engine/overrides.ts`, `electron/renderer.ts`.
13. **Text overrides:** the importer pre-filled every item's text override with the raw source text, which showed
    `&amp;` literally and flattened markup such as `<br><em>RGB</em>`. Text is now only overridden when you edit it.
    (Re-import old projects.)
14. Preview now re-applies edits live while paused and during playback.

## Round 4 (copy/paste, live typography, eye icon, 4K, text effects — first half)
15. **Typography changes were not visible in the preview (ROOT CAUSES).**
    a) Numbers were sent as bare strings (`font-size: "48"`), which is invalid CSS, so size / letter-spacing edits were ignored.
       The in-page runtime now adds `px` where needed.
    b) Old values were never removed (clearing a field left the previous inline style). The runtime now remembers each element's
       original inline styles and restores them.
    c) Element selectors were positional (`section:nth-of-type(5) [data-s]:nth-child(2)`) and matched the wrong element, several
       elements, or nothing (7 of 47 items in `code_artifact.html` matched nothing). Items now use stable ids
       (`[data-h2v="d<section>-<n>"]`, `[data-h2t="<tag>-<section>-<n>"]`) assigned by the runtime. Re-import old projects.
    d) The Text tab is now also available for groups/cards (font family, colour, weight, spacing, alignment pass down to their text).
16. **Eye icon: hidden elements never came back (ROOT CAUSE).** Hiding set `display:none !important` inline and nothing ever removed it;
    hidden items were also dropped from the export. Hidden items are now sent every frame and the runtime restores the exact original state.
17. **4K could not be selected (ROOT CAUSE).** `<option>` used its label as value; HTML collapses repeated spaces, so
    `'4K    (3840×2160)'` never matched (720p and 1440p had the same bug). Presets now have ids. The exporter captures at the right scale
    and FFmpeg forces the exact output size (3840×2160) with aspect-ratio-safe padding. Verified: real 3840×2160 H.264 output.
18. **Copy / Cut / Paste / Duplicate** for scenes and elements (Layers panel buttons + Ctrl+C / X / V / D).
    Element copies are real clones of the page element (position, size, style, timing, text overrides are kept) and can be pasted into any scene.
    Scene copies reuse the same page section, are inserted after the selected scene (later scenes shift) and the project duration follows.
19. **Typography panel** with collapsible categories: Font & Style, Color & Gradient, Shadow & Depth (8 effects), Glow (6), Stroke & Outline (9),
    Background & Border, Transform. Font list previews every font (Bengali fonts with Bengali samples; Bengali fallback is always added).
    Preview and export use the same runtime (`src/engine/fxRuntime.ts`), so effects match in the exported video.
    Web fonts need internet (Google Fonts) unless the font is installed.

Not done yet (next round): the animated-typography UI (25 text animations; the engine for them already exists in fxRuntime.ts),
text mask, 3D typography, scene transitions for copied scenes.
