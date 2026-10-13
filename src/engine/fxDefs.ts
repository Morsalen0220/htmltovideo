/**
 * Catalog of typography options shared by the UI (TextTab) and the command builder (overrides.ts).
 * The rendering itself lives in fxRuntime.ts, which runs inside the page for BOTH the preview and the export.
 */

import type { FxParams } from '../types/project';

// ─── Fonts ──────────────────────────────────────────────────────────────────

export interface FontDef {
  name: string;
  /** Google Fonts family query (omit for fonts that ship with the OS) */
  google?: string;
  bengali?: boolean;
  /** Generic fallback */
  generic: 'sans-serif' | 'serif' | 'monospace' | 'cursive';
}

export const FONTS: FontDef[] = [
  // Bengali-capable
  { name: 'Noto Sans Bengali', google: 'Noto+Sans+Bengali:wght@400;600;700;800;900', bengali: true, generic: 'sans-serif' },
  { name: 'Hind Siliguri', google: 'Hind+Siliguri:wght@400;500;600;700', bengali: true, generic: 'sans-serif' },
  { name: 'Noto Serif Bengali', google: 'Noto+Serif+Bengali:wght@400;600;700;800;900', bengali: true, generic: 'serif' },
  { name: 'Baloo Da 2', google: 'Baloo+Da+2:wght@400;500;600;700;800', bengali: true, generic: 'sans-serif' },
  { name: 'Anek Bangla', google: 'Anek+Bangla:wght@400;500;600;700;800', bengali: true, generic: 'sans-serif' },
  { name: 'Mukta', google: 'Mukta:wght@400;500;600;700;800', bengali: true, generic: 'sans-serif' },
  { name: 'Tiro Bangla', google: 'Tiro+Bangla', bengali: true, generic: 'serif' },
  { name: 'Galada', google: 'Galada', bengali: true, generic: 'cursive' },
  { name: 'Atma', google: 'Atma:wght@400;500;600;700', bengali: true, generic: 'cursive' },
  { name: 'Nirmala UI', bengali: true, generic: 'sans-serif' },       // Windows
  { name: 'Vrinda', bengali: true, generic: 'sans-serif' },           // Windows
  // Latin
  { name: 'Poppins', google: 'Poppins:wght@400;600;700;800;900', generic: 'sans-serif' },
  { name: 'Inter', google: 'Inter:wght@400;600;700;800;900', generic: 'sans-serif' },
  { name: 'Roboto', google: 'Roboto:wght@400;500;700;900', generic: 'sans-serif' },
  { name: 'Montserrat', google: 'Montserrat:wght@400;600;700;800;900', generic: 'sans-serif' },
  { name: 'Oswald', google: 'Oswald:wght@400;600;700', generic: 'sans-serif' },
  { name: 'Bebas Neue', google: 'Bebas+Neue', generic: 'sans-serif' },
  { name: 'Anton', google: 'Anton', generic: 'sans-serif' },
  { name: 'Playfair Display', google: 'Playfair+Display:wght@400;600;700;800;900', generic: 'serif' },
  { name: 'Merriweather', google: 'Merriweather:wght@400;700;900', generic: 'serif' },
  { name: 'Pacifico', google: 'Pacifico', generic: 'cursive' },
  { name: 'Lobster', google: 'Lobster', generic: 'cursive' },
  { name: 'Caveat', google: 'Caveat:wght@400;600;700', generic: 'cursive' },
  { name: 'Orbitron', google: 'Orbitron:wght@400;600;700;900', generic: 'sans-serif' },
  { name: 'Press Start 2P', google: 'Press+Start+2P', generic: 'monospace' },
  { name: 'Fira Code', google: 'Fira+Code:wght@400;600;700', generic: 'monospace' },
  // System
  { name: 'Arial', generic: 'sans-serif' },
  { name: 'Segoe UI', generic: 'sans-serif' },
  { name: 'Georgia', generic: 'serif' },
  { name: 'Times New Roman', generic: 'serif' },
  { name: 'Impact', generic: 'sans-serif' },
  { name: 'Courier New', generic: 'monospace' }
];

/** Bengali-safe fallback chain appended to every font stack so Bengali glyphs always render. */
const BENGALI_FALLBACK = '"Noto Sans Bengali","Hind Siliguri","Nirmala UI","Vrinda"';

export function findFont(family?: string): FontDef | undefined {
  if (!family) return undefined;
  const first = family.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
  return FONTS.find(f => f.name.toLowerCase() === first);
}

/** CSS font-family value for a chosen family (adds quotes + Bengali fallback + generic). */
export function fontStack(family: string): string {
  if (family.includes(',')) return family; // user typed a full stack
  const f = findFont(family);
  const quoted = `"${family.replace(/["']/g, '')}"`;
  const generic = f?.generic ?? 'sans-serif';
  return `${quoted},${BENGALI_FALLBACK},${generic}`;
}

/** Stylesheet URL to load for a family (undefined for system fonts). */
export function fontLink(family?: string): string | undefined {
  const f = findFont(family);
  if (f?.google) return `https://fonts.googleapis.com/css2?family=${f.google}&display=swap`;
  // Unknown (user typed) family: try Google Fonts anyway — harmless if it does not exist.
  if (family && !f && !family.includes(',')) {
    return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family.trim()).replace(/%20/g, '+')}&display=swap`;
  }
  return undefined;
}

/** CSS used by the editor UI so the font list can preview each font (needs internet for Google fonts). */
export const UI_FONTS_CSS_URL =
  'https://fonts.googleapis.com/css2?' +
  FONTS.filter(f => f.google).map(f => 'family=' + f.google).join('&') +
  '&display=swap';

// ─── Effects (shadow / glow / stroke) ───────────────────────────────────────

export type FieldKey = keyof FxParams & string;

export interface FieldDef {
  key: FieldKey;
  label: string;
  kind: 'range' | 'color' | 'checkbox';
  min?: number;
  max?: number;
  step?: number;
}

export interface EffectDef {
  id: string;
  group: 'shadow' | 'glow' | 'stroke';
  label: string;
  hint?: string;
  fields: FieldDef[];
  defaults: FxParams;
}

const F = {
  color: (label = 'Color', key: FieldKey = 'color'): FieldDef => ({ key, label, kind: 'color' }),
  opacity: (): FieldDef => ({ key: 'opacity', label: 'Opacity', kind: 'range', min: 0, max: 1, step: 0.05 }),
  distance: (max = 60): FieldDef => ({ key: 'distance', label: 'Distance', kind: 'range', min: 0, max, step: 1 }),
  angle: (): FieldDef => ({ key: 'angle', label: 'Angle', kind: 'range', min: 0, max: 360, step: 1 }),
  blur: (max = 60): FieldDef => ({ key: 'blur', label: 'Blur', kind: 'range', min: 0, max, step: 1 }),
  spread: (): FieldDef => ({ key: 'spread', label: 'Spread', kind: 'range', min: 0, max: 20, step: 1 }),
  intensity: (): FieldDef => ({ key: 'intensity', label: 'Intensity', kind: 'range', min: 1, max: 5, step: 1 }),
  thickness: (max = 30): FieldDef => ({ key: 'thickness', label: 'Thickness', kind: 'range', min: 0, max, step: 0.5 }),
  offset: (): FieldDef => ({ key: 'offset', label: 'Offset', kind: 'range', min: 0, max: 30, step: 1 }),
  depth: (max = 120): FieldDef => ({ key: 'depth', label: 'Depth / Length', kind: 'range', min: 1, max, step: 1 }),
  speed: (): FieldDef => ({ key: 'speed', label: 'Pulse speed (Hz)', kind: 'range', min: 0.1, max: 5, step: 0.1 })
};

export const EFFECTS: EffectDef[] = [
  // ── Shadow & depth
  { id: 'drop', group: 'shadow', label: 'Drop Shadow',
    fields: [F.color(), F.opacity(), F.distance(), F.angle(), F.blur(), F.spread()],
    defaults: { color: '#000000', opacity: 0.6, distance: 8, angle: 45, blur: 6, spread: 0 } },
  { id: 'inner', group: 'shadow', label: 'Inner Shadow', hint: 'Shadow drawn inside the letters.',
    fields: [F.color(), F.opacity(), F.distance(30), F.angle(), F.blur(30)],
    defaults: { color: '#000000', opacity: 0.7, distance: 4, angle: 45, blur: 6 } },
  { id: 'long', group: 'shadow', label: 'Long Shadow',
    fields: [F.color(), F.opacity(), F.depth(200), F.angle()],
    defaults: { color: '#000000', opacity: 0.45, depth: 60, angle: 45 } },
  { id: 'soft', group: 'shadow', label: 'Soft Shadow',
    fields: [F.color(), F.opacity(), F.distance(), F.angle(), F.blur(100)],
    defaults: { color: '#000000', opacity: 0.4, distance: 12, angle: 90, blur: 32 } },
  { id: 'hard', group: 'shadow', label: 'Hard Shadow',
    fields: [F.color(), F.opacity(), F.distance(), F.angle(), F.spread()],
    defaults: { color: '#000000', opacity: 1, distance: 6, angle: 45, spread: 0 } },
  { id: 'multi', group: 'shadow', label: 'Multiple Shadow', hint: 'Three stacked shadows with their own colors.',
    fields: [F.color('Color 1'), F.color('Color 2', 'color2'), F.color('Color 3', 'color3'), F.opacity(), F.distance(40), F.angle(), F.blur(30)],
    defaults: { color: '#ff3d71', color2: '#ffd23f', color3: '#00e5ff', opacity: 1, distance: 6, angle: 45, blur: 0 } },
  { id: 'depth3d', group: 'shadow', label: '3D Text Depth', hint: 'Shaded extrusion with a contact shadow.',
    fields: [F.color(), F.depth(80), F.angle(), F.opacity()],
    defaults: { color: '#7c3aed', depth: 18, angle: 60, opacity: 1 } },
  { id: 'extrude', group: 'shadow', label: 'Extrude Effect', hint: 'Solid flat extrusion.',
    fields: [F.color(), F.depth(80), F.angle(), F.opacity()],
    defaults: { color: '#222222', depth: 14, angle: 45, opacity: 1 } },

  // ── Glow
  { id: 'outerGlow', group: 'glow', label: 'Outer Glow',
    fields: [F.color(), F.opacity(), F.blur(), F.intensity()],
    defaults: { color: '#00e5ff', opacity: 1, blur: 14, intensity: 2 } },
  { id: 'innerGlow', group: 'glow', label: 'Inner Glow', hint: 'Glow along the inside edge of the letters.',
    fields: [F.color(), F.opacity(), F.blur(30)],
    defaults: { color: '#ffffff', opacity: 0.9, blur: 6 } },
  { id: 'neon', group: 'glow', label: 'Neon Glow', hint: 'Bright core + coloured halo. Tints the text with the core colour.',
    fields: [F.color('Glow color'), F.color('Core color', 'color2'), F.blur(), F.intensity(), F.opacity(), { key: 'fillCore', label: 'Tint text with core', kind: 'checkbox' }],
    defaults: { color: '#ff2bd6', color2: '#ffffff', blur: 12, intensity: 3, opacity: 1, fillCore: true } },
  { id: 'softGlow', group: 'glow', label: 'Soft Glow',
    fields: [F.color(), F.opacity(), F.blur(120)],
    defaults: { color: '#ffd23f', opacity: 0.6, blur: 40 } },
  { id: 'multiGlow', group: 'glow', label: 'Multi-Color Glow',
    fields: [F.color('Color 1'), F.color('Color 2', 'color2'), F.color('Color 3', 'color3'), F.opacity(), F.blur()],
    defaults: { color: '#ff2bd6', color2: '#7c3aed', color3: '#00e5ff', opacity: 1, blur: 16 } },
  { id: 'animGlow', group: 'glow', label: 'Animated Glow', hint: 'Glow that pulses over time (plays in preview and export).',
    fields: [F.color(), F.opacity(), F.blur(), F.intensity(), F.speed()],
    defaults: { color: '#00ff9d', opacity: 1, blur: 18, intensity: 2, speed: 1 } },

  // ── Stroke & outline
  { id: 'outline', group: 'stroke', label: 'Stroke / Outline', hint: 'Centred on the letter edge.',
    fields: [F.color(), F.opacity(), F.thickness()],
    defaults: { color: '#000000', opacity: 1, thickness: 2 } },
  { id: 'strokeTop', group: 'stroke', label: 'Top Stroke',
    fields: [F.color(), F.opacity(), F.thickness(), F.offset()],
    defaults: { color: '#ffd23f', opacity: 1, thickness: 4, offset: 0 } },
  { id: 'strokeBottom', group: 'stroke', label: 'Bottom Stroke',
    fields: [F.color(), F.opacity(), F.thickness(), F.offset()],
    defaults: { color: '#ffd23f', opacity: 1, thickness: 4, offset: 0 } },
  { id: 'strokeLeft', group: 'stroke', label: 'Left Stroke',
    fields: [F.color(), F.opacity(), F.thickness(), F.offset()],
    defaults: { color: '#ffd23f', opacity: 1, thickness: 4, offset: 0 } },
  { id: 'strokeRight', group: 'stroke', label: 'Right Stroke',
    fields: [F.color(), F.opacity(), F.thickness(), F.offset()],
    defaults: { color: '#ffd23f', opacity: 1, thickness: 4, offset: 0 } },
  { id: 'strokeInner', group: 'stroke', label: 'Inner Stroke', hint: 'Stroke drawn only inside the letters.',
    fields: [F.color(), F.opacity(), F.thickness(15)],
    defaults: { color: '#000000', opacity: 1, thickness: 2 } },
  { id: 'strokeOuter', group: 'stroke', label: 'Outer Stroke', hint: 'Stroke drawn only outside the letters.',
    fields: [F.color(), F.opacity(), F.thickness()],
    defaults: { color: '#000000', opacity: 1, thickness: 4 } },
  { id: 'strokeDouble', group: 'stroke', label: 'Double Stroke',
    fields: [F.color('Inner color'), F.color('Outer color', 'color2'), F.opacity(), F.thickness(15)],
    defaults: { color: '#ffffff', color2: '#000000', opacity: 1, thickness: 3 } },
  { id: 'strokeMulti', group: 'stroke', label: 'Multi-Color Stroke',
    fields: [F.color('Color 1'), F.color('Color 2', 'color2'), F.color('Color 3', 'color3'), F.opacity(), F.thickness(12)],
    defaults: { color: '#ffd23f', color2: '#ff3d71', color3: '#7c3aed', opacity: 1, thickness: 3 } }
];

export function effectDef(id: string): EffectDef | undefined {
  return EFFECTS.find(e => e.id === id);
}

// ─── Animations ─────────────────────────────────────────────────────────────

export type AnimUnit = 'whole' | 'char' | 'word';

export interface AnimDef {
  id: string;
  label: string;
  unit: AnimUnit;
  /** which optional controls are meaningful for this animation */
  direction?: boolean;
  stagger?: boolean;
  intensity?: boolean;
  easing?: boolean;
  /** continuous animations keep running while "loop" is on, or for `duration` seconds otherwise */
  continuous?: boolean;
  defaults: { duration: number; stagger?: number; intensity?: number; direction?: 'up' | 'down' | 'left' | 'right'; easing?: string };
}

export const ANIMATIONS: AnimDef[] = [
  { id: 'typewriter', label: 'Typewriter', unit: 'char', defaults: { duration: 1.5 } },
  { id: 'letterReveal', label: 'Letter-by-Letter Reveal', unit: 'char', direction: true, stagger: true, intensity: true, easing: true, defaults: { duration: 0.5, stagger: 0.05, intensity: 1, direction: 'down', easing: 'easeOut' } },
  { id: 'wordReveal', label: 'Word-by-Word Reveal', unit: 'word', direction: true, stagger: true, intensity: true, easing: true, defaults: { duration: 0.6, stagger: 0.18, intensity: 1, direction: 'down', easing: 'easeOut' } },
  { id: 'fadeIn', label: 'Fade In', unit: 'whole', easing: true, defaults: { duration: 0.8, easing: 'easeOut' } },
  { id: 'fadeOut', label: 'Fade Out', unit: 'whole', easing: true, defaults: { duration: 0.8, easing: 'easeIn' } },
  { id: 'slideIn', label: 'Slide In', unit: 'whole', direction: true, intensity: true, easing: true, defaults: { duration: 0.8, intensity: 1, direction: 'left', easing: 'easeOut' } },
  { id: 'slideOut', label: 'Slide Out', unit: 'whole', direction: true, intensity: true, easing: true, defaults: { duration: 0.8, intensity: 1, direction: 'right', easing: 'easeIn' } },
  { id: 'zoomIn', label: 'Zoom In', unit: 'whole', easing: true, defaults: { duration: 0.8, easing: 'easeOut' } },
  { id: 'zoomOut', label: 'Zoom Out', unit: 'whole', easing: true, defaults: { duration: 0.8, easing: 'easeIn' } },
  { id: 'popUp', label: 'Pop-Up Text', unit: 'whole', defaults: { duration: 0.6 } },
  { id: 'bounce', label: 'Bounce Text', unit: 'char', stagger: true, intensity: true, defaults: { duration: 0.9, stagger: 0.06, intensity: 1 } },
  { id: 'elastic', label: 'Elastic Text', unit: 'char', stagger: true, defaults: { duration: 1.0, stagger: 0.05 } },
  { id: 'rotateIn', label: 'Rotate In', unit: 'whole', intensity: true, easing: true, defaults: { duration: 0.8, intensity: 1, easing: 'easeOut' } },
  { id: 'flip', label: 'Flip Text', unit: 'char', stagger: true, easing: true, defaults: { duration: 0.6, stagger: 0.05, easing: 'easeOut' } },
  { id: 'wave', label: 'Wave Text', unit: 'char', intensity: true, continuous: true, defaults: { duration: 3, intensity: 1 } },
  { id: 'shake', label: 'Text Shake', unit: 'whole', intensity: true, continuous: true, defaults: { duration: 1, intensity: 1 } },
  { id: 'glitch', label: 'Glitch Text', unit: 'whole', intensity: true, continuous: true, defaults: { duration: 1.5, intensity: 1 } },
  { id: 'neonFlicker', label: 'Neon Flicker', unit: 'whole', continuous: true, defaults: { duration: 2 } },
  { id: 'blurIn', label: 'Text Blur In', unit: 'whole', intensity: true, easing: true, defaults: { duration: 0.9, intensity: 1, easing: 'easeOut' } },
  { id: 'tracking', label: 'Tracking Reveal', unit: 'whole', intensity: true, easing: true, defaults: { duration: 1.2, intensity: 1, easing: 'easeOut' } },
  { id: 'maskReveal', label: 'Mask Reveal', unit: 'whole', direction: true, easing: true, defaults: { duration: 0.9, direction: 'left', easing: 'easeInOut' } },
  { id: 'wipe', label: 'Wipe Reveal', unit: 'whole', direction: true, easing: true, defaults: { duration: 1, direction: 'left', easing: 'easeInOut' } },
  { id: 'split', label: 'Split Text Animation', unit: 'char', stagger: true, intensity: true, easing: true, defaults: { duration: 0.7, stagger: 0.04, intensity: 1, easing: 'easeOut' } },
  { id: 'explosion', label: 'Text Explosion', unit: 'char', intensity: true, easing: true, defaults: { duration: 1.2, intensity: 1, easing: 'easeOut' } },
  { id: 'particles', label: 'Text Particles', unit: 'char', intensity: true, easing: true, defaults: { duration: 1.6, intensity: 1, easing: 'easeIn' } },
  { id: 'impact', label: 'Impact Text', unit: 'whole', intensity: true, defaults: { duration: 0.9, intensity: 1 } },
  { id: 'kinetic', label: 'Kinetic Typography', unit: 'word', stagger: true, intensity: true, defaults: { duration: 0.6, stagger: 0.2, intensity: 1 } },
  { id: 'looping', label: 'Looping Text Animation', unit: 'whole', intensity: true, continuous: true, defaults: { duration: 2, intensity: 1 } }
];

export function animDef(id?: string): AnimDef | undefined {
  return ANIMATIONS.find(a => a.id === id);
}

export const EASINGS = [
  { id: 'linear', label: 'Linear' },
  { id: 'easeIn', label: 'Ease In' },
  { id: 'easeOut', label: 'Ease Out' },
  { id: 'easeInOut', label: 'Ease In-Out' },
  { id: 'back', label: 'Back (overshoot)' },
  { id: 'bounce', label: 'Bounce' },
  { id: 'elastic', label: 'Elastic' },
  { id: 'expo', label: 'Expo Out' }
];

export const MASK_TYPES = [
  { id: 'fade-bottom', label: 'Fade out bottom' },
  { id: 'fade-top', label: 'Fade out top' },
  { id: 'fade-left', label: 'Fade out left' },
  { id: 'fade-right', label: 'Fade out right' },
  { id: 'radial', label: 'Radial (vignette)' },
  { id: 'stripes', label: 'Vertical stripes' },
  { id: 'diagonal', label: 'Diagonal stripes' }
];
