/**
 * Time remapping utilities (shared between engine and renderer).
 * Converts project-time to original-HTML-time using piecewise linear mapping.
 */

export interface SceneForRemap {
  start: number;  // project ms
  end: number;    // project ms
  orig: {
    start: number; // original HTML ms
    end: number;   // original HTML ms
  };
}

/**
 * Convert a project time (ms) to the original HTML time (ms).
 * This is the core of scene retiming: moving/stretching scenes in the
 * project maps proportionally to the original animation time.
 */
export function remapTime(tMs: number, scenes: SceneForRemap[]): number {
  if (scenes.length === 0) return tMs;

  for (const scene of scenes) {
    if (tMs >= scene.start && tMs <= scene.end) {
      const projDur = scene.end - scene.start;
      const origDur = scene.orig.end - scene.orig.start;
      if (projDur <= 0) return scene.orig.start;

      const t = (tMs - scene.start) / projDur;
      return scene.orig.start + t * origDur;
    }
  }

  // Before first scene
  if (tMs < scenes[0].start) return scenes[0].orig.start;

  // After last scene
  const last = scenes[scenes.length - 1];
  if (tMs > last.end) return last.orig.end;

  return tMs;
}

/**
 * Get the total project duration based on the last scene's end time.
 */
export function getProjectDuration(scenes: SceneForRemap[]): number {
  if (scenes.length === 0) return 0;
  return Math.max(...scenes.map(s => s.end));
}

/**
 * Get the scene that contains the given project time.
 */
export function getSceneAtTime<T extends SceneForRemap>(
  scenes: T[],
  timeMs: number
): T | null {
  return scenes.find(s => timeMs >= s.start && timeMs < s.end) ?? null;
}
