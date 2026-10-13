import { IpcMain, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { ChildProcess } from 'child_process';

// Shape of project data passed from renderer (loose typed for IPC)
export interface ProjectDataForRender {
  source?: {
    file?: string;
    duration?: number;
    stage?: { w: number; h: number };
    htmlContent?: string;
  };
  scenes?: Array<{
    id: string;
    name: string;
    start: number;
    end: number;
    orig: { start: number; end: number };
    transition: { type: string; ms: number };
  }>;
  items?: Array<{
    id: string;
    sceneId: string;
    selector: string;
    type: string;
    name: string;
    locked: boolean;
    hidden: boolean;
    originalText?: string;
    override: {
      s?: number;
      d?: number;
      y?: number;
      text?: string;
      posX?: number;
      posY?: number;
      scale?: number;
      rotate?: number;
      style?: Record<string, unknown>;
    };
  }>;
  audio?: Array<{
    id: string;
    file: string;
    name: string;
    start: number;
    trimIn: number;
    trimOut: number;
    volume: number;
    fadeIn: number;
    fadeOut: number;
  }>;
  export?: {
    width: number;
    height: number;
    fps: number;
    codec: string;
    crf: number;
  };
}

// Track active render jobs: jobId -> { process, cancelled }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const activeJobs = new Map<string, { process: any; cancelled: boolean }>();

export function registerRenderHandlers(
  ipcMain: IpcMain,
  getWindow: () => BrowserWindow | null
) {
  /**
   * Start a render job.
   * Config shape matches RenderConfig in renderer.ts.
   */
  ipcMain.handle('render:start', async (_, config: {
    jobId: string;
    htmlFile: string;
    htmlContent: string;
    projectData: ProjectDataForRender;
    outputFile: string;
    width: number;
    height: number;
    fps: number;
    codec: 'h264' | 'h265';
    crf: number;
    useJpeg: boolean;
    audioFiles: unknown[];
    workerCount: number;
  }) => {
    try {
      // Use require to load renderer (CJS, avoids Vite chunk splitting)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { startRenderJob } = require('./renderer') as typeof import('./renderer');

      const job = startRenderJob(config as Parameters<typeof startRenderJob>[0], (progress) => {
        getWindow()?.webContents.send('render:progress', progress);
      });

      activeJobs.set(config.jobId, { process: job.process, cancelled: false });

      job.promise
        .then(() => {
          activeJobs.delete(config.jobId);
          getWindow()?.webContents.send('render:complete', {
            jobId: config.jobId,
            outputFile: config.outputFile
          });
        })
        .catch((error: Error) => {
          activeJobs.delete(config.jobId);
          getWindow()?.webContents.send('render:error', {
            jobId: config.jobId,
            error: error.message || String(error)
          });
        });

      return { success: true, jobId: config.jobId };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  /**
   * Cancel a running render job.
   */
  ipcMain.handle('render:cancel', async (_, jobId: string) => {
    const job = activeJobs.get(jobId);
    if (job) {
      job.cancelled = true;
      try { job.process.kill('SIGTERM'); } catch (_) {}
      activeJobs.delete(jobId);

      // Clean up temp directory
      const tempDir = path.join(os.tmpdir(), `h2v-${jobId}`);
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      return { success: true };
    }
    return { success: false, error: 'Job not found' };
  });

  /**
   * Check if a render job is active.
   */
  ipcMain.handle('render:status', async (_, jobId: string) => {
    return { active: activeJobs.has(jobId) };
  });
}
