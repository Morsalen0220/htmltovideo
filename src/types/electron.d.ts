/**
 * Global type declarations for the Electron preload API.
 * This file is picked up by TypeScript as an ambient declaration
 * and makes window.electronAPI available everywhere without importing.
 */

interface ElectronAPI {
  // File system
  showOpenDialog: (opts: unknown) => Promise<{ canceled: boolean; filePaths: string[] }>;
  showSaveDialog: (opts: unknown) => Promise<{ canceled: boolean; filePath?: string }>;
  readFile: (path: string) => Promise<{ success: boolean; content?: string; error?: string }>;
  writeFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }>;
  shareProject: (project: unknown) => Promise<{ success: boolean; canceled?: boolean; filePath?: string; error?: string }>;
  readFileBinary: (path: string) => Promise<{ success: boolean; data?: string; error?: string }>;
  fileExists: (path: string) => Promise<boolean>;
  mkdir: (path: string) => Promise<{ success: boolean; error?: string }>;
  deleteDir: (path: string) => Promise<{ success: boolean; error?: string }>;
  listDir: (path: string) => Promise<{ success: boolean; files?: string[]; error?: string }>;
  listAudioDownloads: () => Promise<Array<{ name: string; path: string }>>;

  // System info
  getCpuCount: () => Promise<number>;
  getFreeMemory: () => Promise<number>;
  getTotalMemory: () => Promise<number>;
  getPlatform: () => Promise<string>;
  getTempDir: () => Promise<string>;
  getAppDataDir: () => Promise<string>;

  // Shell
  openPath: (path: string) => Promise<void>;
  showItemInFolder: (path: string) => Promise<void>;

  // Preview
  setPreviewHtml: (html: string) => Promise<{ success: boolean }>;

  // Render engine
  startRender: (config: unknown) => Promise<{ success: boolean; jobId?: string; error?: string }>;
  cancelRender: (jobId: string) => Promise<{ success: boolean }>;
  getRenderStatus: (jobId: string) => Promise<{ active: boolean }>;

  // Events
  on: (channel: string, cb: (...args: unknown[]) => void) => () => void;
  removeAllListeners: (channel: string) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
