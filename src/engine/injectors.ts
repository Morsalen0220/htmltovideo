/**
 * Neutralizing injections for the HTML preview and render.
 * These scripts are injected BEFORE the page's own scripts run
 * to ensure deterministic, seek-controlled rendering.
 */

/**
 * The main injection script that neutralizes all non-deterministic behavior.
 * This runs in evaluateOnNewDocument / preload context.
 */
export const NEUTRALIZE_SCRIPT = `
(function() {
  'use strict';

  // ============================================================
  // 1. Freeze requestAnimationFrame so the page's own animation
  //    loop cannot overwrite editor-driven frames.
  //    We keep a stub that calls the callback once immediately
  //    so initialization code that uses rAF still runs.
  // ============================================================
  let _rafFrozen = false;
  const _originalRAF = window.requestAnimationFrame.bind(window);
  const _originalCAF = window.cancelAnimationFrame.bind(window);
  
  window.__h2v_enableRAF = function() { _rafFrozen = false; };
  window.__h2v_disableRAF = function() { _rafFrozen = true; };
  
  // Stub rAF — during seek mode, skip page animation loops
  window.requestAnimationFrame = function(cb) {
    if (_rafFrozen) {
      // Return a fake id but don't call cb (stops animation loops)
      return Math.random() * 1e9 | 0;
    }
    return _originalRAF(cb);
  };
  window.cancelAnimationFrame = function(id) {
    return _originalCAF(id);
  };

  // ============================================================
  // 2. Freeze Date.now and performance.now for determinism.
  //    seek() will update __h2v_time to the current seek time.
  // ============================================================
  window.__h2v_time = 0;
  const _originalDateNow = Date.now.bind(Date);
  const _originalPerfNow = performance.now.bind(performance);
  
  Date.now = function() {
    return _rafFrozen ? window.__h2v_time : _originalDateNow();
  };
  
  performance.now = function() {
    return _rafFrozen ? window.__h2v_time : _originalPerfNow();
  };

  // ============================================================
  // 3. Seeded PRNG (mulberry32) to replace Math.random.
  //    All random elements (rain, confetti, etc.) will be
  //    identical on every load and every render worker.
  // ============================================================
  let _seed = 1337;
  function mulberry32(a) {
    return function() {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  
  window.__h2v_rng = mulberry32(_seed);
  Math.random = function() { return window.__h2v_rng(); };
  window.__h2v_resetSeed = function(s) {
    _seed = s || 1337;
    window.__h2v_rng = mulberry32(_seed);
    Math.random = function() { return window.__h2v_rng(); };
  };

  // ============================================================
  // 4. Mute/stub AudioContext so page audio doesn't play.
  //    The editor's imported music replaces it.
  // ============================================================
  const _AudioContext = window.AudioContext || window.webkitAudioContext;
  if (_AudioContext) {
    const _originalAC = _AudioContext;
    window.AudioContext = window.webkitAudioContext = class SilentAudioContext extends _originalAC {
      constructor(options) {
        super(options);
        // Immediately suspend to silence
        this.suspend().catch(() => {});
      }
    };
  }

  // ============================================================
  // 5. Inject CSS to disable CSS transitions and animations.
  //    Only seek() controls visuals.
  // ============================================================
  function injectNoAnimationCSS() {
    const style = document.createElement('style');
    style.id = '__h2v_no_anim';
    // Note: we use a class-based approach so we can toggle it
    style.textContent = [
      '.h2v-seek-mode *, .h2v-seek-mode *::before, .h2v-seek-mode *::after {',
      '  transition: none !important;',
      '  animation-play-state: paused !important;',
      '}'
    ].join('\\n');
    
    if (document.head) {
      document.head.appendChild(style);
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        document.head.appendChild(style);
      });
    }
  }
  
  injectNoAnimationCSS();

  // ============================================================
  // 6. The h2v controller object — exposed for the editor to use
  // ============================================================
  window.__h2v = {
    // Enter seek mode: freeze rAF, enable CSS no-animation
    enterSeekMode: function() {
      _rafFrozen = true;
      document.body.classList.add('h2v-seek-mode');
    },
    // Exit seek mode: allow rAF (for live preview play)
    exitSeekMode: function() {
      _rafFrozen = false;
      document.body.classList.remove('h2v-seek-mode');
    },
    // Seek to a time in ms and update frozen clocks
    seek: function(ms, overrides) {
      window.__h2v_time = ms;
      if (typeof window.seek === 'function') {
        window.seek(ms);
      }
      try {
        if (document.getAnimations) {
          var anims = document.getAnimations();
          for (var i = 0; i < anims.length; i++) anims[i].currentTime = ms;
        }
      } catch(e) {}
      if (overrides) window.__h2v_applyOverrides(overrides);
    },
    // Apply item overrides after seek
    applyOverrides: function(overrides) {
      if (window.__h2v_applyOverrides) window.__h2v_applyOverrides(overrides);
    }
  };

  // ============================================================
  // 7. Override application function
  //    Called after seek() to apply editor changes to elements
  // ============================================================
  window.__h2v_applyOverrides = function(overrides) {
    if (!overrides || !Array.isArray(overrides)) return;
    
    overrides.forEach(function(override) {
      try {
        const el = document.querySelector(override.selector);
        if (!el) return;

        // Apply data-attribute overrides (timing)
        if (override.s !== undefined) el.dataset.s = String(override.s);
        if (override.d !== undefined) el.dataset.d = String(override.d);
        if (override.y !== undefined) el.dataset.y = String(override.y);

        // Apply text content
        if (override.text !== undefined) {
          // Set after seek so it overrides page code
          el.__h2v_text = override.text;
        }

        // Apply CSS styles
        if (override.style) {
          Object.entries(override.style).forEach(function([key, value]) {
            try {
              el.style.setProperty(
                key.replace(/([A-Z])/g, '-$1').toLowerCase(),
                String(value),
                'important'
              );
            } catch(e) {}
          });
        }

        // Apply hidden
        if (override.hidden !== undefined) {
          el.style.setProperty('display', override.hidden ? 'none' : '', 'important');
        }
      } catch(e) {
        // Ignore errors for missing elements
      }
    });

    // Apply text overrides after seek (wins over page code)
    overrides.forEach(function(override) {
      if (override.text === undefined) return;
      try {
        const el = document.querySelector(override.selector);
        if (el && el.__h2v_text !== undefined) {
          el.textContent = el.__h2v_text;
          delete el.__h2v_text;
        }
      } catch(e) {}
    });
  };

  console.log('[H2V] Injections applied - seek-controlled rendering active');
})();
`;

/**
 * CSS that ensures the stage is properly positioned for screenshot capture.
 */
export const CAPTURE_CSS = `
  body { margin: 0 !important; padding: 0 !important; overflow: hidden !important; }
  #wrap { position: fixed !important; top: 0 !important; left: 0 !important; margin: 0 !important; }
  #ctl, #controls, .controls, [id*="control"], #bar:has(button):has(input[type="range"]) { display: none !important; }
`;

/**
 * Script that fixes the Google Fonts URL issue:
 * The samples use Hind_Siliguri (underscores) but correct is Hind Siliguri (spaces).
 * This runs after the page loads to fix any failed font loads.
 */
export const FONT_FIX_SCRIPT = `
(function() {
  // Fix Google Fonts URLs: replace underscores in family names with spaces
  document.querySelectorAll('link[href*="fonts.googleapis.com"]').forEach(function(link) {
    const url = new URL(link.href);
    const family = url.searchParams.get('family');
    if (family && family.includes('_')) {
      const fixed = family.replace(/_/g, '+');
      url.searchParams.set('family', fixed);
      link.href = url.toString();
    }
  });
  console.log('[H2V] Font URLs normalized');
})();
`;

/**
 * Build the scene override script for time remapping.
 * Patches the SC array and D constant in the page.
 */
export function buildSceneOverrideScript(scenes: Array<{ orig: { start: number; end: number } }>): string {
  const scArray = scenes.map(s => [s.orig.start / 1000, s.orig.end / 1000]);
  return `
(function() {
  // Override SC (scene times) with project values
  try {
    if (typeof SC !== 'undefined') {
      // Reassign if it's a let/var
      SC.length = 0;
      ${JSON.stringify(scArray)}.forEach(function(pair) { SC.push(pair); });
    }
  } catch(e) {
    console.warn('[H2V] Could not override SC:', e);
  }
  console.log('[H2V] Scene times applied');
})();
`;
}
