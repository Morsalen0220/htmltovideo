import React, { useEffect, useRef, useCallback, useState } from 'react';
import { useProjectStore } from '../../store/project';
import { remapTime, buildOverrideCommands } from '../../engine/overrides';
import { FX_RUNTIME } from '../../engine/fxRuntime';
import './Preview.css';

/**
 * Preview component — renders the HTML animation inside a sandboxed webview.
 * Writes the injected HTML to a temp file so Electron can load it via file://
 * (data: URLs are blocked in Electron webviews by default).
 */

// Typed webview handle
type WebviewEl = HTMLElement & {
  src: string;
  executeJavaScript: (code: string) => Promise<unknown>;
  addEventListener: (event: string, cb: (...args: unknown[]) => void) => void;
  removeEventListener: (event: string, cb: (...args: unknown[]) => void) => void;
  getWebContentsId: () => number;
};


const Preview: React.FC = () => {
  const webviewRef   = useRef<WebviewEl | null>(null);
  const rafRef       = useRef<number | null>(null);
  const playbackGenerationRef = useRef(0);
  const pbRef        = useRef({ playing: false, startTime: 0, baseMs: 0 });
  const lastSeekRef  = useRef<number>(-1);
  const readyRef     = useRef(false);
  const readyHtmlRef = useRef<string | null>(null);
  const loadGenerationRef = useRef(0);
  const seekInFlightRef = useRef(false);
  const pendingSeekRef = useRef<{ webview: WebviewEl; code: string; generation: number; html: string } | null>(null);
  const flushSeekRef = useRef<() => void>(() => {});
  const loadListenersRef = useRef<{ webview: WebviewEl; domReady: (...args: unknown[]) => void; finish: (...args: unknown[]) => void; fail: (...args: unknown[]) => void; console: (...args: unknown[]) => void } | null>(null);
  const runtimeErrorKeysRef = useRef(new Set<string>());
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioBuffersRef = useRef(new Map<string, AudioBuffer>());
  const {
    project,
    currentTimeMs,
    isPlaying,
    setCurrentTime,
    setPlaying,
  } = useProjectStore();
  const currentTimeRef = useRef(currentTimeMs);
  currentTimeRef.current = currentTimeMs;

  const [webviewReady, setWebviewReady] = useState(false);
  const [scale, setScale]               = useState(1);
  const [loadError, setLoadError]       = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep at most one webview seek in flight. Playback can request a frame every
  // animation tick; replacing a pending request with the newest frame prevents
  // slow HTML/SVG pages from building a queue that makes Pause feel unresponsive.
  flushSeekRef.current = () => {
    if (seekInFlightRef.current) return;
    const request = pendingSeekRef.current;
    if (!request) return;
    if (request.webview !== webviewRef.current
      || request.generation !== loadGenerationRef.current
      || !readyRef.current
      || request.html !== readyHtmlRef.current) {
      pendingSeekRef.current = null;
      return;
    }
    pendingSeekRef.current = null;
    seekInFlightRef.current = true;
    void Promise.resolve()
      .then(() => request.webview.executeJavaScript(request.code))
      .catch(error => console.debug('[Preview] Seek skipped while webview is navigating', error))
      .finally(() => {
        seekInFlightRef.current = false;
        flushSeekRef.current();
      });
  };

  // Imported music is intentionally outside the webview (the HTML's own audio
  // is muted for deterministic frame seeking). Decode it here and schedule it
  // against the editor playhead so preview and export use the same audio clips.
  useEffect(() => {
    const context = audioContextRef.current;
    if (!context) return;
    const validIds = new Set(project.audio.map(clip => clip.id));
    for (const id of audioBuffersRef.current.keys()) if (!validIds.has(id)) audioBuffersRef.current.delete(id);
  }, [project.audio]);

  const stopAudioRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!isPlaying) {
      stopAudioRef.current();
      return;
    }

    let cancelled = false;
    const sources: AudioBufferSourceNode[] = [];
    stopAudioRef.current = () => {
      cancelled = true;
      sources.forEach(source => { try { source.stop(); } catch { /* already stopped */ } });
    };

    const startAudio = async () => {
      if (!project.audio.length) return;
      const context = audioContextRef.current ?? new AudioContext();
      audioContextRef.current = context;
      try { await context.resume(); } catch { /* playback will report/skip if unavailable */ }

      for (const clip of project.audio) {
        if (cancelled) return;
        let buffer = audioBuffersRef.current.get(clip.id);
        if (!buffer) {
          try {
            const result = await window.electronAPI?.readFileBinary(clip.file);
            if (!result?.success || !result.data) continue;
            const bytes = Uint8Array.from(atob(result.data), char => char.charCodeAt(0));
            buffer = await context.decodeAudioData(bytes.buffer);
            audioBuffersRef.current.set(clip.id, buffer);
          } catch (error) {
            console.error(`[Audio preview] Could not load ${clip.name}:`, error);
            continue;
          }
        }
        if (cancelled) return;

        const sourceDuration = buffer.duration * 1000;
        const trimIn = Math.max(0, clip.trimIn);
        const trimOut = Math.max(0, clip.trimOut);
        const usable = sourceDuration - trimIn - trimOut;
        if (usable <= 0) continue;
        const offsetOnTimeline = currentTimeRef.current - clip.start;
        const startDelay = Math.max(0, -offsetOnTimeline);
        const elapsed = Math.max(0, offsetOnTimeline);
        if (elapsed >= usable) continue;

        const source = context.createBufferSource();
        const gain = context.createGain();
        source.buffer = buffer;
        source.connect(gain);
        gain.connect(context.destination);

        const when = context.currentTime + startDelay / 1000;
        const remaining = usable - elapsed;
        const localAtStart = elapsed;
        const fadeIn = Math.max(0, clip.fadeIn);
        const fadeOut = Math.max(0, clip.fadeOut);
        const gainAt = (localMs: number) => {
          let level = clip.volume;
          if (fadeIn > 0) level *= Math.min(1, Math.max(0, localMs / fadeIn));
          if (fadeOut > 0) level *= Math.min(1, Math.max(0, (usable - localMs) / fadeOut));
          return level;
        };
        gain.gain.setValueAtTime(gainAt(localAtStart), when);
        if (fadeIn > localAtStart) {
          const fadeEnd = Math.min(usable, fadeIn);
          gain.gain.linearRampToValueAtTime(gainAt(fadeEnd), when + (fadeEnd - localAtStart) / 1000);
        }
        if (fadeOut > 0 && usable - fadeOut > localAtStart) {
          const fadeStart = usable - fadeOut;
          gain.gain.setValueAtTime(gainAt(fadeStart), when + (fadeStart - localAtStart) / 1000);
          gain.gain.linearRampToValueAtTime(0, when + remaining / 1000);
        }
        source.start(when, (trimIn + elapsed) / 1000, remaining / 1000);
        sources.push(source);
      }
    };

    void startAudio();
    return () => {
      cancelled = true;
      sources.forEach(source => { try { source.stop(); } catch { /* already stopped */ } });
    };
  // Restart scheduling on play/pause, seek position, or audio edits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, project.audio]);

  // ── Build injected HTML ────────────────────────────────────────────────────
  const buildInjectedHtml = useCallback((htmlContent: string): string => {
    // Fix Google Fonts: underscores → + signs in font family names
    let html = htmlContent.replace(
      /https:\/\/fonts\.googleapis\.com\/css2\?family=([^&"'\s]+)/g,
      (m: string) => m.replace(/_/g, '+')
    );

    const neutralizerScript = `<script>${FX_RUNTIME}<\/script>
<script>
(function(){
  'use strict';

  // 1. Freeze rAF so the page animation loop doesn't fight seek control
  var _frozen = true; // page's own playback loop must never run; the editor drives seek()
  var _origRAF = window.requestAnimationFrame.bind(window);
  var _pendingRAF = [];
  window.requestAnimationFrame = function(cb) {
    if (!_frozen) return _origRAF(cb);
    if (_pendingRAF.indexOf(cb) < 0) _pendingRAF.push(cb);
    return 0;
  };
  window.cancelAnimationFrame = function() {};
  window.__h2v_freeze = function() { _frozen = true; };
  window.__h2v_thaw   = function() { _frozen = false; };

  // 2. Seeded PRNG for deterministic particles/rain/confetti
  function mulberry32(a) {
    return function() {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a>>>15, 1|a);
      t = t + Math.imul(t ^ t>>>7, 61|t) ^ t;
      return ((t ^ t>>>14)>>>0) / 4294967296;
    };
  }
  Math.random = mulberry32(1337);

  // 3. Route page Web Audio through a controllable master gain. Source audio
  // stays muted by default; the Audio panel can enable it for preview.
  window.__h2vSourceAudioMuted = true;
  window.__h2vAudioContexts = [];
  window.__h2vSetSourceAudioMuted = function(muted) {
    window.__h2vSourceAudioMuted = !!muted;
    (window.__h2vAudioContexts || []).forEach(function(ctx) {
      if (ctx.__h2vSetMuted) ctx.__h2vSetMuted(!!muted);
      if (!muted && ctx.state === 'suspended') ctx.resume().catch(function(){});
    });
    document.querySelectorAll('audio,video').forEach(function(el) { el.muted = !!muted; });
  };
  document.addEventListener('play', function(event) {
    if (event.target instanceof HTMLMediaElement) event.target.muted = window.__h2vSourceAudioMuted;
  }, true);
  var _AC = window.AudioContext || window.webkitAudioContext;
  if (_AC) {
    var _Orig = _AC;
    var _connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(dest) {
      if (dest === this.context.destination && this.context.__h2vMaster) dest = this.context.__h2vMaster;
      return _connect.apply(this, arguments);
    };
    window.AudioContext = window.webkitAudioContext = function(o) {
      var ctx = new _Orig(o);
      var master = ctx.createGain();
      master.gain.value = window.__h2vSourceAudioMuted ? 0 : 1;
      _connect.call(master, ctx.destination);
      ctx.__h2vMaster = master;
      ctx.__h2vSetMuted = function(muted) { master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.015); };
      window.__h2vAudioContexts.push(ctx);
      return ctx;
    };
  }

  // 4. Disable CSS transitions so seek drives visuals
  var st = document.createElement('style');
  st.id = '__h2v_freeze_css';
  st.textContent = '*, *::before, *::after { transition: none !important; animation-play-state: paused !important; }';
  document.currentScript.after(st);

  // Keep CSS animations frozen while scrubbing, but allow them to run during
  // editor playback. The editor still sets currentTime on every seek, so they
  // stay synchronized with the playhead instead of free-running independently.
  window.__h2v_setPlayback = function(playing) {
    // Pages without a seek(ms) function need their own animation loop for
    // playback (for example canvas animations driven by requestAnimationFrame).
    // Keep that loop frozen while paused, and leave seek-controlled pages under
    // the editor's deterministic frame-by-frame timeline.
    var hasPageSeek = typeof window.seek === 'function';
    try { if (typeof seek === 'function') hasPageSeek = true; } catch (e) {}
    _frozen = hasPageSeek || !playing;
    if (!_frozen && _pendingRAF.length) {
      var pending = _pendingRAF.splice(0);
      for (var i = 0; i < pending.length; i++) _origRAF(pending[i]);
    }
    st.textContent = '*, *::before, *::after { transition: none !important;' +
      (playing ? '' : ' animation-play-state: paused !important;') + ' }';
  };
  window.__h2v_captureSourcePlayback = function() {
    _frozen = false;
    if (_pendingRAF.length) {
      var pending = _pendingRAF.splice(0);
      for (var i = 0; i < pending.length; i++) _origRAF(pending[i]);
    }
  };

  // 5. Override engine lives in fxRuntime (shared with the export) — seek() = page seek + overrides
  window.__h2v = {
    seek: function(ms, ovs) { window.__h2v_seek(ms, ovs); }
  };

  console.log('[H2V] neutralizer active');
})();
<\/script>`;

    const captureCSS = `<style id="__h2v_ui">
  #ctl, #controls, .controls, [id*="control"], #bar:has(button):has(input[type="range"]) { display: none !important; }
  body { overflow: hidden !important; margin: 0 !important; background: transparent; }
  html { overflow: hidden !important; }
</style>`;

    // Audio extraction bridge: prefer a source-defined exporter. Otherwise
    // trigger a source WAV/audio-export button so its own encoder can create
    // the file (common in generated animation HTML).
    const audioExportBridge = `<script>
(function(){
  window.__h2vExportSourceAudio = async function(){
    if (window.__h2v_captureSourcePlayback) window.__h2v_captureSourcePlayback();
    await Promise.all((window.__h2vAudioContexts || []).map(function(ctx){ return ctx.resume().catch(function(){}); }));
    if (typeof window.__H2VID_EXPORT_AUDIO__ === 'function') {
      var out = await window.__H2VID_EXPORT_AUDIO__();
      var blob = out instanceof Blob ? out : new Blob([out], {type:'audio/wav'});
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'animation-audio.wav'; a.click();
      setTimeout(function(){URL.revokeObjectURL(a.href);}, 60000);
      setTimeout(function(){ if(window.__h2v_setPlayback) window.__h2v_setPlayback(false); }, ${Math.min(project.source.duration || 30000, 3600000) + 1500});
      return 'started';
    }
    var buttons = Array.from(document.querySelectorAll('button, a, input[type=button], input[type=submit]'));
    var target = buttons.find(function(el){ return /(?:export|download|save).*(?:wav|audio)|(?:wav|audio).*(?:export|download|save)|\bwav\b/i.test((el.innerText||el.value||el.getAttribute('aria-label')||'')); });
    if (!target) return 'unsupported';
    target.click();
    setTimeout(function(){ if(window.__h2v_setPlayback) window.__h2v_setPlayback(false); }, ${Math.min(project.source.duration || 30000, 3600000) + 1500});
    return 'started';
  };
})();
<\/script>`;

    // Insert neutralizer right after <head> opens, CSS before </head>
    html = html.replace(/(<head[^>]*>)/i, (m: string) => `${m}\n${neutralizerScript}\n${audioExportBridge}\n`); // function form: the script contains '$' characters
    if (html.includes('</head>')) {
      html = html.replace('</head>', () => `${captureCSS}\n</head>`);
    } else {
      html = captureCSS + html;
    }

    return html;
  }, []);

  // ── Load HTML via preview:// custom protocol (no temp files / path issues) ─
  const loadHtml = useCallback(async () => {
    const wv = webviewRef.current;
    if (!wv || !project.source.htmlContent) return;

    const generation = ++loadGenerationRef.current;
    pendingSeekRef.current = null;
    readyRef.current = false;
    readyHtmlRef.current = null;
    runtimeErrorKeysRef.current.clear();
    setWebviewReady(false);
    setLoadError(null);

    const previousListeners = loadListenersRef.current;
    if (previousListeners) {
      previousListeners.webview.removeEventListener('dom-ready', previousListeners.domReady);
      previousListeners.webview.removeEventListener('did-finish-load', previousListeners.finish);
      previousListeners.webview.removeEventListener('did-fail-load', previousListeners.fail);
      previousListeners.webview.removeEventListener('console-message', previousListeners.console);
    }

    try {
      const injected = buildInjectedHtml(project.source.htmlContent);

      // Push HTML to main process memory — served by preview:// protocol
      await window.electronAPI.setPreviewHtml(injected);
      if (generation !== loadGenerationRef.current || webviewRef.current !== wv) return;

      // Electron requires dom-ready before executeJavaScript. Wait for both it
      // and did-finish-load so imported page scripts are also initialized.
      let domReady = false;
      let didFinishLoad = false;
      const completeLoad = () => {
        if (generation !== loadGenerationRef.current || webviewRef.current !== wv || !domReady || !didFinishLoad || readyRef.current) return;
        readyRef.current = true;
        readyHtmlRef.current = project.source.htmlContent ?? null;
        setWebviewReady(true);
        doSeekImmediate(currentTimeRef.current, wv);
      };
      const onDomReady = () => { if (generation === loadGenerationRef.current) { domReady = true; completeLoad(); } };
      const onFinish = () => { if (generation === loadGenerationRef.current) { didFinishLoad = true; completeLoad(); } };

      const onFail = () => {
        if (generation !== loadGenerationRef.current) return;
        readyRef.current = false;
        readyHtmlRef.current = null;
        setWebviewReady(false);
        setLoadError('Preview failed to load. Open DevTools (F12) for details.');
      };
      const onConsoleMessage = (event: unknown) => {
        const detail = event as { level?: number; message?: string; line?: number };
        if (detail.level === 3) {
          const message = detail.message || 'Script error';
          const line = detail.line ?? '?';
          console.error(`[HTML preview] ${message} (line ${line})`);

          // Page errors can repeat on every seek/frame. Keep one report entry per
          // distinct message and source line instead of flooding the import report.
          const key = `${line}:${message}`;
          if (runtimeErrorKeysRef.current.has(key)) return;
          runtimeErrorKeysRef.current.add(key);

          const issue = `Preview runtime error (line ${line}): ${message}`;
          const state = useProjectStore.getState();
          const existing = state.importReport?.file === project.source.file ? state.importReport : null;
          const activeProject = state.project;
          const baseReport = existing ?? {
            file: activeProject.source.file,
            duration: activeProject.source.duration,
            sceneCount: activeProject.scenes.length,
            itemCount: activeProject.items.length,
            warnings: [],
            errors: []
          };
          if (!baseReport.errors.includes(issue)) {
            state.setImportReport({ ...baseReport, errors: [...baseReport.errors, issue] });
          }
        }
      };

      wv.addEventListener('dom-ready', onDomReady);
      wv.addEventListener('did-finish-load', onFinish);
      wv.addEventListener('did-fail-load', onFail);
      wv.addEventListener('console-message', onConsoleMessage);
      loadListenersRef.current = { webview: wv, domReady: onDomReady, finish: onFinish, fail: onFail, console: onConsoleMessage };

      // Cache-bust with timestamp so webview always reloads fresh content
      wv.src = `preview://index.html?t=${Date.now()}`;

    } catch (err) {
      if (generation === loadGenerationRef.current) setLoadError(`Preview error: ${err}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.source.file, project.source.htmlContent, buildInjectedHtml]);

  useEffect(() => () => {
    loadGenerationRef.current++;
    const listeners = loadListenersRef.current;
    if (!listeners) return;
    listeners.webview.removeEventListener('dom-ready', listeners.domReady);
    listeners.webview.removeEventListener('did-finish-load', listeners.finish);
    listeners.webview.removeEventListener('did-fail-load', listeners.fail);
    listeners.webview.removeEventListener('console-message', listeners.console);
    loadListenersRef.current = null;
  }, []);

  // ── Seek helper (direct, doesn't use closure over project) ────────────────
  const doSeekImmediate = useCallback((ms: number, wv: WebviewEl) => {
    if (!readyRef.current || readyHtmlRef.current !== project.source.htmlContent || webviewRef.current !== wv) return;
    const remapped  = remapTime(ms, project.scenes);
    const overrides = buildOverrideCommands(ms, project);
    const code = `(function(){
      var t=${remapped};
      var o=${JSON.stringify(overrides)};
      if(window.__h2v){window.__h2v.seek(t,o);}
      else if(typeof seek==='function'){seek(t);}
    })();`;
    pendingSeekRef.current = {
      webview: wv,
      code,
      generation: loadGenerationRef.current,
      html: project.source.htmlContent
    };
    flushSeekRef.current();
  }, [project]);

  // ── Public seek ────────────────────────────────────────────────────────────
  const doSeek = useCallback((ms: number) => {
    const wv = webviewRef.current;
    if (!wv || !readyRef.current || readyHtmlRef.current !== project.source.htmlContent) return;
    doSeekImmediate(ms, wv);
  }, [doSeekImmediate]);

  // Always call the latest doSeek (so edits made during playback apply immediately)
  const doSeekRef = useRef(doSeek);
  doSeekRef.current = doSeek;

  // Re-apply edits live while paused (position, text, timing...)
  useEffect(() => {
    if (webviewReady && !isPlaying) doSeekRef.current(currentTimeMs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.items, project.scenes, webviewReady]);

  // Reload when HTML source changes
  useEffect(() => {
    if (project.source.htmlContent) loadHtml();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.source.file, project.source.htmlContent]);

  // Scrub when playhead moves (timeline drag, etc.)
  useEffect(() => {
    if (webviewReady && !isPlaying && currentTimeMs !== lastSeekRef.current) {
      lastSeekRef.current = currentTimeMs;
      doSeek(currentTimeMs);
    }
  }, [currentTimeMs, webviewReady, isPlaying, doSeek]);

  // ── Playback loop ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!webviewReady) return;

    const wv = webviewRef.current;
    if (wv) {
      try { void wv.executeJavaScript(`if(window.__h2v_setPlayback)window.__h2v_setPlayback(${isPlaying});`).catch(() => {}); }
      catch { /* webview is still navigating */ }
    }

    if (isPlaying) {
      const generation = ++playbackGenerationRef.current;
      pbRef.current = { playing: true, startTime: performance.now(), baseMs: currentTimeMs };

      const loop = (now: number) => {
        if (generation !== playbackGenerationRef.current || !pbRef.current.playing) return;
        const ms  = pbRef.current.baseMs + (now - pbRef.current.startTime);
        const dur = project.source.duration || 30000;

        if (ms >= dur) {
          setCurrentTime(0);
          setPlaying(false);
          return;
        }

        const rounded = Math.round(ms);
        setCurrentTime(rounded);
        lastSeekRef.current = rounded;
        doSeekRef.current(rounded);

        rafRef.current = requestAnimationFrame(loop);
      };

      rafRef.current = requestAnimationFrame(loop);
    } else {
      pbRef.current.playing = false;
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    }

    return () => {
      playbackGenerationRef.current++;
      pbRef.current.playing = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, webviewReady]);

  // ── Scale preview to fit the panel ────────────────────────────────────────
  useEffect(() => {
    const calc = () => {
      if (!containerRef.current) return;
      const { w, h } = project.source.stage;
      const cw = containerRef.current.clientWidth  - 24;
      const ch = containerRef.current.clientHeight - 76;
      if (w && h) setScale(Math.min(cw / w, ch / h, 1));
    };
    calc();
    const ro = new ResizeObserver(calc);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [project.source.stage]);

  useEffect(() => {
    const setMuted = (event: Event) => {
      const muted = !!(event as CustomEvent<{ muted: boolean }>).detail?.muted;
      const wv = webviewRef.current;
      if (!wv || !readyRef.current) return;
      void wv.executeJavaScript(`window.__h2vSetSourceAudioMuted && window.__h2vSetSourceAudioMuted(${muted});`).catch(() => {});
    };
    const exportAudio = async () => {
      const wv = webviewRef.current;
      let result = 'not-ready';
      if (wv && readyRef.current) {
        try { result = String(await wv.executeJavaScript(`window.__h2vExportSourceAudio ? window.__h2vExportSourceAudio() : 'unsupported'`)); }
        catch { result = 'failed'; }
      }
      window.dispatchEvent(new CustomEvent('h2v:source-audio-export-result', { detail: { result } }));
    };
    window.addEventListener('h2v:source-audio-mute', setMuted);
    window.addEventListener('h2v:export-source-audio', exportAudio);
    return () => {
      window.removeEventListener('h2v:source-audio-mute', setMuted);
      window.removeEventListener('h2v:export-source-audio', exportAudio);
    };
  }, []);

  // ── Keyboard: Space = play/pause ───────────────────────────────────────────
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space') { e.preventDefault(); setPlaying(!isPlaying); }
    };
    window.addEventListener('keydown', kd);
    return () => window.removeEventListener('keydown', kd);
  }, [isPlaying, setPlaying]);

  const duration  = project.source.duration || 30000;
  const { w: stageW = 1280, h: stageH = 720 } = project.source.stage || {};
  const hasHtml = !!project.source.htmlContent;

  return (
    <div className="preview-container" ref={containerRef}>

      {/* ── Empty state ── */}
      {!hasHtml && (
        <div className="preview-empty">
          <div className="preview-empty-icon">🎬</div>
          <p>Import an HTML animation to begin</p>
          <p className="preview-empty-sub">File → Import HTML &nbsp;or&nbsp; Ctrl+O</p>
        </div>
      )}

      {/* ── Stage + webview ── */}
      {hasHtml && (
        <div
          className="preview-stage-wrapper"
          style={{ width: stageW * scale, height: stageH * scale }}
        >
          {/* @ts-ignore – webview is an Electron-specific element not in React's JSX types */}
          <webview
            ref={webviewRef as React.RefObject<WebviewEl & HTMLElement>}
            className="preview-webview"
            // @ts-ignore
            disablewebsecurity="true"
            // @ts-ignore
            allowpopups="true"
            // @ts-ignore
            webpreferences="allowRunningInsecureContent=yes, javascript=yes"
            style={{
              width:  stageW,
              height: stageH,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              display: 'inline-flex',
              backgroundColor: '#000',
            }}
          />

          {/* Loading spinner overlay */}
          {!webviewReady && !loadError && (
            <div className="preview-loading">
              <div className="spinner" />
              <span>Loading preview…</span>
            </div>
          )}

          {/* Error state */}
          {loadError && (
            <div className="preview-error">
              <span>⚠️ {loadError}</span>
              <button className="btn btn-sm" onClick={() => loadHtml()}>Retry</button>
            </div>
          )}
        </div>
      )}

      {/* ── Playback controls ── */}
      {hasHtml && (
        <div className="preview-controls">
          <button
            className="btn btn-icon"
            onClick={() => { setCurrentTime(0); setPlaying(false); doSeek(0); }}
            title="Go to start"
          >⏮</button>

          <button
            className="btn"
            onClick={() => setPlaying(!isPlaying)}
            title="Play / Pause  (Space)"
          >
            {isPlaying ? '⏸ Pause' : '▶ Play'}
          </button>

          <button
            className="btn btn-icon"
            onClick={() => { setCurrentTime(duration); setPlaying(false); doSeek(duration); }}
            title="Go to end"
          >⏭</button>

          <input
            type="range"
            className="time-scrubber"
            min={0}
            max={duration}
            value={currentTimeMs}
            onChange={e => {
              const ms = Number(e.target.value);
              setPlaying(false);
              setCurrentTime(ms);
              lastSeekRef.current = ms;
              doSeek(ms);
            }}
          />

          <span className="time-label">
            {fmtTime(currentTimeMs)} / {fmtTime(duration)}
          </span>
        </div>
      )}
    </div>
  );
};

function fmtTime(ms: number): string {
  const s   = ms / 1000;
  const m   = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return m > 0 ? `${m}:${sec.padStart(4, '0')}` : `${sec}s`;
}

export default Preview;
