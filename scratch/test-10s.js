const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const possiblePaths = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const executablePath = possiblePaths.find(p => fs.existsSync(p));

const fxRuntimeTs = fs.readFileSync('src/engine/fxRuntime.ts', 'utf-8');
const match = fxRuntimeTs.match(/export const FX_RUNTIME = String\.raw`([\s\S]*?)`;/);
const FX_RUNTIME = match ? match[1] : '';

const rawHtml = fs.readFileSync('samples/dhaka.html', 'utf-8');

let html = rawHtml.replace(
  /https:\/\/fonts\.googleapis\.com\/css2\?family=([^&"'\s]+)/g,
  m => m.replace(/_/g, '+')
);

const neutralizerScript = `<script>${FX_RUNTIME}<\/script>
<script>
(function(){
  'use strict';
  var _frozen = true;
  var _origRAF = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function(cb) { return _frozen ? 0 : _origRAF(cb); };
  window.cancelAnimationFrame = function() {};
  window.__h2v_freeze = function() { _frozen = true; };
  window.__h2v_thaw   = function() { _frozen = false; };

  var st = document.createElement('style');
  st.id = '__h2v_freeze_css';
  st.textContent = '*, *::before, *::after { transition: none !important; animation-play-state: paused !important; }';
  document.currentScript.after(st);

  window.__h2v = {
    seek: function(ms, ovs) { window.__h2v_seek(ms, ovs); }
  };
})();
<\/script>`;

const captureCSS = `<style id="__h2v_ui">
  #ctl, #controls, .controls, [id*="control"] { display: none !important; }
  body { overflow: hidden !important; margin: 0 !important; background: transparent; }
  html { overflow: hidden !important; }
</style>`;

html = html.replace(/(<head[^>]*>)/i, (m) => `${m}\n${neutralizerScript}\n`);
if (html.includes('</head>')) {
  html = html.replace('</head>', () => `${captureCSS}\n</head>`);
} else {
  html = captureCSS + html;
}

fs.writeFileSync('scratch/dhaka_injected.html', html, 'utf-8');

async function test10s() {
  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  const filePath = path.resolve('scratch/dhaka_injected.html');
  await page.goto('file:///' + filePath.replace(/\\/g, '/'));

  // Seek to 10540ms (like in screenshot)
  const result = await page.evaluate(() => {
    try {
      window.__h2v.seek(10540);
      
      const secs = Array.from(document.querySelectorAll('section'));
      const secInfo = secs.map((s, idx) => {
        const cs = window.getComputedStyle(s);
        return {
          idx,
          visibility: s.style.visibility,
          opacity: s.style.opacity,
          computedVis: cs.visibility,
          computedOpacity: cs.opacity,
          computedDisplay: cs.display
        };
      });

      const stage = document.getElementById('stage');
      const wrap = document.getElementById('wrap');
      const stageCs = window.getComputedStyle(stage);
      const wrapCs = window.getComputedStyle(wrap);

      return {
        success: true,
        secInfo,
        stage: {
          width: stageCs.width,
          height: stageCs.height,
          transform: stageCs.transform,
          bg: stageCs.backgroundColor
        },
        wrap: {
          width: wrapCs.width,
          height: wrapCs.height
        }
      };
    } catch (e) {
      return { success: false, error: e.message, stack: e.stack };
    }
  });

  console.log('DOM state at 10540ms:', JSON.stringify(result, null, 2));

  // Take screenshot
  await page.screenshot({ path: 'scratch/test_10540ms.png' });
  console.log('Saved screenshot to scratch/test_10540ms.png');

  await browser.close();
}

test10s().catch(console.error);
