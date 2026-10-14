import { create } from 'zustand';
import { temporal } from 'zundo';
import { immer } from 'zustand/middleware/immer';
import type {
  ProjectData,
  ProjectScene,
  ProjectItem,
  AudioClip,
  AudioAsset,
  ExportSettings,
  SelectionState,
  ItemOverride,
  ImportReport
} from '../types/project';

/** Default export settings */
const DEFAULT_EXPORT: ExportSettings = {
  width: 1920,
  height: 1080,
  fps: 30,
  codec: 'h264',
  crf: 18
};

/** Default project data */
function createEmptyProject(): ProjectData {
  return {
    version: 1,
    source: {
      file: '',
      duration: 30000,
      stage: { w: 1280, h: 720 }
    },
    scenes: [],
    items: [],
    audio: [],
    audioAssets: [],
    export: { ...DEFAULT_EXPORT }
  };
}

/** Internal clipboard (UI state, not part of the project file / undo history) */
export type ClipboardData =
  | { kind: 'items'; items: ProjectItem[] }
  | { kind: 'scene'; scene: ProjectScene; items: ProjectItem[] };

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

function nextNumericId(prefix: string, ids: string[]): number {
  let max = 0;
  for (const id of ids) {
    const m = new RegExp('^' + prefix + '-(\\d+)$').exec(id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

/** Section of the source page a scene displays */
function sectionOf(scene: ProjectScene, scenes: ProjectScene[]): number {
  if (scene.section !== undefined) return scene.section;
  const m = /^scene-(\d+)$/.exec(scene.id);
  return m ? parseInt(m[1], 10) - 1 : Math.max(0, scenes.findIndex(x => x.id === scene.id));
}

/** Project duration follows the end of the last scene (scenes can be copied past the original end). */
function syncDuration(project: ProjectData) {
  if (project.scenes.length) project.source.duration = Math.max(...project.scenes.map(sc => sc.end));
}

/** Application state shape */
export interface AppState {
  // Clipboard (not persisted)
  clipboard: ClipboardData | null;

  // Project data (persisted)
  project: ProjectData;
  projectFilePath: string | null;
  isModified: boolean;

  // UI state (not persisted in project file)
  selection: SelectionState;
  currentTimeMs: number;      // Playhead position
  isPlaying: boolean;
  importReport: ImportReport | null;
  isLoading: boolean;
  loadingMessage: string;

  // Actions
  setProject: (project: ProjectData) => void;
  setProjectFilePath: (path: string | null) => void;
  updateSource: (source: Partial<ProjectData['source']>) => void;
  
  // Scene actions
  addScene: (scene: ProjectScene) => void;
  updateScene: (id: string, changes: Partial<ProjectScene>) => void;
  removeScene: (id: string) => void;
  reorderScenes: (sceneIds: string[]) => void;

  // Item actions
  addItem: (item: ProjectItem) => void;
  updateItem: (id: string, changes: Partial<ProjectItem>) => void;
  updateItemOverride: (id: string, override: Partial<ItemOverride>) => void;
  removeItem: (id: string) => void;
  removeItemsByScene: (sceneId: string) => void;

  // Audio actions
  addAudio: (clip: AudioClip) => void;
  addAudioAsset: (asset: AudioAsset) => void;
  removeAudioAsset: (id: string) => void;
  updateAudio: (id: string, changes: Partial<AudioClip>) => void;
  removeAudio: (id: string) => void;
  splitAudio: (id: string, atMs: number, sourceDuration?: number) => string | null;

  // Export settings
  updateExportSettings: (settings: Partial<ExportSettings>) => void;

  // Selection
  selectScene: (id: string | null) => void;
  selectItem: (id: string, multi?: boolean) => void;
  selectAudio: (id: string | null) => void;
  clearSelection: () => void;
  setHoveredItem: (id: string | null) => void;

  // Playback
  setCurrentTime: (ms: number) => void;
  setPlaying: (playing: boolean) => void;

  // Import
  setImportReport: (report: ImportReport | null) => void;
  setLoading: (loading: boolean, message?: string) => void;

  // Copy / cut / paste / duplicate (scenes and elements)
  copySelection: () => boolean;
  cutSelection: () => boolean;
  pasteClipboard: () => boolean;
  duplicateSelection: () => boolean;
  deleteSelection: () => boolean;

  // Project management
  markModified: () => void;
  markSaved: () => void;
  resetProject: () => void;
}

/** Create the project store with undo/redo support */
export const useProjectStore = create<AppState>()(
  temporal(
    immer((set, get) => ({
      clipboard: null,
      project: createEmptyProject(),
      projectFilePath: null,
      isModified: false,
      selection: {
        selectedSceneId: null,
        selectedItemIds: [],
        selectedAudioId: null,
        hoveredItemId: null
      },
      currentTimeMs: 0,
      isPlaying: false,
      importReport: null,
      isLoading: false,
      loadingMessage: '',

      setProject: (project) => {
        set((state) => {
          if (!project.audioAssets) project.audioAssets = [];
          state.project = project;
          state.isModified = false;
          state.currentTimeMs = 0;
          state.isPlaying = false;
          state.selection = { selectedSceneId: null, selectedItemIds: [], selectedAudioId: null, hoveredItemId: null };
        });
        // A newly opened/imported project must not be undoable back into the previous project.
        useProjectStore.temporal.getState().clear();
      },

      setProjectFilePath: (path) => set((state) => {
        state.projectFilePath = path;
      }),

      updateSource: (source) => set((state) => {
        Object.assign(state.project.source, source);
        state.isModified = true;
      }),

      // Scenes
      addScene: (scene) => set((state) => {
        state.project.scenes.push(scene);
        state.isModified = true;
      }),

      updateScene: (id, changes) => set((state) => {
        const idx = state.project.scenes.findIndex(s => s.id === id);
        if (idx >= 0) {
          Object.assign(state.project.scenes[idx], changes);
          state.isModified = true;
        }
      }),

      removeScene: (id) => set((state) => {
        const scene = state.project.scenes.find(s => s.id === id);
        if (!scene) return;
        const duration = scene.end - scene.start;
        state.project.scenes = state.project.scenes.filter(s => s.id !== id);
        state.project.items = state.project.items.filter(i => i.sceneId !== id);
        state.project.scenes.forEach(item => { if (item.start >= scene.end) { item.start -= duration; item.end -= duration; } });
        if (state.selection.selectedSceneId === id) state.selection.selectedSceneId = null;
        syncDuration(state.project);
        state.isModified = true;
      }),

      reorderScenes: (sceneIds) => set((state) => {
        const ordered = sceneIds.map(id => state.project.scenes.find(s => s.id === id)!).filter(Boolean);
        state.project.scenes = ordered;
        state.isModified = true;
      }),

      // Items
      addItem: (item) => set((state) => {
        state.project.items.push(item);
        state.isModified = true;
      }),

      updateItem: (id, changes) => set((state) => {
        const idx = state.project.items.findIndex(i => i.id === id);
        if (idx >= 0) {
          Object.assign(state.project.items[idx], changes);
          state.isModified = true;
        }
      }),

      updateItemOverride: (id, override) => set((state) => {
        const idx = state.project.items.findIndex(i => i.id === id);
        if (idx >= 0) {
          Object.assign(state.project.items[idx].override, override);
          state.isModified = true;
        }
      }),

      removeItem: (id) => set((state) => {
        state.project.items = state.project.items.filter(i => i.id !== id);
        state.isModified = true;
      }),

      removeItemsByScene: (sceneId) => set((state) => {
        state.project.items = state.project.items.filter(i => i.sceneId !== sceneId);
        state.isModified = true;
      }),

      // Audio
      addAudio: (clip) => set((state) => {
        state.project.audio.push(clip);
        state.isModified = true;
      }),

      addAudioAsset: (asset) => set((state) => {
        if (!state.project.audioAssets) state.project.audioAssets = [];
        if (!state.project.audioAssets.some(item => item.file === asset.file)) state.project.audioAssets.push(asset);
        state.isModified = true;
      }),

      removeAudioAsset: (id) => set((state) => {
        if (state.project.audioAssets) state.project.audioAssets = state.project.audioAssets.filter(asset => asset.id !== id);
        state.isModified = true;
      }),

      updateAudio: (id, changes) => set((state) => {
        const idx = state.project.audio.findIndex(a => a.id === id);
        if (idx >= 0) {
          Object.assign(state.project.audio[idx], changes);
          state.isModified = true;
        }
      }),

      removeAudio: (id) => set((state) => {
        state.project.audio = state.project.audio.filter(a => a.id !== id);
        if (state.selection.selectedAudioId === id) state.selection.selectedAudioId = null;
        state.isModified = true;
      }),

      splitAudio: (id, atMs, sourceDuration) => {
        let newId: string | null = null;
        set((state) => {
          const index = state.project.audio.findIndex(clip => clip.id === id);
          if (index < 0) return;
          const clip = state.project.audio[index];
          const duration = clip.duration ?? sourceDuration;
          if (!duration) return;
          const clipEnd = clip.start + duration - clip.trimIn - clip.trimOut;
          if (atMs <= clip.start + 50 || atMs >= clipEnd - 50) return;
          const sourceSplit = clip.trimIn + atMs - clip.start;
          const right: AudioClip = {
            ...clip,
            id: `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: `${clip.name} (2)`,
            start: atMs,
            trimIn: sourceSplit,
            fadeIn: 0
          };
          clip.trimOut = duration - sourceSplit;
          clip.fadeOut = 0;
          state.project.audio.splice(index + 1, 0, right);
          state.selection.selectedAudioId = right.id;
          newId = right.id;
          state.isModified = true;
        });
        return newId;
      },

      // Export settings
      updateExportSettings: (settings) => set((state) => {
        Object.assign(state.project.export, settings);
        state.isModified = true;
      }),

      // Selection (not included in undo history)
      selectScene: (id) => set((state) => {
        state.selection.selectedSceneId = id;
        state.selection.selectedItemIds = [];
        state.selection.selectedAudioId = null;
      }),

      selectItem: (id, multi = false) => set((state) => {
        state.selection.selectedAudioId = null;
        if (multi) {
          if (state.selection.selectedItemIds.includes(id)) {
            state.selection.selectedItemIds = state.selection.selectedItemIds.filter(i => i !== id);
          } else {
            state.selection.selectedItemIds.push(id);
          }
        } else {
          state.selection.selectedItemIds = [id];
          // Find the scene for this item
          const item = state.project.items.find(i => i.id === id);
          if (item) state.selection.selectedSceneId = item.sceneId;
        }
      }),

      selectAudio: (id) => set((state) => {
        state.selection.selectedAudioId = id;
        if (id) {
          state.selection.selectedSceneId = null;
          state.selection.selectedItemIds = [];
        }
      }),

      clearSelection: () => set((state) => {
        state.selection.selectedSceneId = null;
        state.selection.selectedItemIds = [];
        state.selection.selectedAudioId = null;
      }),

      setHoveredItem: (id) => set((state) => {
        state.selection.hoveredItemId = id;
      }),

      // Playback
      setCurrentTime: (ms) => set((state) => {
        state.currentTimeMs = ms;
      }),

      setPlaying: (playing) => set((state) => {
        state.isPlaying = playing;
      }),

      // Import
      setImportReport: (report) => set((state) => {
        state.importReport = report;
      }),

      setLoading: (loading, message = '') => set((state) => {
        state.isLoading = loading;
        state.loadingMessage = message;
      }),


      // ── Copy / cut / paste / duplicate ──────────────────────────────────────
      copySelection: () => {
        const { project, selection } = get();
        if (selection.selectedItemIds.length > 0) {
          const items = project.items.filter(i => selection.selectedItemIds.includes(i.id));
          if (!items.length) return false;
          set((state) => { state.clipboard = { kind: 'items', items: clone(items) }; });
          return true;
        }
        const scene = project.scenes.find(sc => sc.id === selection.selectedSceneId);
        if (!scene) return false;
        set((state) => {
          state.clipboard = { kind: 'scene', scene: clone(scene), items: clone(project.items.filter(i => i.sceneId === scene.id)) };
        });
        return true;
      },

      cutSelection: () => {
        if (!get().copySelection()) return false;
        set((state) => {
          const sel = state.selection;
          if (sel.selectedItemIds.length > 0) {
            state.project.items = state.project.items.filter(i => !sel.selectedItemIds.includes(i.id));
            sel.selectedItemIds = [];
          } else if (sel.selectedSceneId) {
            const sc = state.project.scenes.find(x => x.id === sel.selectedSceneId);
            if (sc) {
              const dur = sc.end - sc.start;
              state.project.scenes = state.project.scenes.filter(x => x.id !== sc.id);
              state.project.items = state.project.items.filter(i => i.sceneId !== sc.id);
              // ripple: close the gap
              state.project.scenes.forEach(x => { if (x.start >= sc.end) { x.start -= dur; x.end -= dur; } });
              syncDuration(state.project);
            }
            sel.selectedSceneId = null;
          }
          state.isModified = true;
        });
        return true;
      },

      pasteClipboard: () => {
        const clip = get().clipboard;
        if (!clip) return false;
        set((state) => {
          const p = state.project;
          if (clip.kind === 'items') {
            const target = p.scenes.find(sc => sc.id === state.selection.selectedSceneId) ?? p.scenes[0];
            if (!target) return;
            let n = nextNumericId('item', p.items.map(i => i.id));
            const created: string[] = [];
            for (const src of clip.items) {
              const id = `item-${n++}`;
              const it: ProjectItem = clone(src);
              it.id = id;
              it.sceneId = target.id;
              it.cloneOf = src.cloneOf ?? src.selector;       // the page element this copy is cloned from
              it.selector = `[data-h2v="c-${id}"]`;
              it.name = `${src.name} copy`;
              if (src.sceneId === target.id) {                 // same scene: nudge so the copy is visible
                it.override.posX = (it.override.posX ?? 0) + 24;
                it.override.posY = (it.override.posY ?? 0) + 24;
              }
              p.items.push(it);
              created.push(id);
            }
            state.selection.selectedSceneId = target.id;
            state.selection.selectedItemIds = created;
          } else {
            // Scene: insert after the selected scene (or at the end), same page section + same overrides, ripple later scenes
            const afterIdx = p.scenes.findIndex(sc => sc.id === state.selection.selectedSceneId);
            const at = afterIdx >= 0 ? p.scenes[afterIdx].end : Math.max(0, ...p.scenes.map(sc => sc.end));
            const dur = clip.scene.end - clip.scene.start;
            p.scenes.forEach(x => { if (x.start >= at) { x.start += dur; x.end += dur; } });
            const sid = `scene-copy-${nextNumericId('scene-copy', p.scenes.map(sc => sc.id))}`;
            const sc: ProjectScene = clone(clip.scene);
            sc.id = sid;
            sc.name = `${clip.scene.name} copy`;
            sc.start = at;
            sc.end = at + dur;
            sc.section = sectionOf(clip.scene, p.scenes);
            p.scenes.splice(afterIdx >= 0 ? afterIdx + 1 : p.scenes.length, 0, sc);
            // Copies of elements already live in the page's section, so only plain items are duplicated here.
            let n = nextNumericId('item', p.items.map(i => i.id));
            for (const src of clip.items) {
              if (src.cloneOf) continue;
              const it: ProjectItem = clone(src);
              it.id = `item-${n++}`;
              it.sceneId = sid;
              p.items.push(it);
            }
            syncDuration(p);
            state.selection.selectedSceneId = sid;
            state.selection.selectedItemIds = [];
          }
          state.isModified = true;
        });
        return true;
      },

      duplicateSelection: () => {
        const prev = get().clipboard;
        if (!get().copySelection()) return false;
        const ok = get().pasteClipboard();
        set((state) => { state.clipboard = prev; });  // duplicate does not touch what the user copied before
        return ok;
      },

      deleteSelection: () => {
        const state = get();
        const { selectedAudioId, selectedItemIds, selectedSceneId } = state.selection;
        if (selectedAudioId) { get().removeAudio(selectedAudioId); return true; }
        if (selectedItemIds.length) {
          set((draft) => {
            draft.project.items = draft.project.items.filter(item => !selectedItemIds.includes(item.id));
            draft.selection.selectedItemIds = [];
            draft.isModified = true;
          });
          return true;
        }
        if (selectedSceneId) { get().removeScene(selectedSceneId); return true; }
        return false;
      },

      // Project management
      markModified: () => set((state) => {
        state.isModified = true;
      }),

      markSaved: () => set((state) => {
        state.isModified = false;
      }),

      resetProject: () => {
        set((state) => {
          state.project = createEmptyProject();
          state.projectFilePath = null;
          state.isModified = false;
          state.selection = { selectedSceneId: null, selectedItemIds: [], selectedAudioId: null, hoveredItemId: null };
          state.currentTimeMs = 0;
          state.isPlaying = false;
          state.importReport = null;
        });
        useProjectStore.temporal.getState().clear();
      }
    })),
    {
      // Only include project changes in undo history
      partialize: (state) => ({ project: state.project }),
      limit: 100
    }
  )
);

/** Get the temporal store for undo/redo */
export const useTemporalStore = () => useProjectStore.temporal;
