"use strict";
const electron = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const archiver = require("archiver");
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
  mainWindow.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    if (params.partition === "h2v-browser") {
      webPreferences.nodeIntegrationInSubFrames = false;
    }
  });
  mainWindow.webContents.on("did-attach-webview", (_event, guestContents) => {
    guestContents.on("will-navigate", (event, url) => {
      if (!/^(https?:|preview:)/i.test(url)) event.preventDefault();
    });
    guestContents.session.on("will-download", (event, item, sourceContents) => {
      if ((sourceContents == null ? void 0 : sourceContents.id) !== guestContents.id) return;
      const downloadDir = path.join(electron.app.getPath("userData"), "html-audio-downloads");
      fs.mkdirSync(downloadDir, { recursive: true });
      const originalName = path.basename(item.getFilename()).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${originalName || "animation-audio.wav"}`;
      const filePath = path.join(downloadDir, filename);
      item.setSavePath(filePath);
      item.once("done", (_downloadEvent, state) => {
        if (state === "completed") mainWindow == null ? void 0 : mainWindow.webContents.send("html-audio:download-complete", {
          name: originalName || "Animation audio",
          path: filePath
        });
      });
    });
    guestContents.setWindowOpenHandler(({ url }) => {
      if (guestContents.session === electron.session.fromPartition("h2v-browser")) {
        if (/^https?:\/\//i.test(url)) void guestContents.loadURL(url).catch((error) => console.warn("[Browser] Popup navigation failed:", error));
      } else if (/^https?:\/\//i.test(url)) {
        void electron.shell.openExternal(url);
      }
      return { action: "deny" };
    });
    guestContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown" || !(input.control || input.meta) || input.alt) return;
      const key = input.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        mainWindow == null ? void 0 : mainWindow.webContents.send(input.shift ? "menu:redo" : "menu:undo");
      } else if (key === "y") {
        event.preventDefault();
        mainWindow == null ? void 0 : mainWindow.webContents.send("menu:redo");
      }
    });
  });
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
function setupBrowserDownloads() {
  const browserSession = electron.session.fromPartition("h2v-browser");
  browserSession.on("will-download", (_event, item) => {
    const downloadDir = path.join(electron.app.getPath("userData"), "browser-downloads");
    fs.mkdirSync(downloadDir, { recursive: true });
    const originalName = path.basename(item.getFilename()).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${originalName || "download"}`;
    const filePath = path.join(downloadDir, filename);
    item.setSavePath(filePath);
    item.once("done", (_event2, state) => {
      if (state === "completed") mainWindow == null ? void 0 : mainWindow.webContents.send("browser:download-complete", { name: originalName, path: filePath });
    });
  });
}
function setupMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        { label: "Import HTML...", accelerator: "CmdOrCtrl+O", click: () => mainWindow == null ? void 0 : mainWindow.webContents.send("menu:import") },
        { label: "Save Project", accelerator: "CmdOrCtrl+S", click: () => mainWindow == null ? void 0 : mainWindow.webContents.send("menu:save") },
        { label: "Open Project...", accelerator: "CmdOrCtrl+Shift+O", click: () => mainWindow == null ? void 0 : mainWindow.webContents.send("menu:open") },
        { label: "Project Share...", click: () => mainWindow == null ? void 0 : mainWindow.webContents.send("menu:share") },
        { type: "separator" },
        { label: "Export Video...", accelerator: "CmdOrCtrl+E", click: () => mainWindow == null ? void 0 : mainWindow.webContents.send("menu:export") },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { label: "Undo", accelerator: "CmdOrCtrl+Z", registerAccelerator: false, click: () => mainWindow == null ? void 0 : mainWindow.webContents.send("menu:undo") },
        { label: "Redo", accelerator: "CmdOrCtrl+Y", registerAccelerator: false, click: () => mainWindow == null ? void 0 : mainWindow.webContents.send("menu:redo") },
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
  electron.ipcMain.handle("project:share", async (_, input) => {
    var _a;
    try {
      const project = input;
      if (!((_a = project == null ? void 0 : project.source) == null ? void 0 : _a.file) || !Array.isArray(project.audio)) throw new Error("No project is open.");
      const sourcePath = String(project.source.file);
      const projectName = path.basename(sourcePath, path.extname(sourcePath)).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") || "project";
      const result = await electron.dialog.showSaveDialog(mainWindow, {
        title: "Share Project",
        defaultPath: `${projectName}-share.zip`,
        filters: [{ name: "ZIP Archive", extensions: ["zip"] }]
      });
      if (result.canceled || !result.filePath) return { success: false, canceled: true };
      const sourceHtml = project.source.htmlContent || (fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, "utf8") : "");
      if (!sourceHtml) throw new Error("The original HTML file could not be found. Re-import it before sharing.");
      const output = fs.createWriteStream(result.filePath);
      const archive = archiver("zip", { zlib: { level: 6 } });
      const completed = new Promise((resolve, reject) => {
        output.once("close", resolve);
        output.once("error", reject);
        archive.once("error", reject);
      });
      archive.pipe(output);
      const root = projectName;
      const bundled = JSON.parse(JSON.stringify(project));
      bundled.source.file = "assets/source.html";
      delete bundled.source.htmlContent;
      archive.append(sourceHtml, { name: `${root}/assets/source.html` });
      const fileMap = /* @__PURE__ */ new Map();
      const addAsset = (file, preferredName) => {
        if (!file || fileMap.has(file)) return fileMap.get(file) || "";
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`Project asset is missing: ${file}`);
        const ext = path.extname(preferredName) || path.extname(file);
        const safeName = `${fileMap.size + 1}-${path.basename(preferredName, path.extname(preferredName)).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")}${ext}`;
        const archivePath = `assets/audio/${safeName}`;
        archive.file(file, { name: `${root}/${archivePath}` });
        fileMap.set(file, archivePath);
        return archivePath;
      };
      for (const clip of bundled.audio) clip.file = addAsset(clip.file, clip.name || path.basename(clip.file));
      for (const asset of bundled.audioAssets || []) asset.file = addAsset(asset.file, asset.name || path.basename(asset.file));
      archive.append(JSON.stringify(bundled, null, 2), { name: `${root}/project.h2v.json` });
      archive.append("Open project.h2v.json from this folder in h2video H2VID. Keep the assets folder beside it.", { name: `${root}/README.txt` });
      await archive.finalize();
      await completed;
      return { success: true, filePath: result.filePath };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
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
  electron.ipcMain.handle("browser:listAudioDownloads", () => {
    const downloadDir = path.join(electron.app.getPath("userData"), "browser-downloads");
    if (!fs.existsSync(downloadDir)) return [];
    const extensions = /* @__PURE__ */ new Set([".mp3", ".wav", ".ogg", ".oga", ".opus", ".m4a", ".aac", ".flac", ".aiff", ".aif"]);
    return fs.readdirSync(downloadDir, { withFileTypes: true }).filter((entry) => entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())).map((entry) => ({ name: entry.name.replace(/^\d+-[a-z0-9]+-/, "").replace(/\.[^.]+$/, ""), path: path.join(downloadDir, entry.name) })).sort((a, b) => b.path.localeCompare(a.path));
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
  setupBrowserDownloads();
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
