import { contextBridge, ipcRenderer } from 'electron';

// Expose safe IPC bridge to the renderer process
// All IPC calls go through this bridge for security
contextBridge.exposeInMainWorld('electronAPI', {
  // File system
  showOpenDialog: (options: Electron.OpenDialogOptions) =>
    ipcRenderer.invoke('fs:showOpenDialog', options),
  
  showSaveDialog: (options: Electron.SaveDialogOptions) =>
    ipcRenderer.invoke('fs:showSaveDialog', options),
  
  readFile: (filePath: string) =>
    ipcRenderer.invoke('fs:readFile', filePath),
  
  writeFile: (filePath: string, content: string) =>
    ipcRenderer.invoke('fs:writeFile', filePath, content),

  shareProject: (project: unknown) => ipcRenderer.invoke('project:share', project),

  readFileBinary: (filePath: string) =>
    ipcRenderer.invoke('fs:readFileBinary', filePath),
  
  fileExists: (filePath: string) =>
    ipcRenderer.invoke('fs:exists', filePath),

  mkdir: (dirPath: string) =>
    ipcRenderer.invoke('fs:mkdir', dirPath),

  deleteDir: (dirPath: string) =>
    ipcRenderer.invoke('fs:deleteDir', dirPath),

  listDir: (dirPath: string) =>
    ipcRenderer.invoke('fs:listDir', dirPath),

  listAudioDownloads: () => ipcRenderer.invoke('browser:listAudioDownloads'),

  // System info
  getCpuCount: () => ipcRenderer.invoke('system:cpuCount'),
  getFreeMemory: () => ipcRenderer.invoke('system:freeMemory'),
  getTotalMemory: () => ipcRenderer.invoke('system:totalMemory'),
  getPlatform: () => ipcRenderer.invoke('system:platform'),
  getTempDir: () => ipcRenderer.invoke('system:tempDir'),
  getAppDataDir: () => ipcRenderer.invoke('system:appDataDir'),

  // Shell
  openPath: (filePath: string) => ipcRenderer.invoke('shell:openPath', filePath),
  showItemInFolder: (filePath: string) => ipcRenderer.invoke('shell:showItemInFolder', filePath),

  // Preview HTML — pushes HTML to main process served via preview:// protocol
  setPreviewHtml: (html: string) => ipcRenderer.invoke('preview:setHtml', html),

  // Render engine
  startRender: (config: unknown) => ipcRenderer.invoke('render:start', config),
  cancelRender: (jobId: string) => ipcRenderer.invoke('render:cancel', jobId),
  getRenderStatus: (jobId: string) => ipcRenderer.invoke('render:status', jobId),

  // Events from main process
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const allowedChannels = [
      'menu:import', 'menu:save', 'menu:open', 'menu:share', 'menu:export',
      'menu:undo', 'menu:redo', 'menu:duplicate', 'menu:delete',
      'render:progress', 'render:complete', 'render:error', 'browser:download-complete',
      'html-audio:download-complete'
    ];
    if (allowedChannels.includes(channel)) {
      const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    }
    return () => {};
  },

  removeAllListeners: (channel: string) => ipcRenderer.removeAllListeners(channel)
});
