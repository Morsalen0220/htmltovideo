/**
 * Electron render engine.
 * Uses puppeteer-core (bundled Chromium) to capture frames and
 * pipes them to FFmpeg for encoding.
 *
 * Milestone 2: 1080p render to MP4
 * Milestone 6: 4K, parallel workers, progress, cancel
 */

import puppeteer, { Browser, Page } from 'puppeteer-core';
import { ChildProcess, spawn } from 'child_process';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { pathToFileURL } from 'url';
import { FX_RUNTIME } from '../src/engine/fxRuntime';
import { remapTime, buildOverrideCommands } from '../src/engine/overrides';
import type { ProjectData } from '../src/types/project';

// ffmpeg-static gives us the path to a bundled FFmpeg binary
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegPathFromPackage: string = require('ffmpeg-static');

function getFfmpegExecutablePath(): string {
  if (!ffmpegPathFromPackage) return '';
  if (!app.isPackaged) return ffmpegPathFromPackage;

  // child_process.spawn cannot execute a binary through Electron's virtual ASAR path.
  // electron-builder places this executable in app.asar.unpacked; point directly there.
  const unpackedPath = path.join(
    path.dirname(app.getAppPath()),
    'app.asar.unpacked',
    'node_modules',
    'ffmpeg-static',
    path.basename(ffmpegPathFromPackage)
  );
  if (fs.existsSync(unpackedPath)) return unpackedPath;

  // Fallback for customized package layouts that preserve the module's relative path.
  const asarPath = `${path.sep}app.asar${path.sep}`;
  return ffmpegPathFromPackage.includes(asarPath)
    ? ffmpegPathFromPackage.replace(asarPath, `${path.sep}app.asar.unpacked${path.sep}`)
    : ffmpegPathFromPackage;
}

/** Find a locally installed Chromium browser. puppeteer-core does not download one. */
function findChromiumExecutable(): string {
  const candidates = [process.env.PUPPETEER_EXECUTABLE_PATH];

  if (process.platform === 'win32') {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env.LOCALAPPDATA || '';
    candidates.push(
      path.join(programFiles, 'Google/Chrome/Application/chrome.exe'),
      path.join(programFilesX86, 'Google/Chrome/Application/chrome.exe'),
      path.join(programFiles, 'Microsoft/Edge/Application/msedge.exe'),
      path.join(programFilesX86, 'Microsoft/Edge/Application/msedge.exe'),
      ...(localAppData ? [path.join(localAppData, 'Google/Chrome/Application/chrome.exe')] : [])
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    );
  } else {
    candidates.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome');
  }

  const executable = candidates.find((candidate): candidate is string =>
    Boolean(candidate && fs.existsSync(candidate))
  );
  if (!executable) {
    throw new Error(
      'Could not find Chrome, Chromium, or Edge. Install one, then export again. ' +
      'You can also set PUPPETEER_EXECUTABLE_PATH to its executable.'
    );
  }
  return executable;
}

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface RenderConfig {
  jobId: string;
  htmlFile: string;
  htmlContent: string;
  projectData: import('./ipc').ProjectDataForRender;
  outputFile: string;
  width: number;
  height: number;
  fps: number;
  codec: 'h264' | 'h265';
  crf: number;
  useJpeg: boolean;
  audioFiles: AudioClipForRender[];
  workerCount: number;
}

export interface AudioClipForRender {
  file: string;
  start: number;   // ms – delay in video
  duration?: number; // ms – source duration when known
  trimIn: number;  // ms
  trimOut: number; // ms
  volume: number;  // 0–3 (0–300%)
  fadeIn: number;  // ms
  fadeOut: number; // ms
}

export interface RenderProgress {
  jobId: string;
  percent: number;
  framesDone: number;
  totalFrames: number;
  elapsedMs: number;
  etaMs: number;
  stage: 'capturing' | 'encoding' | 'done' | 'error';
  error?: string;
}

export interface RenderJob {
  process: ChildProcess;
  promise: Promise<void>;
}

// ────────────────────────────────────────────────────────────────────────────
// Neutralizer injection (same logic as frontend injectors.ts but for puppeteer)
// ────────────────────────────────────────────────────────────────────────────

const NEUTRALIZE_SCRIPT = `
(function() {
  // 1. Freeze rAF
  window.requestAnimationFrame = (cb) => { setTimeout(() => {}, 9999999); return 0; };
  window.cancelAnimationFrame = () => {};

  // 2. Seeded PRNG (mulberry32) for determinism
  let _s = 1337;
  function m32(a) {
    return function() {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  Math.random = m32(_s);

  // 3. Silence AudioContext
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) {
    const Orig = AC;
    window.AudioContext = window.webkitAudioContext = class extends Orig {
      constructor(o) { super(o); this.suspend().catch(() => {}); }
    };
  }

  // 4. Freeze clocks
  window.__h2v_time = 0;
  const _dn = Date.now.bind(Date);
  const _pn = performance.now.bind(performance);
  Date.now = () => window.__h2v_time || _dn();
  performance.now = () => window.__h2v_time || _pn();

  // 5. No CSS animations/transitions
  // NOTE: this script runs via evaluateOnNewDocument, i.e. BEFORE <html> exists,
  // so document.head / documentElement are null here. Wait for them instead of crashing
  // (a crash here used to stop window.__h2v from being defined => every frame was frame 0).
  const addFreezeCss = function() {
    if (document.getElementById('__h2v_freeze_css')) return;
    const st = document.createElement('style');
    st.id = '__h2v_freeze_css';
    st.textContent = '*, *::before, *::after { transition: none !important; animation-play-state: paused !important; }';
    (document.head || document.documentElement).appendChild(st);
  };
  try {
    if (document.documentElement) addFreezeCss();
    else {
      const mo = new MutationObserver(function() {
        if (document.documentElement) { mo.disconnect(); addFreezeCss(); }
      });
      mo.observe(document, { childList: true });
    }
  } catch (e) {}

  // 6. Override engine: shared with the preview (engine/fxRuntime.ts, injected separately)
  window.__h2v = {
    seek: function(ms, overrides) { window.__h2v_seek(ms, overrides); }
  };
})();
`;

const CAPTURE_CSS = `
  body { margin: 0 !important; padding: 0 !important; overflow: hidden !important; }
  #ctl, #controls, .controls, [id*="control"], #bar:has(button):has(input[type="range"]) { display: none !important; }
  #wrap { position: fixed !important; top: 0 !important; left: 0 !important; margin: 0 !important; }
`;

// ────────────────────────────────────────────────────────────────────────────
// Main export function
// ────────────────────────────────────────────────────────────────────────────

export function startRenderJob(
  config: RenderConfig,
  onProgress: (p: RenderProgress) => void
): RenderJob {
  // Dummy ChildProcess placeholder (real work is async)
  let cancelled = false;
  const abortController = { cancelled: false };

  // Create a fake ChildProcess that can be killed
  const fakeProcess = {
    kill: () => { abortController.cancelled = true; cancelled = true; },
    pid: -1,
    stdin: null, stdout: null, stderr: null,
    on: () => fakeProcess,
    once: () => fakeProcess,
    removeListener: () => fakeProcess,
    emit: () => false,
  } as unknown as ChildProcess;

  const promise = runRender(config, onProgress, abortController);

  return { process: fakeProcess, promise };
}

async function runRender(
  config: RenderConfig,
  onProgress: (p: RenderProgress) => void,
  abort: { cancelled: boolean }
): Promise<void> {
  const {
    jobId, htmlContent, projectData, outputFile,
    width, height, fps, codec, crf, useJpeg,
    audioFiles, workerCount
  } = config;

  const stageW = projectData.source?.stage?.w || 1280;
  const stageH = projectData.source?.stage?.h || 720;
  // Capture at the largest integer-free scale that fits the target frame, then let FFmpeg fit/pad to the exact
  // output size (e.g. 3840x2160 for 4K), keeping the stage's aspect ratio.
  const deviceScaleFactor = Math.max(0.1, Math.min(width / stageW, height / stageH));

  const duration = projectData.source?.duration || 30000;
  const totalFrames = Math.round((duration / 1000) * fps);
  const startTime = Date.now();

  const tempDir = path.join(os.tmpdir(), `h2v-${jobId}`);
  fs.mkdirSync(tempDir, { recursive: true });

  let browser: Browser | null = null;

  try {
    // ── 1. Fix font URLs in HTML ───────────────────────────────────────────
    const fixedHtml = htmlContent.replace(
      /https:\/\/fonts\.googleapis\.com\/css2\?family=([^&"'\s]+)/g,
      (m: string, fam: string) => m.replace(/_/g, '+')
    );

    // ── 2. Save HTML to temp file so Puppeteer can load it ────────────────
    const htmlTempPath = path.join(tempDir, 'page.html');
    // Inject capture CSS before </head>
    const injectedHtml = fixedHtml.replace(
      '</head>',
      // Force 1:1 stage (pages scale themselves to the window via fit(), which would shrink the frame)
      `<style>${CAPTURE_CSS}#stage{transform:none !important;left:0 !important;top:0 !important}#wrap{width:${stageW}px !important;height:${stageH}px !important;border-radius:0 !important}</style></head>`
    );
    fs.writeFileSync(htmlTempPath, injectedHtml, 'utf-8');

    // ── 3. Launch browser ─────────────────────────────────────────────────
    // Find the bundled Chromium path
    const chromiumPath = findChromiumExecutable();

    const ffmpegExecutablePath = getFfmpegExecutablePath();
    if (!ffmpegExecutablePath || !fs.existsSync(ffmpegExecutablePath)) {
      throw new Error('The bundled FFmpeg executable is missing. Reinstall the app dependencies and try again.');
    }

    browser = await puppeteer.launch({
      executablePath: chromiumPath,
      headless: true,
      args: [
        '--disable-dev-shm-usage',
        '--disable-gpu',
        `--window-size=${stageW},${stageH}`,
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({
      width: stageW,
      height: stageH,
      deviceScaleFactor
    });

    // Inject neutralizer before page scripts run
    await page.evaluateOnNewDocument(FX_RUNTIME);
    await page.evaluateOnNewDocument(NEUTRALIZE_SCRIPT);

    // Load the page
    await page.goto(pathToFileURL(htmlTempPath).href + '?capture', {
      waitUntil: ['domcontentloaded', 'networkidle2'],
      timeout: 30000
    });

    // Wait for fonts
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - document is available in the browser context via page.evaluate
    await page.evaluate(() => (document as Document).fonts.ready);

    // Give time for initial paint
    await new Promise(r => setTimeout(r, 500));

    // Guard: fail loudly instead of silently exporting the same frame over and over
    const setupOk = await page.evaluate(() => ({
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      h2v: typeof (self as any).__h2v?.seek === 'function',
      // @ts-ignore
      seek: typeof (self as any).seek === 'function'
    }));
    if (!setupOk.h2v) throw new Error('Export setup failed: the seek controller was not injected into the page.');
    if (!setupOk.seek) throw new Error('This HTML has no global seek(ms) function, so frames cannot be rendered.');

    // ── 4. Project data + web fonts used by typography overrides ───────────
    const project = projectData as unknown as ProjectData;
    const scenes  = project.scenes || [];
    await page.evaluate(
      // @ts-ignore
      (ovs: unknown[]) => { (self as any).__h2v.seek(0, ovs); },
      buildOverrideCommands(0, project) as unknown[]
    );
    // @ts-ignore
    await page.evaluate(() => (self as any).__h2v_waitFonts());

    // ── 5. Capture frames and pipe to FFmpeg ──────────────────────────────
    const ffmpegArgs = buildFfmpegArgs(config, tempDir, audioFiles, totalFrames);
    const ffmpegProc = spawn(ffmpegExecutablePath, ffmpegArgs, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let ffmpegStderr = '';
    ffmpegProc.stderr?.on('data', (d: Buffer) => {
      ffmpegStderr += d.toString();
    });

    const ffmpegDone = new Promise<void>((resolve, reject) => {
      ffmpegProc.on('error', (error: Error) => {
        reject(new Error(`Could not start the bundled FFmpeg executable: ${error.message}`));
      });
      ffmpegProc.on('close', (code: number) => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg exited with code ${code}\n${ffmpegStderr.slice(-2000)}`));
      });
    });

    // Capture each frame
    for (let i = 0; i < totalFrames; i++) {
      if (abort.cancelled) {
        ffmpegProc.kill('SIGTERM');
        throw new Error('Render cancelled');
      }

      const tMs = (i / fps) * 1000;

      // Remap time through scenes (piecewise linear)
      const origMs = remapTime(tMs, scenes);

      // Build overrides for this frame
      const overrides = buildOverrideCommands(tMs, project);

      // Seek the page — window is available in the browser context
      await page.evaluate(
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        (t: number, ovs: unknown[]) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (self as any).__h2v?.seek(t, ovs);
        },
        origMs,
        overrides
      );

      // Wait ~20ms for paint
      await page.evaluate(() => new Promise(r => setTimeout(r, 20)));

      // Screenshot
      const imgType = useJpeg ? 'jpeg' : 'png';
      const screenshot = await page.screenshot({
        type: imgType,
        quality: useJpeg ? 95 : undefined,
        clip: { x: 0, y: 0, width: stageW, height: stageH }
      });

      // Write to FFmpeg stdin
      if (ffmpegProc.stdin && !ffmpegProc.stdin.destroyed) {
        // Respect backpressure so 4K frames don't pile up in memory
        if (!ffmpegProc.stdin.write(screenshot as Buffer)) {
          await new Promise<void>(res => ffmpegProc.stdin!.once('drain', () => res()));
        }
      }

      // Report progress
      const elapsed = Date.now() - startTime;
      const framesDone = i + 1;
      const percent = (framesDone / totalFrames) * 100;
      const etaMs = framesDone > 0
        ? (elapsed / framesDone) * (totalFrames - framesDone)
        : 0;

      onProgress({
        jobId,
        percent,
        framesDone,
        totalFrames,
        elapsedMs: elapsed,
        etaMs,
        stage: 'capturing'
      });
    }

    // Close FFmpeg stdin to signal end of frames
    if (ffmpegProc.stdin && !ffmpegProc.stdin.destroyed) {
      ffmpegProc.stdin.end();
    }

    // Report encoding stage
    onProgress({
      jobId,
      percent: 99,
      framesDone: totalFrames,
      totalFrames,
      elapsedMs: Date.now() - startTime,
      etaMs: 0,
      stage: 'encoding'
    });

    await ffmpegDone;

    // Done
    onProgress({
      jobId,
      percent: 100,
      framesDone: totalFrames,
      totalFrames,
      elapsedMs: Date.now() - startTime,
      etaMs: 0,
      stage: 'done'
    });

  } finally {
    // Always close browser and clean temp files
    if (browser) await browser.close().catch(() => {});
    // Keep tempDir for debugging; clean it up after 5 minutes
    setTimeout(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }, 5 * 60 * 1000);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// FFmpeg argument builder
// ────────────────────────────────────────────────────────────────────────────

function buildFfmpegArgs(
  config: RenderConfig,
  tempDir: string,
  audioFiles: AudioClipForRender[],
  totalFrames: number
): string[] {
  const { outputFile, fps, codec, crf, useJpeg, width, height } = config;

  const imgFormat = useJpeg ? 'mjpeg' : 'png';
  const videoCodec = codec === 'h265' ? 'libx265' : 'libx264';

  const args: string[] = [
    '-y',
    '-f', 'image2pipe',
    '-framerate', String(fps),
    '-c:v', imgFormat,
    '-i', 'pipe:0',   // frames from stdin
  ];

  // Add audio inputs
  audioFiles.forEach(clip => {
    if (fs.existsSync(clip.file)) {
      args.push('-i', clip.file);
    }
  });

  // Filter complex for audio mixing
  const validAudio = audioFiles.filter(c => fs.existsSync(c.file));
  if (validAudio.length > 0) {
    let filterParts: string[] = [];
    let mixInputs = '';

    validAudio.forEach((clip, idx) => {
      const inputIdx = idx + 1; // 0 is video
      const delay = Math.round(clip.start);
      const fadeInSec = clip.fadeIn / 1000;
      const fadeOutSec = clip.fadeOut / 1000;
      const vol = clip.volume;
      const trimInSec = Math.max(0, clip.trimIn / 1000);
      const trimOutSec = Math.max(0, clip.trimOut / 1000);
      const knownClipDurationSec = clip.duration === undefined
        ? undefined
        : Math.max(0, clip.duration / 1000 - trimInSec - trimOutSec);
      const effectiveFadeIn = knownClipDurationSec === undefined
        ? Math.max(0, fadeInSec)
        : Math.min(Math.max(0, fadeInSec), knownClipDurationSec);
      const effectiveFadeOut = knownClipDurationSec === undefined
        ? Math.max(0, fadeOutSec)
        : Math.min(Math.max(0, fadeOutSec), knownClipDurationSec);

      // Trim both ends before applying fades. Reverse + atrim trims from the source tail
      // without needing a separate ffprobe duration lookup. Reset timestamps around the
      // reverse filters so fades are relative to this clip, then place it on the timeline.
      let chain = `[${inputIdx}:a]atrim=start=${trimInSec},asetpts=PTS-STARTPTS`;
      if (trimOutSec > 0) {
        chain += `,areverse,asetpts=PTS-STARTPTS,atrim=start=${trimOutSec},asetpts=PTS-STARTPTS,areverse,asetpts=PTS-STARTPTS`;
      }
      if (effectiveFadeIn > 0) chain += `,afade=t=in:d=${effectiveFadeIn}`;
      if (effectiveFadeOut > 0) {
        chain += `,areverse,asetpts=PTS-STARTPTS,afade=t=in:d=${effectiveFadeOut},areverse,asetpts=PTS-STARTPTS`;
      }
      chain += `,volume=${vol}`;
      if (delay > 0) chain += `,adelay=${delay}|${delay}`;
      chain += `[a${idx}]`;

      filterParts.push(chain);
      mixInputs += `[a${idx}]`;
    });

    if (validAudio.length > 1) {
      filterParts.push(`${mixInputs}amix=inputs=${validAudio.length}:duration=longest[aout]`);
      args.push('-filter_complex', filterParts.join(';'));
      args.push('-map', '0:v', '-map', '[aout]');
    } else {
      filterParts.push(`${mixInputs}anull[aout]`);
      args.push('-filter_complex', filterParts.join(';'));
      args.push('-map', '0:v', '-map', '[aout]');
    }
  } else {
    args.push('-map', '0:v');
  }

  // Force the exact output size (e.g. 3840x2160), keeping the aspect ratio (letter/pillar-box if it differs)
  args.push(
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`
  );
  if (codec === 'h265') args.push('-tag:v', 'hvc1');

  args.push(
    '-c:v', videoCodec,
    '-crf', String(crf),
    '-preset', 'medium',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart'
  );

  if (validAudio.length > 0) {
    args.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
  }

  args.push(outputFile);

  return args;
}
