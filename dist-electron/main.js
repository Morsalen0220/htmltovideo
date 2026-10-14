"use strict";
const electron = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
electron.app.setName("h2video H2VID");
electron.app.disableHardwareAcceleration();
electron.protocol.registerSchemesAsPrivileged([
  {
    scheme: "preview",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
]);
let previewHtml = '<!DOCTYPE html><html><body style="background:#000"></body></html>';
const isDev = process.env.NODE_ENV === "development" && !electron.app.isPackaged;
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";
let mainWindow = null;
function createWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 1600,
    height: 1e3,
    minWidth: 1200,
    minHeight: 700,
    backgroundColor: "#1a1a2e",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      // Allow webview for HTML preview
      sandbox: true
    },
    frame: true,
    show: false,
    title: "h2video H2VID"
  });
  setupMenu();
  if (isDev) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
  mainWindow.once("ready-to-show", () => {
    mainWindow == null ? void 0 : mainWindow.show();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  registerIpcHandlers();
}
function setupMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        { label: "Import HTML...", accelerator: "CmdOrCtrl+O", click: () => mainWindow == null ? void 0 : mainWindow.webContents.send("menu:import") },
        { label: "Save Project", accelerator: "CmdOrCtrl+S", click: () => mainWindow == null ? void 0 : mainWindow.webContents.send("menu:save") },
        { label: "Open Project...", accelerator: "CmdOrCtrl+Shift+O", click: () => mainWindow == null ? void 0 : mainWindow.webContents.send("menu:open") },
        { type: "separator" },
        { label: "Export Video...", accelerator: "CmdOrCtrl+E", click: () => mainWindow == null ? void 0 : mainWindow.webContents.send("menu:export") },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { label: "Undo", accelerator: "CmdOrCtrl+Z", click: () => mainWindow == null ? void 0 : mainWindow.webContents.send("menu:undo") },
        { label: "Redo", accelerator: "CmdOrCtrl+Y", click: () => mainWindow == null ? void 0 : mainWindow.webContents.send("menu:redo") },
        { type: "separator" },
        { label: "Duplicate", accelerator: "CmdOrCtrl+D", click: () => mainWindow == null ? void 0 : mainWindow.webContents.send("menu:duplicate") },
        { label: "Delete", accelerator: "Delete", click: () => mainWindow == null ? void 0 : mainWindow.webContents.send("menu:delete") }
      ]
    },
    {
      label: "View",
      submenu: [
        { label: "Toggle Developer Tools", accelerator: "F12", click: () => mainWindow == null ? void 0 : mainWindow.webContents.toggleDevTools() },
        { role: "reload" },
        { type: "separator" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "resetZoom" }
      ]
    },
    {
      label: "Help",
      submenu: [
        { label: "About", click: () => showAboutDialog() }
      ]
    }
  ];
  const menu = electron.Menu.buildFromTemplate(template);
  electron.Menu.setApplicationMenu(menu);
}
function showAboutDialog() {
  electron.dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "About h2video H2VID",
    message: "h2video H2VID v1.0\nCreated by Morsalen Islam Apple",
    detail: "HTML animation to video studio\n\nCONTACT\nWhatsApp   +880 1762-783339\nTelegram   @morsalen0220\n\nBuilt with Electron, React, Puppeteer, and FFmpeg."
  });
}
function registerIpcHandlers() {
  electron.ipcMain.handle("fs:showOpenDialog", async (_, options) => {
    const result = await electron.dialog.showOpenDialog(mainWindow, options);
    return result;
  });
  electron.ipcMain.handle("fs:showSaveDialog", async (_, options) => {
    const result = await electron.dialog.showSaveDialog(mainWindow, options);
    return result;
  });
  electron.ipcMain.handle("fs:readFile", async (_, filePath) => {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return { success: true, content };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle("fs:writeFile", async (_, filePath, content) => {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, "utf-8");
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle("fs:readFileBinary", async (_, filePath) => {
    try {
      const buffer = fs.readFileSync(filePath);
      return { success: true, data: buffer.toString("base64") };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle("fs:exists", async (_, filePath) => {
    return fs.existsSync(filePath);
  });
  electron.ipcMain.handle("fs:mkdir", async (_, dirPath) => {
    try {
      fs.mkdirSync(dirPath, { recursive: true });
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle("fs:deleteDir", async (_, dirPath) => {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle("fs:listDir", async (_, dirPath) => {
    try {
      const files = fs.readdirSync(dirPath);
      return { success: true, files };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle("system:cpuCount", () => os.cpus().length);
  electron.ipcMain.handle("system:freeMemory", () => os.freemem());
  electron.ipcMain.handle("system:totalMemory", () => os.totalmem());
  electron.ipcMain.handle("system:platform", () => process.platform);
  electron.ipcMain.handle("system:tempDir", () => os.tmpdir());
  electron.ipcMain.handle("system:appDataDir", () => electron.app.getPath("userData"));
  electron.ipcMain.handle("shell:openPath", async (_, filePath) => {
    await electron.shell.openPath(filePath);
  });
  electron.ipcMain.handle("shell:showItemInFolder", async (_, filePath) => {
    electron.shell.showItemInFolder(filePath);
  });
  electron.ipcMain.handle("preview:setHtml", (_, html) => {
    previewHtml = html;
    return { success: true };
  });
  try {
    const { registerRenderHandlers } = require("./ipc");
    registerRenderHandlers(electron.ipcMain, () => mainWindow);
  } catch (e) {
    console.warn("IPC render handlers not loaded:", e);
  }
}
electron.app.whenReady().then(() => {
  electron.protocol.handle("preview", () => {
    return new Response(previewHtml, {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  });
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
