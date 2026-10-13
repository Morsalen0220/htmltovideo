# h2video H2VID

**Convert seek-based HTML animations to MP4 video — desktop app for Windows, macOS, Linux.**

---

## ▶ Running the App

```powershell
cd "h2video-h2vid"

# Development mode (hot-reload)
npm run dev

# OR — production mode (pre-built):
npm run build
npm run start
```

> **First run**: `npm run dev` opens a Vite dev server on port 5173 then launches Electron.  
> `npm run build` compiles everything to `dist/` + `dist-electron/`.

---

## 📁 Sample Files

Three sample animations are in `samples/`:

| File | Duration | Scenes | Special |
|------|----------|--------|---------|
| `Bangladesh - 30s Promo.html` | 30 s | 6 | Best starting point |
| `gemini-code-*.html` | 30 s | 6 | Rain particles |
| `code_artifact.html` | 60 s | 8 | Web Audio (muted on import) |

---

## 🎬 How to Use

1. **Import** → Click `Import HTML` (or Ctrl+O) → select an HTML animation  
2. **Preview** → Press ▶ Play or drag the scrubber  
3. **Edit Layers** → Click a scene or item in the left Layer Tree  
4. **Edit Properties** → Right panel: Timing / Text / Scene / Audio tabs  
5. **Timeline** → Drag scene blocks to retime; drag edges to resize; Ctrl+Scroll to zoom  
6. **Audio** → Properties → Audio tab → Import music (mp3/wav/ogg/m4a)  
7. **Export** → Click 🎬 Export → choose resolution → Start Export → saves `.mp4`

### Keyboard shortcuts
| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `←` / `→` | Step 1 frame |
| `Shift+←` / `Shift+→` | Step 1 second |
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| `Ctrl+S` | Save project |
| `Ctrl+O` | Import HTML |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` / `Ctrl+D` | Copy / Cut / Paste / Duplicate the selected scene or elements |

---

## 🏗 Architecture

```
h2video-h2vid/
├── electron/
│   ├── main.ts         Electron main process + IPC + menus
│   ├── preload.ts      Secure contextBridge API for renderer
│   ├── ipc.ts          Render job IPC handlers
│   └── renderer.ts     Puppeteer frame capture + FFmpeg encode
├── src/
│   ├── App.tsx         Root: import/save/open/autosave
│   ├── app/Layout.tsx  4-panel layout (resizable handles)
│   ├── components/
│   │   ├── Preview/    Webview + neutralizer injections + playback
│   │   ├── LayerTree/  Scene+item tree, search, lock/hide, rename
│   │   ├── Timeline/   Canvas timeline, drag blocks, zoom, scrollbar
│   │   ├── Properties/ Timing / Text / Scene / Audio property tabs
│   │   └── Export/     Resolution presets, codec, CRF, progress bar
│   ├── engine/
│   │   ├── importer.ts HTML parser — extracts D, SC, items, stage
│   │   ├── overrides.ts Override engine (time remap + style injection)
│   │   ├── injectors.ts Neutralizer scripts (rAF freeze, PRNG, AudioCtx mute)
│   │   └── timeRemap.ts Piecewise-linear scene time mapping
│   ├── store/
│   │   └── project.ts  Zustand store + immer + zundo undo/redo (100 steps)
│   └── types/
│       └── project.d.ts Full TypeScript types for .h2v.json format
├── samples/            3 sample HTML animations
└── README.md
```

---

## ✅ Milestone Status

| # | Feature | Status |
|---|---------|--------|
| 1 | Import, live preview, layer tree, click-to-select | ✅ Done |
| 2 | 1080p render to MP4 (Puppeteer + FFmpeg) | ✅ Done |
| 3 | Timeline: drag blocks, playhead, zoom, scrollbar | ✅ Done |
| 4 | Properties panel, undo/redo (100 steps), autosave | ✅ Done |
| 5 | Audio tracks, volume, fade in/out, mixed export | ✅ Done |
| 6 | 4K export, parallel workers, progress, cancel | ✅ Done |
| 7 | Packaging (electron-builder) | ✅ Config done |

---

## 📦 Building Installer

```powershell
npm run package
# Output: dist-build/h2video H2VID Setup.exe  (Windows)
```

---

## 🔧 Project File Format

Projects save as `.h2v.json` (Ctrl+S). Re-open with Ctrl+Shift+O.  
The source HTML is **never modified** — all edits are stored as overrides.
