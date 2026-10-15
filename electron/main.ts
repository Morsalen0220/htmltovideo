import { app, BrowserWindow, ipcMain, dialog, shell, Menu, protocol, session } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
const archiver = require('archiver') as (format: string, options?: Record<string, unknown>) => any;

app.setName('h2video H2VID');

// Disable GPU acceleration to avoid black webview previews on affected systems.
app.disableHardwareAcceleration();

// ── Custom preview:// protocol ────────────────────────────────────────────────
// Must be registered BEFORE app.whenReady()
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'preview',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
]);

// In-memory HTML store — updated by IPC when user imports a file
let previewHtml = '<!DOCTYPE html><html><body style="background:#000"></body></html>';

const isDev = process.env.NODE_ENV === 'development' && !app.isPackaged;
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 700,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true, // Allow webview for HTML preview
      sandbox: true
    },
    frame: true,
    show: false,
    title: 'h2video H2VID'
  });

  // Setup application menu
  setupMenu();

  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    // Never allow embedded pages to inherit a preload or Node integration.
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    if (params.partition === 'h2v-browser') {
      webPreferences.nodeIntegrationInSubFrames = false;
    }
  });

  // Keyboard focus inside the preview <webview> does not bubble to the React
  // window. Route editor Undo/Redo shortcuts from that guest WebContents too.
  mainWindow.webContents.on('did-attach-webview', (_event, guestContents) => {
    guestContents.on('will-navigate', (event, url) => {
      if (!/^(https?:|preview:)/i.test(url)) event.preventDefault();
    });
    // HTML animations can expose a WAV download button (or a
    // window.__H2VID_EXPORT_AUDIO__ hook). Keep those downloads separate from
    // the browser panel's download folder and report them back to the editor.
    guestContents.session.on('will-download', (event, item, sourceContents) => {
      if (sourceContents?.id !== guestContents.id) return;
      const downloadDir = path.join(app.getPath('userData'), 'html-audio-downloads');
      fs.mkdirSync(downloadDir, { recursive: true });
      const originalName = path.basename(item.getFilename()).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${originalName || 'animation-audio.wav'}`;
      const filePath = path.join(downloadDir, filename);
      item.setSavePath(filePath);
      item.once('done', (_downloadEvent, state) => {
        if (state === 'completed') mainWindow?.webContents.send('html-audio:download-complete', {
          name: originalName || 'Animation audio', path: filePath
        });
      });
    });
    guestContents.setWindowOpenHandler(({ url }) => {
      if (guestContents.session === session.fromPartition('h2v-browser')) {
        // This lightweight browser has no tabs, so keep ordinary popup pages in
        // the same panel and never hand custom app protocols to Windows.
        if (/^https?:\/\//i.test(url)) void guestContents.loadURL(url).catch(error => console.warn('[Browser] Popup navigation failed:', error));
      } else if (/^https?:\/\//i.test(url)) {
        void shell.openExternal(url);
      }
      return { action: 'deny' };
    });
    guestContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
      const key = input.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        mainWindow?.webContents.send(input.shift ? 'menu:redo' : 'menu:undo');
      } else if (key === 'y') {
        event.preventDefault();
        mainWindow?.webContents.send('menu:redo');
      }
    });
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' }); // separate window, so it doesn't squeeze the app
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Register IPC handlers
  registerIpcHandlers();
}

function setupBrowserDownloads() {
  const browserSession = session.fromPartition('h2v-browser');
  browserSession.on('will-download', (_event, item) => {
    const downloadDir = path.join(app.getPath('userData'), 'browser-downloads');
    fs.mkdirSync(downloadDir, { recursive: true });
    const originalName = path.basename(item.getFilename()).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${originalName || 'download'}`;
    const filePath = path.join(downloadDir, filename);
    item.setSavePath(filePath);
    item.once('done', (_event, state) => {
      if (state === 'completed') mainWindow?.webContents.send('browser:download-complete', { name: originalName, path: filePath });
    });
  });
}

function setupMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'Import HTML...', accelerator: 'CmdOrCtrl+O', click: () => mainWindow?.webContents.send('menu:import') },
        { label: 'Save Project', accelerator: 'CmdOrCtrl+S', click: () => mainWindow?.webContents.send('menu:save') },
        { label: 'Open Project...', accelerator: 'CmdOrCtrl+Shift+O', click: () => mainWindow?.webContents.send('menu:open') },
        { label: 'Project Share...', click: () => mainWindow?.webContents.send('menu:share') },
        { type: 'separator' },
        { label: 'Export Video...', accelerator: 'CmdOrCtrl+E', click: () => mainWindow?.webContents.send('menu:export') },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', registerAccelerator: false, click: () => mainWindow?.webContents.send('menu:undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Y', registerAccelerator: false, click: () => mainWindow?.webContents.send('menu:redo') },
        { type: 'separator' },
        { label: 'Duplicate', accelerator: 'CmdOrCtrl+D', click: () => mainWindow?.webContents.send('menu:duplicate') },
        { label: 'Delete', accelerator: 'Delete', click: () => mainWindow?.webContents.send('menu:delete') }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Developer Tools', accelerator: 'F12', click: () => mainWindow?.webContents.toggleDevTools() },
        { role: 'reload' },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'About', click: () => showAboutDialog() }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function showAboutDialog() {
  dialog.showMessageBox(mainWindow!, {
    type: 'info',
    title: 'About h2video H2VID',
    message: 'h2video H2VID v1.0\nCreated by Morsalen Islam Apple',
    detail: 'HTML animation to video studio\n\n' +
      'CONTACT\n' +
      'WhatsApp   +880 1762-783339\n' +
      'Telegram   @morsalen0220\n\n' +
      'Built with Electron, React, Puppeteer, and FFmpeg.'
  });
}

function registerIpcHandlers() {
  ipcMain.handle('project:share', async (_, input: unknown) => {
    try {
      const project = input as any;
      if (!project?.source?.file || !Array.isArray(project.audio)) throw new Error('No project is open.');
      const sourcePath = String(project.source.file);
      const projectName = path.basename(sourcePath, path.extname(sourcePath)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'project';
      const result = await dialog.showSaveDialog(mainWindow!, {
        title: 'Share Project',
        defaultPath: `${projectName}-share.zip`,
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }]
      });
      if (result.canceled || !result.filePath) return { success: false, canceled: true };

      const sourceHtml = project.source.htmlContent || (fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, 'utf8') : '');
      if (!sourceHtml) throw new Error('The original HTML file could not be found. Re-import it before sharing.');

      const output = fs.createWriteStream(result.filePath);
      const archive = archiver('zip', { zlib: { level: 6 } });
      const completed = new Promise<void>((resolve, reject) => {
        output.once('close', resolve);
        output.once('error', reject);
        archive.once('error', reject);
      });
      archive.pipe(output);
      const root = projectName;
      const bundled = JSON.parse(JSON.stringify(project));
      bundled.source.file = 'assets/source.html';
      delete bundled.source.htmlContent;
      archive.append(sourceHtml, { name: `${root}/assets/source.html` });

      const fileMap = new Map<string, string>();
      const addAsset = (file: string, preferredName: string) => {
        if (!file || fileMap.has(file)) return fileMap.get(file) || '';
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`Project asset is missing: ${file}`);
        const ext = path.extname(preferredName) || path.extname(file);
        const safeName = `${fileMap.size + 1}-${path.basename(preferredName, path.extname(preferredName)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}${ext}`;
        const archivePath = `assets/audio/${safeName}`;
        archive.file(file, { name: `${root}/${archivePath}` });
        fileMap.set(file, archivePath);
        return archivePath;
      };
      for (const clip of bundled.audio) clip.file = addAsset(clip.file, clip.name || path.basename(clip.file));
      for (const asset of bundled.audioAssets || []) asset.file = addAsset(asset.file, asset.name || path.basename(asset.file));
      archive.append(JSON.stringify(bundled, null, 2), { name: `${root}/project.h2v.json` });
      archive.append('Open project.h2v.json from this folder in h2video H2VID. Keep the assets folder beside it.', { name: `${root}/README.txt` });
      await archive.finalize();
      await completed;
      return { success: true, filePath: result.filePath };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // File system operations
  ipcMain.handle('fs:showOpenDialog', async (_, options) => {
    const result = await dialog.showOpenDialog(mainWindow!, options);
    return result;
  });

  ipcMain.handle('fs:showSaveDialog', async (_, options) => {
    const result = await dialog.showSaveDialog(mainWindow!, options);
    return result;
  });

  ipcMain.handle('fs:readFile', async (_, filePath: string) => {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return { success: true, content };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('fs:writeFile', async (_, filePath: string, content: string) => {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, 'utf-8');
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('fs:readFileBinary', async (_, filePath: string) => {
    try {
      const buffer = fs.readFileSync(filePath);
      return { success: true, data: buffer.toString('base64') };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('fs:exists', async (_, filePath: string) => {
    return fs.existsSync(filePath);
  });

  ipcMain.handle('fs:mkdir', async (_, dirPath: string) => {
    try {
      fs.mkdirSync(dirPath, { recursive: true });
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('fs:deleteDir', async (_, dirPath: string) => {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('fs:listDir', async (_, dirPath: string) => {
    try {
      const files = fs.readdirSync(dirPath);
      return { success: true, files };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('browser:listAudioDownloads', () => {
    const downloadDir = path.join(app.getPath('userData'), 'browser-downloads');
    if (!fs.existsSync(downloadDir)) return [];
    const extensions = new Set(['.mp3', '.wav', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.flac', '.aiff', '.aif']);
    return fs.readdirSync(downloadDir, { withFileTypes: true })
      .filter(entry => entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase()))
      .map(entry => ({ name: entry.name.replace(/^\d+-[a-z0-9]+-/, '').replace(/\.[^.]+$/, ''), path: path.join(downloadDir, entry.name) }))
      .sort((a, b) => b.path.localeCompare(a.path));
  });

  // System info
  ipcMain.handle('system:cpuCount', () => os.cpus().length);
  ipcMain.handle('system:freeMemory', () => os.freemem());
  ipcMain.handle('system:totalMemory', () => os.totalmem());
  ipcMain.handle('system:platform', () => process.platform);
  ipcMain.handle('system:tempDir', () => os.tmpdir());
  ipcMain.handle('system:appDataDir', () => app.getPath('userData'));

  // Shell operations
  ipcMain.handle('shell:openPath', async (_, filePath: string) => {
    await shell.openPath(filePath);
  });

  ipcMain.handle('shell:showItemInFolder', async (_, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  // Preview HTML — store in memory, served by preview:// protocol
  ipcMain.handle('preview:setHtml', (_, html: string) => {
    previewHtml = html;
    return { success: true };
  });

  // Render process IPC (these are implemented in ipc.ts)
  // Pass a getter lambda so ipc.ts always gets the current mainWindow
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { registerRenderHandlers } = require('./ipc');
    registerRenderHandlers(ipcMain, () => mainWindow);
  } catch (e) {
    console.warn('IPC render handlers not loaded:', e);
  }
}

app.whenReady().then(() => {
  setupBrowserDownloads();
  // Serve in-memory HTML via preview:// scheme
  protocol.handle('preview', () => {
    return new Response(previewHtml, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
