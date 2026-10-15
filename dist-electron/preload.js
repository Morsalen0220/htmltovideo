"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronAPI", {
  // File system
  showOpenDialog: (options) => electron.ipcRenderer.invoke("fs:showOpenDialog", options),
  showSaveDialog: (options) => electron.ipcRenderer.invoke("fs:showSaveDialog", options),
  readFile: (filePath) => electron.ipcRenderer.invoke("fs:readFile", filePath),
  writeFile: (filePath, content) => electron.ipcRenderer.invoke("fs:writeFile", filePath, content),
  shareProject: (project) => electron.ipcRenderer.invoke("project:share", project),
  readFileBinary: (filePath) => electron.ipcRenderer.invoke("fs:readFileBinary", filePath),
  fileExists: (filePath) => electron.ipcRenderer.invoke("fs:exists", filePath),
  mkdir: (dirPath) => electron.ipcRenderer.invoke("fs:mkdir", dirPath),
  deleteDir: (dirPath) => electron.ipcRenderer.invoke("fs:deleteDir", dirPath),
  listDir: (dirPath) => electron.ipcRenderer.invoke("fs:listDir", dirPath),
  listAudioDownloads: () => electron.ipcRenderer.invoke("browser:listAudioDownloads"),
  // System info
  getCpuCount: () => electron.ipcRenderer.invoke("system:cpuCount"),
  getFreeMemory: () => electron.ipcRenderer.invoke("system:freeMemory"),
  getTotalMemory: () => electron.ipcRenderer.invoke("system:totalMemory"),
  getPlatform: () => electron.ipcRenderer.invoke("system:platform"),
  getTempDir: () => electron.ipcRenderer.invoke("system:tempDir"),
  getAppDataDir: () => electron.ipcRenderer.invoke("system:appDataDir"),
  // Shell
  openPath: (filePath) => electron.ipcRenderer.invoke("shell:openPath", filePath),
  showItemInFolder: (filePath) => electron.ipcRenderer.invoke("shell:showItemInFolder", filePath),
  // Preview HTML — pushes HTML to main process served via preview:// protocol
  setPreviewHtml: (html) => electron.ipcRenderer.invoke("preview:setHtml", html),
  // Render engine
  startRender: (config) => electron.ipcRenderer.invoke("render:start", config),
  cancelRender: (jobId) => electron.ipcRenderer.invoke("render:cancel", jobId),
  getRenderStatus: (jobId) => electron.ipcRenderer.invoke("render:status", jobId),
  // Events from main process
  on: (channel, callback) => {
    const allowedChannels = [
      "menu:import",
      "menu:save",
      "menu:open",
      "menu:share",
      "menu:export",
      "menu:undo",
      "menu:redo",
      "menu:duplicate",
      "menu:delete",
      "render:progress",
      "render:complete",
      "render:error",
      "browser:download-complete",
      "html-audio:download-complete"
    ];
    if (allowedChannels.includes(channel)) {
      const subscription = (_event, ...args) => callback(...args);
      electron.ipcRenderer.on(channel, subscription);
      return () => electron.ipcRenderer.removeListener(channel, subscription);
    }
    return () => {
    };
  },
  removeAllListeners: (channel) => electron.ipcRenderer.removeAllListeners(channel)
});
