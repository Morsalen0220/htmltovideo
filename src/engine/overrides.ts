/**
 * Override engine — converts project edits into page-level changes.
 * Runs in both preview and render so both look identical.
 */

import type { ProjectData, ProjectScene, ProjectItem, ItemOverride, TextFx } from '../types/project';
import { animDef, fontStack, fontLink } from './fxDefs';

/**
 * Compute the original time for a given project time using piecewise-linear mapping.
 * This is how scene retiming works.
 */
export function remapTime(tMs: number, scenes: ProjectScene[]): number {
  // Find which scene we're in
  for (const scene of scenes) {
    if (tMs >= scene.start && tMs <= scene.end) {
      const sceneDuration = scene.end - scene.start;
      const origDuration = scene.orig.end - scene.orig.start;
      
      if (sceneDuration <= 0) return scene.orig.start;
      
      // Linear interpolation
      const progress = (tMs - scene.start) / sceneDuration;
      return scene.orig.start + progress * origDuration;
    }
  }
  
  // Before first scene
  if (scenes.length > 0 && tMs < scenes[0].start) {
    return scenes[0].orig.start;
  }
  
  // After last scene
  if (scenes.length > 0 && tMs > scenes[scenes.length - 1].end) {
    return scenes[scenes.length - 1].orig.end;
  }
  
  return tMs;
}

/**
 * Merge the user's style edits with the Position tab values.
 * Uses the CSS individual transform properties (translate / rotate / scale) so the page's own
 * `transform` animation keeps working on top of the user's move.
 * Numbers are kept as numbers here; the in-page runtime adds "px" where a length is needed
 * (this was the reason font-size / letter-spacing edits never showed up: "40" is not a valid CSS length).
 */
export function buildItemStyle(ov: ItemOverride): Record<string, unknown> | undefined {
  const style: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ov.style || {})) {
    if (v === undefined || v === null || v === '') continue;
    style[k] = k === 'fontFamily' && typeof v === 'string' ? fontStack(v) : v;
  }
  if (ov.posX !== undefined || ov.posY !== undefined || ov.scale !== undefined || ov.rotate !== undefined) {
    style.translate = `${ov.posX ?? 0}px ${ov.posY ?? 0}px`;
    style.rotate = `${ov.rotate ?? 0}deg`;
    style.scale = String(ov.scale ?? 1);
  }
  return Object.keys(style).length > 0 ? style : undefined;
}

/** Index of the <section> of the source page that a scene displays. */
export function sceneSection(scene: ProjectScene | undefined, scenes: ProjectScene[]): number {
  if (!scene) return 0;
  if (scene.section !== undefined) return scene.section;
  const m = /^scene-(\d+)$/.exec(scene.id);
  if (m) return parseInt(m[1], 10) - 1;
  return Math.max(0, scenes.findIndex(s => s.id === scene.id));
}

/** The scene that is "current" at a project time (the last scene once the playhead is past the end). */
export function activeSceneAt(scenes: ProjectScene[], tMs: number): ProjectScene | null {
  const hit = scenes.find(s => tMs >= s.start && tMs < s.end);
  if (hit) return hit;
  const past = scenes.filter(s => tMs >= s.end);
  return past.length ? past[past.length - 1] : (scenes[0] ?? null);
}

/** CSS properties of a container that should also reach its descendants. */
const CONTAINER_INHERIT = ['font-family', 'color', 'font-weight', 'letter-spacing', 'line-height', 'text-align', 'text-shadow'];

/**
 * Build the list of override commands for a given project time.
 * These are sent to the page and applied by the in-page runtime (engine/fxRuntime.ts),
 * both in the preview and in the export.
 *
 * Hidden items produce a `hidden` command (never skipped!): the runtime needs to know
 * about them every frame, so un-hiding restores the element exactly.
 */
export function buildOverrideCommands(
  tMs: number,
  project: ProjectData
): OverrideCommand[] {
  const commands: OverrideCommand[] = [];
  const scenes = project.scenes;
  const origMs = remapTime(tMs, scenes);
  const active = activeSceneAt(scenes, tMs);

  // When several items point at the same element (duplicated scenes share the page's DOM),
  // the one that belongs to the scene being shown wins.
  const owner = new Map<string, ProjectItem>();
  for (const item of project.items) {
    const cur = owner.get(item.selector);
    if (!cur || (active && item.sceneId === active.id && cur.sceneId !== active.id)) owner.set(item.selector, item);
  }

  for (const item of project.items) {
    if (owner.get(item.selector) !== item) continue;
    const scene = scenes.find(s => s.id === item.sceneId);
    const ov = item.override;

    const cmd: OverrideCommand = { selector: item.selector };
    if (item.hidden) { cmd.hidden = true; commands.push(cmd); continue; }

    // Timing overrides (data-attributes)
    if (ov.s !== undefined) cmd.s = ov.s;
    if (ov.d !== undefined) cmd.d = ov.d;
    if (ov.y !== undefined) cmd.y = ov.y;

    // Text override: only when the user actually changed the text
    // (replacing textContent would flatten nested markup like <em> and <br>)
    if (ov.text !== undefined && ov.text !== item.originalText) cmd.text = ov.text;

    // Style + position overrides
    const style = buildItemStyle(ov);
    if (style) cmd.style = style;
    const fam = typeof ov.style?.fontFamily === 'string' ? ov.style.fontFamily : undefined;
    if (fam) { cmd.fontFamily = fam.split(',')[0].replace(/["']/g, '').trim(); cmd.fontLink = fontLink(fam); }
    if (item.type === 'container' && style) cmd.inherit = CONTAINER_INHERIT;

    // Advanced typography effects
    if (ov.fx) {
      const fx: TextFx = { ...ov.fx };
      if (fx.anim?.type) fx.anim = { ...fx.anim, unit: animDef(fx.anim.type)?.unit ?? 'whole' } as TextFx['anim'];
      cmd.fx = fx;
      cmd.lt = Math.max(0, origMs - (scene ? scene.orig.start : 0)) / 1000;
    }

    // Copies of elements (copy / paste, duplicate)
    if (item.cloneOf) cmd.clone = { from: item.cloneOf, section: sceneSection(scene, scenes) };

    commands.push(cmd);
  }

  return commands;
}

/** A single override command sent to the page */
export interface OverrideCommand {
  selector: string;
  s?: number;
  d?: number;
  y?: number;
  text?: string;
  style?: Record<string, unknown>;
  hidden?: boolean;
  fx?: TextFx & { anim?: TextFx['anim'] & { unit?: string } };
  lt?: number;
  fontFamily?: string;
  fontLink?: string;
  inherit?: string[];
  clone?: { from: string; section: number };
}

/**
 * Generate the seek call script for the webview.
 * This calls seek(originalTime) then applies overrides.
 */
export function buildSeekScript(
  projectTimeMs: number,
  scenes: ProjectScene[],
  items: ProjectItem[]
): string {
  const originalTime = remapTime(projectTimeMs, scenes);
  
  const overrides = items
    .filter(item => !item.hidden && Object.keys(item.override).length > 0)
    .map(item => ({
      selector: item.selector,
      ...item.override
    }));
  
  return `
    (function() {
      const t = ${originalTime};
      const overrides = ${JSON.stringify(overrides)};
      if (window.__h2v) {
        window.__h2v.seek(t, overrides);
      } else if (typeof seek === 'function') {
        seek(t);
      }
    })()
  `;
}

/**
 * Calculate the total project duration based on scene times.
 */
export function getProjectDuration(scenes: ProjectScene[]): number {
  if (scenes.length === 0) return 0;
  return Math.max(...scenes.map(s => s.end));
}

/**
 * Get the current scene at a given time.
 */
export function getSceneAtTime(scenes: ProjectScene[], timeMs: number): ProjectScene | null {
  return scenes.find(s => timeMs >= s.start && timeMs < s.end) || null;
}

/**
 * Get items visible at a given time (within their scene's range).
 */
export function getItemsAtTime(project: ProjectData, timeMs: number): ProjectItem[] {
  const currentScene = getSceneAtTime(project.scenes, timeMs);
  if (!currentScene) return [];
  
  return project.items.filter(item => item.sceneId === currentScene.id && !item.hidden);
}
