/**
 * In-page runtime that applies item overrides (styles, text, visibility, clones) and the typography
 * effects/animations. The SAME source string is injected into the preview webview and into the
 * Puppeteer export page, so what you see in the preview is what ends up in the video.
 *
 * It is plain ES5/ES6 JavaScript stored in a string (String.raw) — do not use backticks or ${ } inside.
 *
 * Public API (on window):
 *   __h2v_apply(cmds)   apply a list of override commands, returns true if it created new DOM (clones)
 *   __h2v_seek(ms,cmds) page seek(ms) + apply (+ one re-seek when clones were created)
 *   __h2v_waitFonts()   promise that resolves when web fonts requested by overrides finished loading
 */
export const FX_RUNTIME = String.raw`
(function () {
  'use strict';
  if (window.__h2v_fx) return;
  window.__h2v_fx = true;

  var TAU = Math.PI * 2;
  var NS = 'http://www.w3.org/2000/svg';
  var PX = { fontSize: 1, letterSpacing: 1, wordSpacing: 1, width: 1, height: 1, top: 1, left: 1, right: 1, bottom: 1, padding: 1, margin: 1, borderRadius: 1, textIndent: 1 };
  var uid = 0;
  var fontPromises = [];
  var fontLinks = {};

  function kebab(k) { return String(k).replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); }); }
  function cssv(k, v) { return (typeof v === 'number' && PX[k]) ? (v + 'px') : String(v); }
  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function num(v, d) { v = parseFloat(v); return isFinite(v) ? v : d; }
  function hash(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function r2(x) { return Math.round(x * 100) / 100; }

  // ── colour helpers ─────────────────────────────────────────────────────────
  function rgbOf(c) {
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c || ''));
    if (!m) return null;
    var h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
  }
  function col(c, o) {
    o = (o === undefined || o === null) ? 1 : clamp(+o, 0, 1);
    c = String(c || '#000000');
    var rgb = rgbOf(c);
    if (rgb) return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + (Math.round(o * 1000) / 1000) + ')';
    if (o >= 1) return c;
    return 'color-mix(in srgb,' + c + ' ' + Math.round(o * 100) + '%,transparent)';
  }
  function shade(c, k) {
    var rgb = rgbOf(c);
    if (!rgb) return c;
    return 'rgb(' + Math.round(rgb[0] * k) + ',' + Math.round(rgb[1] * k) + ',' + Math.round(rgb[2] * k) + ')';
  }

  // ── per-element bookkeeping: remember original inline styles so everything can be undone ──
  function st(el) { return el.__h2v || (el.__h2v = { orig: {}, set: {}, base: null, wrap: null, text: undefined, textOn: false, pre: null, inh: 0 }); }
  function put(el, keep, prop, val) {
    var s = st(el);
    if (!(prop in s.set)) { s.orig[prop] = { v: el.style.getPropertyValue(prop), p: el.style.getPropertyPriority(prop) }; s.set[prop] = 1; }
    keep[prop] = 1;
    if (el.style.getPropertyValue(prop) !== val || el.style.getPropertyPriority(prop) !== 'important') el.style.setProperty(prop, val, 'important');
  }
  function release(el, keep) {
    var s = el.__h2v;
    if (!s) return;
    for (var prop in s.set) {
      if (keep && keep[prop]) continue;
      // Only undo if the value is still ours (the page may have re-written it since: then leave it alone)
      if (el.style.getPropertyPriority(prop) === 'important') {
        var o = s.orig[prop];
        if (o && o.v !== '') el.style.setProperty(prop, o.v, o.p);
        else el.style.removeProperty(prop);
      }
      delete s.set[prop];
      delete s.orig[prop];
    }
  }
  function baseOpacity(el) {
    var s = st(el);
    if (el.style.getPropertyPriority('opacity') === 'important' && s.base !== null) return s.base;
    var v = parseFloat(el.style.opacity);
    s.base = isNaN(v) ? 1 : v;
    return s.base;
  }

  function ensureCss() {
    if (document.getElementById('__h2v_fx_css')) return;
    var s = document.createElement('style');
    s.id = '__h2v_fx_css';
    s.textContent = '.h2v-box,.h2v-anim,.h2v-text,.h2v-w,.h2v-c{display:inline-block}.h2v-text{position:relative}.h2v-w{white-space:nowrap}.h2v-box{max-width:100%}';
    (document.head || document.documentElement).appendChild(s);
  }

  // ── fonts ──────────────────────────────────────────────────────────────────
  function loadFont(link, family) {
    if (!link || fontLinks[link]) return;
    fontLinks[link] = 1;
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = link;
    var p = new Promise(function (res) {
      var done = function () {
        try {
          if (document.fonts && document.fonts.load) {
            Promise.all([
              document.fonts.load('400 24px "' + family + '"', 'Aa'),
              document.fonts.load('700 24px "' + family + '"', 'Aa'),
              document.fonts.load('400 24px "' + family + '"', '\u09AC\u09BE\u0982\u09B2\u09BE')
            ]).then(function () { res(); }, function () { res(); });
          } else res();
        } catch (e) { res(); }
      };
      l.onload = done; l.onerror = function () { res(); };
      setTimeout(res, 8000);
    });
    fontPromises.push(p);
    (document.head || document.documentElement).appendChild(l);
  }
  window.__h2v_waitFonts = function () {
    return Promise.all(fontPromises).then(function () { return document.fonts ? document.fonts.ready : null; });
  };

  // ── easing ─────────────────────────────────────────────────────────────────
  function bounceOut(x) {
    var n1 = 7.5625, d1 = 2.75;
    if (x < 1 / d1) return n1 * x * x;
    if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
    if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
    return n1 * (x -= 2.625 / d1) * x + 0.984375;
  }
  function elasticOut(x) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    return Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * (TAU / 3)) + 1;
  }
  function ease(name, x) {
    switch (name) {
      case 'linear': return x;
      case 'easeIn': return x * x * x;
      case 'easeInOut': return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
      case 'back': var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
      case 'bounce': return bounceOut(x);
      case 'elastic': return elasticOut(x);
      case 'expo': return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x);
      default: return 1 - Math.pow(1 - x, 3);
    }
  }

  // ── effect composition: shadows / glows / strokes ──────────────────────────
  function on(e) { return e && e.on; }
  function vec(d, ang) { var a = ang * Math.PI / 180; return [Math.cos(a) * d, Math.sin(a) * d]; }
  function push(L, x, y, b, c) { L.push({ x: x, y: y, b: b, c: c }); }

  function compose(E, lt, filterPath, extra) {
    E = E || {};
    var Lg = [], Ls = [];
    var out = { layers: [], outer: [], dir: [], inner: [], stroke: null, fill: null, pad: 0 };
    var e, i, k, b, o, c, v, N, stp, step, pad = 0;

    // glows
    if (on(e = E.neon)) {
      b = num(e.blur, 12); k = clamp(Math.round(num(e.intensity, 3)), 1, 5); o = num(e.opacity, 1);
      push(Lg, 0, 0, b * 0.2, col(e.color2 || '#ffffff', o));
      push(Lg, 0, 0, b * 0.5, col(e.color2 || '#ffffff', o));
      for (i = 0; i < k; i++) push(Lg, 0, 0, b * (1 + i * 0.8), col(e.color, o));
      if (e.fillCore !== false) out.fill = e.color2 || '#ffffff';
      pad = Math.max(pad, b * 5);
    }
    if (on(e = E.outerGlow)) {
      b = num(e.blur, 14); k = clamp(Math.round(num(e.intensity, 2)), 1, 5); o = num(e.opacity, 1);
      for (i = 0; i < k; i++) push(Lg, 0, 0, b, col(e.color, o));
      pad = Math.max(pad, b * 3);
    }
    if (on(e = E.softGlow)) {
      b = num(e.blur, 40); o = num(e.opacity, 0.6);
      push(Lg, 0, 0, b, col(e.color, o)); push(Lg, 0, 0, b * 1.6, col(e.color, o * 0.6));
      pad = Math.max(pad, b * 3);
    }
    if (on(e = E.multiGlow)) {
      b = num(e.blur, 16); o = num(e.opacity, 1);
      push(Lg, 0, 0, b * 0.6, col(e.color, o)); push(Lg, 0, 0, b * 1.3, col(e.color2, o)); push(Lg, 0, 0, b * 2.2, col(e.color3, o));
      pad = Math.max(pad, b * 5);
    }
    if (on(e = E.animGlow)) {
      b = num(e.blur, 18); k = clamp(Math.round(num(e.intensity, 2)), 1, 5); o = num(e.opacity, 1);
      var pu = 0.65 + 0.35 * Math.sin(TAU * num(e.speed, 1) * lt);
      for (i = 0; i < k; i++) push(Lg, 0, 0, b * pu * (0.6 + i * 0.4), col(e.color, o * (0.55 + 0.45 * pu)));
      pad = Math.max(pad, b * 4);
    }

    // shadows
    if (on(e = E.multi)) {
      b = num(e.blur, 0); o = num(e.opacity, 1); var d0 = num(e.distance, 6), an = num(e.angle, 45);
      var cs = [e.color, e.color2, e.color3];
      for (i = 0; i < 3; i++) { v = vec(d0 * (i + 1), an); push(Ls, v[0], v[1], b, col(cs[i], o)); }
      pad = Math.max(pad, d0 * 3 + b * 2);
    }
    if (on(e = E.drop)) {
      b = num(e.blur, 6); o = num(e.opacity, 0.6); v = vec(num(e.distance, 8), num(e.angle, 45)); c = col(e.color, o);
      push(Ls, v[0], v[1], b, c);
      var sp = num(e.spread, 0);
      if (sp > 0) for (i = 0; i < 8; i++) { var aa = i / 8 * TAU; push(Ls, v[0] + Math.cos(aa) * sp, v[1] + Math.sin(aa) * sp, b, c); }
      pad = Math.max(pad, num(e.distance, 8) + b * 2 + sp);
    }
    if (on(e = E.soft)) {
      v = vec(num(e.distance, 12), num(e.angle, 90)); b = num(e.blur, 32);
      push(Ls, v[0], v[1], b, col(e.color, num(e.opacity, 0.4)));
      pad = Math.max(pad, num(e.distance, 12) + b * 2);
    }
    if (on(e = E.hard)) {
      v = vec(num(e.distance, 6), num(e.angle, 45)); c = col(e.color, num(e.opacity, 1));
      push(Ls, v[0], v[1], 0, c);
      var sp2 = num(e.spread, 0);
      if (sp2 > 0) for (i = 0; i < 8; i++) { var a2 = i / 8 * TAU; push(Ls, v[0] + Math.cos(a2) * sp2, v[1] + Math.sin(a2) * sp2, 0, c); }
      pad = Math.max(pad, num(e.distance, 6) + sp2);
    }
    if (on(e = E.extrude)) {
      N = clamp(Math.round(num(e.depth, 14)), 1, 160); stp = filterPath ? Math.max(1, Math.ceil(N / 30)) : 1;
      c = col(e.color, num(e.opacity, 1));
      for (i = stp; i <= N; i += stp) { v = vec(i, num(e.angle, 45)); push(Ls, v[0], v[1], 0, c); }
      pad = Math.max(pad, N + 2);
    }
    if (on(e = E.depth3d)) {
      N = clamp(Math.round(num(e.depth, 18)), 1, 120); stp = filterPath ? Math.max(1, Math.ceil(N / 30)) : 1; o = num(e.opacity, 1);
      for (i = stp; i <= N; i += stp) { v = vec(i, num(e.angle, 60)); push(Ls, v[0], v[1], 0, col(shade(e.color || '#7c3aed', 1 - 0.6 * i / N), o)); }
      v = vec(N * 1.15, num(e.angle, 60));
      push(Ls, v[0], v[1], N * 0.9, col('#000000', 0.45 * o));
      pad = Math.max(pad, N * 2.2);
    }
    if (on(e = E.long)) {
      N = clamp(Math.round(num(e.depth, 60)), 1, 300); stp = filterPath ? Math.max(1, Math.ceil(N / 30)) : Math.max(1, Math.ceil(N / 120));
      for (i = stp; i <= N; i += stp) { v = vec(i, num(e.angle, 45)); push(Ls, v[0], v[1], 0, col(e.color, num(e.opacity, 0.45) * (1 - 0.6 * i / N))); }
      pad = Math.max(pad, N + 2);
    }

    // strokes
    if (on(e = E.outline)) { out.stroke = { w: num(e.thickness, 2), c: col(e.color, num(e.opacity, 1)) }; pad = Math.max(pad, out.stroke.w); }
    if (on(e = E.strokeOuter)) { out.outer.push({ r: num(e.thickness, 4), c: col(e.color, num(e.opacity, 1)) }); pad = Math.max(pad, num(e.thickness, 4) * 2); }
    if (on(e = E.strokeDouble)) {
      var w = num(e.thickness, 3);
      out.outer.push({ r: w * 2, c: col(e.color2, num(e.opacity, 1)) });
      out.outer.push({ r: w, c: col(e.color, num(e.opacity, 1)) });
      pad = Math.max(pad, w * 4);
    }
    if (on(e = E.strokeMulti)) {
      var w3 = num(e.thickness, 3);
      out.outer.push({ r: w3 * 3, c: col(e.color3, num(e.opacity, 1)) });
      out.outer.push({ r: w3 * 2, c: col(e.color2, num(e.opacity, 1)) });
      out.outer.push({ r: w3, c: col(e.color, num(e.opacity, 1)) });
      pad = Math.max(pad, w3 * 6);
    }
    var dirs = [['strokeTop', 0, -1], ['strokeBottom', 0, 1], ['strokeLeft', -1, 0], ['strokeRight', 1, 0]];
    for (i = 0; i < dirs.length; i++) {
      if (on(e = E[dirs[i][0]])) {
        var t = Math.max(0.5, num(e.thickness, 4)), h = t / 2, off = num(e.offset, 0);
        out.dir.push({
          rx: dirs[i][1] !== 0 ? h : 0, ry: dirs[i][2] !== 0 ? h : 0,
          dx: dirs[i][1] * (h + off), dy: dirs[i][2] * (h + off), c: col(e.color, num(e.opacity, 1))
        });
        pad = Math.max(pad, t * 2 + off);
      }
    }
    // inner effects
    if (on(e = E.inner)) {
      v = vec(num(e.distance, 4), num(e.angle, 45));
      out.inner.push({ kind: 'shadow', dx: v[0], dy: v[1], b: num(e.blur, 6), c: col(e.color, num(e.opacity, 0.7)) });
    }
    if (on(e = E.innerGlow)) out.inner.push({ kind: 'shadow', dx: 0, dy: 0, b: num(e.blur, 6), c: col(e.color, num(e.opacity, 0.9)) });
    if (on(e = E.strokeInner)) out.inner.push({ kind: 'stroke', r: num(e.thickness, 2), c: col(e.color, num(e.opacity, 1)) });

    out.layers = (extra || []).concat(Lg, Ls);
    out.pad = pad + 12;
    return out;
  }

  function filterMarkup(id, W, H, pad, o) {
    var m = '<filter id="' + id + '" filterUnits="userSpaceOnUse" x="' + (-pad) + '" y="' + (-pad) + '" width="' + (W + 2 * pad) + '" height="' + (H + 2 * pad) + '" color-interpolation-filters="sRGB">';
    var stack = [], k = 0, i;
    for (i = 0; i < o.outer.length; i++) {
      k++;
      m += '<feMorphology in="SourceAlpha" operator="dilate" radius="' + r2(o.outer[i].r) + '" result="d' + k + '"/>' +
        '<feFlood flood-color="' + o.outer[i].c + '" result="f' + k + '"/>' +
        '<feComposite in="f' + k + '" in2="d' + k + '" operator="in" result="s' + k + '"/>';
      stack.push('s' + k);
    }
    for (i = 0; i < o.dir.length; i++) {
      k++;
      var d = o.dir[i];
      m += '<feMorphology in="SourceAlpha" operator="dilate" radius="' + r2(d.rx) + ' ' + r2(d.ry) + '" result="d' + k + '"/>' +
        '<feOffset in="d' + k + '" dx="' + r2(d.dx) + '" dy="' + r2(d.dy) + '" result="o' + k + '"/>' +
        '<feFlood flood-color="' + d.c + '" result="f' + k + '"/>' +
        '<feComposite in="f' + k + '" in2="o' + k + '" operator="in" result="s' + k + '"/>';
      stack.push('s' + k);
    }
    var inner = [];
    for (i = 0; i < o.inner.length; i++) {
      k++;
      var n = o.inner[i];
      if (n.kind === 'stroke') {
        m += '<feMorphology in="SourceAlpha" operator="erode" radius="' + r2(n.r) + '" result="e' + k + '"/>' +
          '<feComposite in="SourceAlpha" in2="e' + k + '" operator="out" result="r' + k + '"/>' +
          '<feFlood flood-color="' + n.c + '" result="f' + k + '"/>' +
          '<feComposite in="f' + k + '" in2="r' + k + '" operator="in" result="i' + k + '"/>';
      } else {
        m += '<feComponentTransfer in="SourceAlpha" result="v' + k + '"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer>' +
          '<feOffset in="v' + k + '" dx="' + r2(n.dx) + '" dy="' + r2(n.dy) + '" result="o' + k + '"/>' +
          '<feGaussianBlur in="o' + k + '" stdDeviation="' + r2(n.b / 2) + '" result="b' + k + '"/>' +
          '<feFlood flood-color="' + n.c + '" result="f' + k + '"/>' +
          '<feComposite in="f' + k + '" in2="b' + k + '" operator="in" result="c' + k + '"/>' +
          '<feComposite in="c' + k + '" in2="SourceAlpha" operator="in" result="i' + k + '"/>';
      }
      inner.push('i' + k);
    }
    m += '<feMerge>';
    for (i = 0; i < stack.length; i++) m += '<feMergeNode in="' + stack[i] + '"/>';
    m += '<feMergeNode in="SourceGraphic"/>';
    for (i = 0; i < inner.length; i++) m += '<feMergeNode in="' + inner[i] + '"/>';
    m += '</feMerge></filter>';
    return m;
  }
  function svgRoot() {
    var s = document.getElementById('__h2v_svg');
    if (!s) {
      s = document.createElementNS(NS, 'svg');
      s.id = '__h2v_svg';
      s.setAttribute('width', '0'); s.setAttribute('height', '0');
      s.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
      (document.body || document.documentElement).appendChild(s);
    }
    return s;
  }
  function setFilter(id, markup) {
    var old = document.getElementById(id);
    if (old && old.parentNode) old.parentNode.removeChild(old);
    svgRoot().insertAdjacentHTML('beforeend', markup);
  }
  function dropList(layers) {
    var s = '';
    for (var i = 0; i < layers.length; i++) s += ' drop-shadow(' + r2(layers[i].x) + 'px ' + r2(layers[i].y) + 'px ' + r2(layers[i].b / 2) + 'px ' + layers[i].c + ')';
    return s;
  }
  function shadowList(layers) {
    var s = [];
    for (var i = 0; i < layers.length; i++) s.push(r2(layers[i].x) + 'px ' + r2(layers[i].y) + 'px ' + r2(layers[i].b) + 'px ' + layers[i].c);
    return s.join(',');
  }

  // ── animation ──────────────────────────────────────────────────────────────
  var DIRS = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
  var CONT = { wave: 1, shake: 1, glitch: 1, neonFlicker: 1, looping: 1 };

  function animCalc(a, lt, i, n) {
    var u = { o: 1, tx: 0, ty: 0, s: 1, r: 0, rx: 0, blur: 0, ls: 0, clip: null, mask: null, sh: null };
    var type = a.type;
    var dur = Math.max(0.01, num(a.duration, 1));
    var speed = num(a.speed, 1) || 1;
    var k = num(a.intensity, 1); if (!(k > 0)) k = 1;
    var base = (lt - num(a.start, 0) - num(a.delay, 0)) * speed;
    var stag = num(a.stagger, 0);
    if (type === 'typewriter') stag = dur / Math.max(1, n);
    var loop = (type === 'looping') ? 'loop' : (a.loop || 'none');
    var started = base >= 0;
    var period = dur + (n - 1) * stag + num(a.loopGap, 0);
    if (loop !== 'none' && started && period > 0) {
      if (loop === 'pingpong') { var cyc = base % (2 * period); base = cyc > period ? 2 * period - cyc : cyc; }
      else base = base % period;
    }
    var local = base - i * stag;
    var p = started ? clamp(local / dur, 0, 1) : 0;
    var e = ease(a.easing || 'easeOut', p);
    var d = DIRS[a.direction || 'up'] || DIRS.up;
    var env = 1;
    if (CONT[type]) {
      if (!started) env = 0;
      else if (loop === 'none') env = clamp(Math.min(base * 4, (dur - base) * 4), 0, 1);
    }
    var dist = 40 * k, ang, rad, slot, h, q, tt, pi;
    switch (type) {
      case 'typewriter': u.o = (started && local >= 0) ? 1 : 0; break;
      case 'letterReveal': case 'wordReveal': u.o = e; u.tx = d[0] * dist * (1 - e); u.ty = d[1] * dist * (1 - e); break;
      case 'fadeIn': u.o = e; break;
      case 'fadeOut': u.o = 1 - e; break;
      case 'slideIn': u.o = e; u.tx = d[0] * 160 * k * (1 - e); u.ty = d[1] * 160 * k * (1 - e); break;
      case 'slideOut': u.o = 1 - e; u.tx = d[0] * 160 * k * e; u.ty = d[1] * 160 * k * e; break;
      case 'zoomIn': u.o = e; u.s = Math.max(0.001, e); break;
      case 'zoomOut': u.o = 1 - e; u.s = Math.max(0.001, 1 - e); break;
      case 'popUp': u.s = Math.max(0.001, ease('back', p)); u.o = Math.min(1, p * 5); break;
      case 'bounce': u.ty = -dist * 1.5 * (1 - bounceOut(p)); u.o = Math.min(1, p * 8); break;
      case 'elastic': u.s = Math.max(0.001, elasticOut(p)); u.o = Math.min(1, p * 8); break;
      case 'rotateIn': u.r = -90 * k * (1 - e); u.s = 0.5 + 0.5 * e; u.o = e; break;
      case 'flip': u.rx = 90 * (1 - e); u.o = e; break;
      case 'wave': u.ty = Math.sin(base * TAU - i * 0.55) * 14 * k * env; break;
      case 'shake':
        slot = Math.floor(base * 30);
        u.tx = (hash(slot + 1) - 0.5) * 20 * k * env; u.ty = (hash(slot + 7) - 0.5) * 20 * k * env; u.r = (hash(slot + 13) - 0.5) * 2 * k * env; break;
      case 'glitch':
        slot = Math.floor(base * 14); h = (hash(slot) > 0.62 ? 1 : 0) * env;
        if (h) {
          u.tx = (hash(slot + 3) - 0.5) * 30 * k;
          u.sh = [{ x: -4 * k, y: 0, b: 0, c: '#ff004c' }, { x: 4 * k, y: 0, b: 0, c: '#00e5ff' }];
          if (hash(slot + 11) > 0.5) u.clip = 'inset(' + r2(hash(slot + 5) * 45) + '% 0 ' + r2(hash(slot + 9) * 45) + '% 0)';
        }
        break;
      case 'neonFlicker': slot = Math.floor(base * 22); h = hash(slot); u.o = env ? (h > 0.82 ? 0.3 : (h > 0.65 ? 0.7 : 1)) : 1; break;
      case 'blurIn': u.blur = (1 - e) * 24 * k; u.o = e; break;
      case 'tracking': u.ls = (1 - e) * 18 * k; u.o = e; break;
      case 'maskReveal':
        q = (1 - e) * 100;
        if (p < 1) u.clip = (a.direction === 'right') ? 'inset(0 0 0 ' + r2(q) + '%)' : (a.direction === 'up') ? 'inset(0 0 ' + r2(q) + '% 0)' : (a.direction === 'down') ? 'inset(' + r2(q) + '% 0 0 0)' : 'inset(0 ' + r2(q) + '% 0 0)';
        break;
      case 'wipe':
        if (p < 1) {
          var X = e * 120 - 20, A = (a.direction === 'right') ? 270 : (a.direction === 'up') ? 180 : (a.direction === 'down') ? 0 : 90;
          u.mask = 'linear-gradient(' + A + 'deg,#000 ' + r2(X) + '%,transparent ' + r2(X + 20) + '%)';
        }
        break;
      case 'split': u.ty = (i % 2 ? 1 : -1) * 60 * k * (1 - e); u.o = e; break;
      case 'explosion':
        pi = started ? clamp((base - hash(i * 7 + 4) * dur * 0.35) / (dur * 0.65), 0, 1) : 0; e = ease(a.easing || 'easeOut', pi);
        ang = hash(i * 3 + 1) * TAU; rad = (120 + hash(i * 3 + 2) * 260) * k;
        u.tx = Math.cos(ang) * rad * e; u.ty = Math.sin(ang) * rad * e + e * e * 120; u.r = (hash(i * 3 + 3) - 0.5) * 720 * e; u.s = 1 + e * 0.6; u.o = 1 - e; break;
      case 'particles':
        pi = started ? clamp((base - hash(i * 7 + 4) * dur * 0.5) / (dur * 0.5), 0, 1) : 0; e = ease(a.easing || 'easeIn', pi);
        ang = -Math.PI / 2 + (hash(i * 5 + 1) - 0.5) * 2.4; rad = (40 + hash(i * 5 + 2) * 140) * k;
        u.tx = Math.cos(ang) * rad * e; u.ty = Math.sin(ang) * rad * e; u.s = Math.max(0.05, 1 - 0.8 * e); u.blur = e * 5; u.o = 1 - e * e; break;
      case 'impact':
        if (p < 0.4) { q = p / 0.4; u.s = 1 + (2 * k) * (1 - q * q); u.o = Math.min(1, q * 3); }
        else { tt = (p - 0.4) / 0.6; q = Math.exp(-tt * 6) * 12 * k; u.tx = Math.sin(tt * 60) * q; u.ty = Math.cos(tt * 47) * q * 0.6; }
        break;
      case 'kinetic':
        var V = [[-1, 0], [0, -1], [1, 0], [0, 1]][i % 4], eb = ease('back', p);
        u.tx = V[0] * dist * 1.4 * (1 - eb); u.ty = V[1] * dist * 1.4 * (1 - eb); u.s = Math.max(0.001, 0.6 + 0.4 * eb); u.r = (i % 2 ? 1 : -1) * 12 * (1 - eb); u.o = Math.min(1, p * 4); break;
      case 'looping':
        if (started) { var ph = (lt - num(a.start, 0) - num(a.delay, 0)) * speed * TAU / dur; u.ty = Math.sin(ph) * 8 * k; u.s = 1 + 0.05 * k * Math.sin(ph * 2); u.r = Math.sin(ph) * 1.5 * k; }
        break;
    }
    return u;
  }

  function unitCss(u, grad, deco, baseLs) {
    var c = '', t = '';
    if (u.rx) t += 'perspective(600px) rotateX(' + r2(u.rx) + 'deg) ';
    if (u.tx || u.ty) t += 'translate(' + r2(u.tx) + 'px,' + r2(u.ty) + 'px) ';
    if (u.r) t += 'rotate(' + r2(u.r) + 'deg) ';
    if (u.s !== 1) t += 'scale(' + (Math.round(u.s * 1000) / 1000) + ') ';
    if (t) c += 'transform:' + t + ';';
    if (u.o !== 1) c += 'opacity:' + (Math.round(u.o * 1000) / 1000) + ';';
    if (u.blur > 0.05) c += 'filter:blur(' + r2(u.blur) + 'px);';
    if (u.ls) c += 'letter-spacing:' + r2(baseLs + u.ls) + 'px;';
    if (u.clip) c += 'clip-path:' + u.clip + ';';
    if (u.mask) c += '-webkit-mask-image:' + u.mask + ';mask-image:' + u.mask + ';';
    if (grad) c += grad;
    if (deco) c += 'text-decoration:' + deco + ';';
    return c;
  }

  // ── structure: el > .h2v-box > .h2v-anim > .h2v-text > (text | words | letters) ─────────
  var SEG = (window.Intl && Intl.Segmenter) ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  function graphemes(str) {
    if (SEG) return Array.from(SEG.segment(str), function (x) { return x.segment; });
    return Array.from(str);
  }
  function mk(cls) { var s = document.createElement('span'); s.className = cls; return s; }

  function splitText(root, unit, units) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (tn) {
      var txt = tn.nodeValue;
      if (!txt) return;
      var parts = txt.split(/(\s+)/), frag = document.createDocumentFragment();
      parts.forEach(function (p) {
        if (!p) return;
        if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(p)); return; }
        var w = mk('h2v-w');
        if (unit === 'char') {
          graphemes(p).forEach(function (g) { var c = mk('h2v-c'); c.textContent = g; w.appendChild(c); units.push(c); });
        } else { w.textContent = p; units.push(w); }
        frag.appendChild(w);
      });
      tn.parentNode.replaceChild(frag, tn);
    });
  }

  function unwrapFx(el) {
    var s = el.__h2v;
    if (!s || !s.wrap) return;
    var fid = s.wrap.fid;
    el.innerHTML = s.wrap.orig;
    s.wrap = null;
    var f = document.getElementById(fid);
    if (f && f.parentNode) f.parentNode.removeChild(f);
  }

  function ensureWrap(el, unit) {
    var s = st(el);
    if (s.wrap && s.wrap.unit === unit && s.wrap.box.parentNode === el) return s.wrap;
    unwrapFx(el);
    ensureCss();
    var w = { unit: unit, orig: el.innerHTML, box: mk('h2v-box'), anim: mk('h2v-anim'), txt: mk('h2v-text'), units: [], fid: 'h2vf-' + (++uid), keys: {}, size: '' };
    while (el.firstChild) w.txt.appendChild(el.firstChild);
    w.box.appendChild(w.anim); w.anim.appendChild(w.txt); el.appendChild(w.box);
    if (unit !== 'whole') splitText(w.txt, unit, w.units);
    s.wrap = w;
    return w;
  }

  function gradCss(g, sized, x, y, W, H) {
    var cs = g.useC3 ? [g.c1, g.c3, g.c2] : [g.c1, g.c2];
    var img = g.type === 'radial' ? 'radial-gradient(circle,' + cs.join(',') + ')' : 'linear-gradient(' + num(g.angle, 90) + 'deg,' + cs.join(',') + ')';
    var s = 'background-image:' + img + ';-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;';
    if (sized) s += 'background-size:' + W + 'px ' + H + 'px;background-position:' + (-x) + 'px ' + (-y) + 'px;background-repeat:no-repeat;';
    return s;
  }
  function setCss(node, key, css) {
    if (node.__k === css) return;
    node.__k = css;
    node.style.cssText = css;
  }

  function maskCss(m) {
    var soft = clamp(num(m.soft, 40), 5, 100), k = 100 - soft, img = '';
    switch (m.type) {
      case 'fade-top': img = 'linear-gradient(to top,#000 ' + k + '%,transparent 100%)'; break;
      case 'fade-left': img = 'linear-gradient(to left,#000 ' + k + '%,transparent 100%)'; break;
      case 'fade-right': img = 'linear-gradient(to right,#000 ' + k + '%,transparent 100%)'; break;
      case 'radial': img = 'radial-gradient(circle,#000 ' + k + '%,transparent 100%)'; break;
      case 'stripes': img = 'repeating-linear-gradient(90deg,#000 0,#000 ' + r2(soft / 10 + 3) + 'px,transparent ' + r2(soft / 10 + 3) + 'px,transparent ' + r2(soft / 10 + 8) + 'px)'; break;
      case 'diagonal': img = 'repeating-linear-gradient(45deg,#000 0,#000 ' + r2(soft / 10 + 3) + 'px,transparent ' + r2(soft / 10 + 3) + 'px,transparent ' + r2(soft / 10 + 8) + 'px)'; break;
      default: img = 'linear-gradient(to bottom,#000 ' + k + '%,transparent 100%)';
    }
    return '-webkit-mask-image:' + img + ';mask-image:' + img + ';-webkit-mask-size:100% 100%;mask-size:100% 100%;';
  }

  function hasEffects(E) { if (!E) return false; for (var k in E) if (E[k] && E[k].on) return true; return false; }
  function needsWrap(fx) {
    var b = fx.box || {};
    return !!((fx.gradient && fx.gradient.on) || hasEffects(fx.effects) || b.bgOn || b.borderOn || num(b.padX, 0) || num(b.padY, 0) || num(b.radius, 0) ||
      (fx.mask && fx.mask.on) || (fx.threeD && fx.threeD.on) || (fx.anim && fx.anim.type) || num(fx.wordSpacing, 0));
  }

  function applyFx(el, cmd) {
    var fx = cmd.fx, lt = num(cmd.lt, 0);
    var baseLs = cmd.style ? num(cmd.style.letterSpacing, 0) : 0;
    var deco = cmd.style && cmd.style.textDecoration ? String(cmd.style.textDecoration) : '';
    var a = fx.anim && fx.anim.type ? fx.anim : null;
    var unit = a && a.unit ? a.unit : 'whole';
    var w = ensureWrap(el, unit);
    var g = fx.gradient && fx.gradient.on ? fx.gradient : null;
    var box = fx.box || {};

    // animation state (also provides glitch shadow extras)
    var n = Math.max(1, w.units.length);
    var uWhole = null, uList = null;
    if (a) {
      if (unit === 'whole') uWhole = animCalc(a, lt, 0, 1);
      else { uList = []; for (var i = 0; i < w.units.length; i++) uList.push(animCalc(a, lt, i, n)); }
    }

    // effect composition
    var probe = compose(fx.effects, lt, true, null);
    var useSvg = !!(probe.outer.length || probe.dir.length || probe.inner.length);
    var filterPath = !!g || useSvg;
    var cmp = compose(fx.effects, lt, filterPath, uWhole && uWhole.sh ? uWhole.sh : null);

    // measure (only when needed)
    var W = 0, H = 0;
    if (g && uList || useSvg) { W = w.txt.offsetWidth; H = w.txt.offsetHeight; }

    // .h2v-text : shadows / stroke / filter
    var tcss = 'display:inline-block;';
    var fill = cmp.fill;
    if (fill) tcss += 'color:' + fill + ';';
    if (cmp.stroke) tcss += '-webkit-text-stroke:' + r2(cmp.stroke.w) + 'px ' + cmp.stroke.c + ';';
    var flt = '';
    if (useSvg) {
      var pad = Math.ceil(cmp.pad + 6);
      var mk2 = filterMarkup(w.fid, W, H, pad, cmp);
      if (w.keys.f !== mk2) { w.keys.f = mk2; setFilter(w.fid, mk2); }
      flt = 'url(#' + w.fid + ')';
    }
    if (filterPath) { flt += dropList(cmp.layers); }
    else if (cmp.layers.length) tcss += 'text-shadow:' + shadowList(cmp.layers) + ';';
    if (flt) tcss += 'filter:' + flt + ';';
    if (num(fx.wordSpacing, 0)) tcss += 'word-spacing:' + fx.wordSpacing + 'px;';
    if (deco) tcss += 'text-decoration:' + deco + ';';
    if (g && unit === 'whole') tcss += gradCss(g, false);   // gradient must sit on the element that directly holds the text
    setCss(w.txt, 't', tcss);

    // .h2v-box : background, border, padding, radius, mask, 3D
    var bcss = 'display:inline-block;';
    if (box.bgOn) bcss += 'background-color:' + col(box.bg || '#000000', num(box.bgOpacity, 1)) + ';';
    if (num(box.padX, 0) || num(box.padY, 0)) bcss += 'padding:' + num(box.padY, 0) + 'px ' + num(box.padX, 0) + 'px;';
    if (num(box.radius, 0)) bcss += 'border-radius:' + num(box.radius, 0) + 'px;';
    if (box.borderOn) bcss += 'border:' + num(box.borderW, 2) + 'px ' + (box.borderStyle || 'solid') + ' ' + (box.borderColor || '#ffffff') + ';';
    if (fx.mask && fx.mask.on) bcss += maskCss(fx.mask);
    if (fx.threeD && fx.threeD.on) bcss += 'transform:perspective(' + num(fx.threeD.persp, 600) + 'px) rotateX(' + num(fx.threeD.rotX, 20) + 'deg) rotateY(' + num(fx.threeD.rotY, -20) + 'deg);';
    setCss(w.box, 'b', bcss);

    // .h2v-anim and units
    if (unit === 'whole') {
      var acss = uWhole ? unitCss(uWhole, '', '', baseLs) : '';
      setCss(w.anim, 'a', 'display:inline-block;' + acss);
    } else {
      setCss(w.anim, 'a', 'display:inline-block;');
      for (var j = 0; j < w.units.length; j++) {
        var node = w.units[j];
        var gc = '';
        if (g) gc = gradCss(g, true, node.offsetLeft, node.offsetTop, W || w.txt.offsetWidth, H || w.txt.offsetHeight);
        setCss(node, 'u', 'display:inline-block;' + unitCss(uList[j], gc, deco, baseLs));
      }
    }
  }

  // ── clones ────────────────────────────────────────────────────────────────
  function measure(src, sec) {
    var s = src.__h2v, was = null;
    if (s && 'display' in s.set) { was = src.style.getPropertyValue('display'); src.style.removeProperty('display'); }
    var x = 0, y = 0, n = src;
    while (n && n !== sec && n !== document.body) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    var r = { x: x, y: y, w: src.offsetWidth, h: src.offsetHeight };
    if (was !== null) src.style.setProperty('display', was, 'important');
    return r;
  }
  var INH = ['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'line-height', 'text-align', 'text-transform', 'text-shadow', 'white-space', 'word-spacing'];
  function makeClone(cmd) {
    var c = cmd.clone;
    if (!c) return null;
    var src = document.querySelector(c.from);
    var secs = document.querySelectorAll('section');
    var target = secs[c.section];
    if (!src || !target) return null;
    var srcSec = src.closest ? src.closest('section') : null;
    var m = measure(src, srcSec);
    var clone = src.cloneNode(true);
    var ss = src.__h2v;
    if (ss) {
      if (ss.wrap) clone.innerHTML = ss.wrap.orig;
      for (var prop in ss.set) { var o = ss.orig[prop]; if (o && o.v !== '') clone.style.setProperty(prop, o.v, o.p); else clone.style.removeProperty(prop); }
    }
    var all = clone.querySelectorAll('[id],[data-h2v],[data-h2t],[data-h2v-i]'); for (var i = 0; i < all.length; i++) { all[i].removeAttribute('id'); all[i].removeAttribute('data-h2v'); all[i].removeAttribute('data-h2t'); all[i].removeAttribute('data-h2v-i'); }
    clone.removeAttribute('id'); clone.removeAttribute('data-h2t'); clone.removeAttribute('data-h2v-i');
    var attr = /\[data-h2v="([^"]+)"\]/.exec(cmd.selector);
    if (attr) clone.setAttribute('data-h2v', attr[1]);
    var cs = getComputedStyle(src);
    var wrap = document.createElement('div');
    wrap.setAttribute('data-h2v-wrap', attr ? attr[1] : '');
    var css = 'position:absolute;left:' + m.x + 'px;top:' + m.y + 'px;width:' + m.w + 'px;';
    for (var k = 0; k < INH.length; k++) css += INH[k] + ':' + cs.getPropertyValue(INH[k]) + ';';
    wrap.style.cssText = css;
    clone.style.setProperty('position', 'static'); clone.style.setProperty('left', 'auto'); clone.style.setProperty('top', 'auto');
    clone.style.setProperty('right', 'auto'); clone.style.setProperty('bottom', 'auto'); clone.style.setProperty('margin', '0');
    wrap.appendChild(clone);
    target.appendChild(wrap);
    return clone;
  }

  // ── container text inheritance (font/colour set on a container reach its children) ─────
  function setInherit(el, props) {
    var s = st(el), id = 'h2v-inh-' + (s.inh || (s.inh = ++uid));
    var tag = document.getElementById('__' + id);
    if (!props || !props.length) {
      if (tag) tag.parentNode.removeChild(tag);
      el.removeAttribute('data-h2v-i');
      return;
    }
    var css = '[data-h2v-i="' + s.inh + '"] *{' + props.map(function (p) { return p + ':inherit !important'; }).join(';') + '}';
    if (!tag) { tag = document.createElement('style'); tag.id = '__' + id; (document.head || document.documentElement).appendChild(tag); }
    if (tag.textContent !== css) tag.textContent = css;
    el.setAttribute('data-h2v-i', s.inh);
  }

  // ── command application ────────────────────────────────────────────────────
  function applyOne(cmd) {
    var el = document.querySelector(cmd.selector), made = false;
    if (!el && cmd.clone) { el = makeClone(cmd); made = !!el; }
    if (!el) return false;
    var s = st(el), keep = {};

    if (cmd.hidden) {            // hidden: only display:none; everything else is released (and comes back on un-hide)
      put(el, keep, 'display', 'none');
      release(el, keep);
      return made;
    }
    if (cmd.s !== undefined) el.dataset.s = String(cmd.s);
    if (cmd.d !== undefined) el.dataset.d = String(cmd.d);
    if (cmd.y !== undefined) el.dataset.y = String(cmd.y);

    // text override
    if (cmd.text !== undefined) {
      if (!s.textOn) { unwrapFx(el); s.pre = el.innerHTML; s.textOn = true; s.text = undefined; }
      if (s.text !== cmd.text) { unwrapFx(el); el.textContent = cmd.text; s.text = cmd.text; }
    } else if (s.textOn) {
      unwrapFx(el); if (s.pre !== null) el.innerHTML = s.pre;
      s.textOn = false; s.text = undefined;
    }

    // plain styles
    var st2 = cmd.style || {}, inh = [];
    for (var k in st2) {
      var v = st2[k];
      if (v === undefined || v === null || v === '') continue;
      if (k === 'opacity') { put(el, keep, 'opacity', String(baseOpacity(el) * num(v, 1))); continue; }
      var prop = kebab(k);
      put(el, keep, prop, cssv(k, v));
      if (cmd.inherit && cmd.inherit.indexOf(prop) >= 0) inh.push(prop);
    }
    if (cmd.inherit) setInherit(el, inh);
    if (cmd.fontLink) loadFont(cmd.fontLink, cmd.fontFamily || '');

    // advanced effects
    if (cmd.fx && needsWrap(cmd.fx)) applyFx(el, cmd);
    else unwrapFx(el);

    release(el, keep);
    return made;
  }

  // Stable element ids. The importer addresses elements as [data-h2v="d<section>-<n>"] (n-th [data-s] element in the
  // section) and [data-h2t="<tag>-<section>-<n>"] (n-th h1/h2/h3/p) instead of fragile positional selectors.
  var tagged = false;
  function tagDom() {
    if (tagged) return;
    var secs = document.querySelectorAll('section');
    if (!secs.length) return;
    tagged = true;
    for (var i = 0; i < secs.length; i++) {
      var ds = secs[i].querySelectorAll('[data-s]');
      for (var j = 0; j < ds.length; j++) if (!ds[j].hasAttribute('data-h2v')) ds[j].setAttribute('data-h2v', 'd' + i + '-' + j);
      var cnt = {}, ts = secs[i].querySelectorAll('h1,h2,h3,p');
      for (var t = 0; t < ts.length; t++) {
        var tag = ts[t].tagName.toLowerCase();
        cnt[tag] = (cnt[tag] || 0);
        ts[t].setAttribute('data-h2t', tag + '-' + i + '-' + cnt[tag]);
        cnt[tag]++;
      }
    }
  }
  window.__h2v_tag = tagDom;

  window.__h2v_apply = window.__h2v_applyOverrides = function (cmds) {
    var made = false;
    if (!Array.isArray(cmds)) return false;
    tagDom();
    for (var i = 0; i < cmds.length; i++) {
      try { if (applyOne(cmds[i])) made = true; }
      catch (e) { window.__h2v_lastErr = String((e && e.stack) || e); }
    }
    return made;
  };
  window.__h2v_seek = function (ms, cmds) {
    window.__h2v_time = ms;
    // A page-provided seek controller may use scene-local animation times or
    // otherwise manage its own CSS animations. Don't overwrite those times with
    // the global project time after calling it.
    var hasPageSeek = typeof window.seek === 'function';
    if (hasPageSeek) window.seek(ms);
    else {
      try {
        if (document.getAnimations) {
          var anims = document.getAnimations();
          for (var a = 0; a < anims.length; a++) anims[a].currentTime = ms;
        }
      } catch (e) {}
    }
    if (cmds) {
      var made = window.__h2v_apply(cmds);
      if (made) {
        if (hasPageSeek) window.seek(ms);
        else {
          try {
            if (document.getAnimations) {
              var anims2 = document.getAnimations();
              for (var a2 = 0; a2 < anims2.length; a2++) anims2[a2].currentTime = ms;
            }
          } catch (e) {}
        }
        window.__h2v_apply(cmds);
      }
    }
  };
})();
`;
