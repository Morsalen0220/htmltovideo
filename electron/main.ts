import { app, BrowserWindow, ipcMain, dialog, shell, Menu, protocol } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';

app.setName('h2video H2VID');

// Disable GPU sandbox for Puppeteer compatibility
// Avoid black webview previews on systems where Chromium's GPU mailbox fails.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');

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
      sandbox: false
    },
    frame: true,
    show: false,
    title: 'h2video H2VID'
  });

  // Setup application menu
  setupMenu();

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

function setupMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'Import HTML...', accelerator: 'CmdOrCtrl+O', click: () => mainWindow?.webContents.send('menu:import') },
        { label: 'Save Project', accelerator: 'CmdOrCtrl+S', click: () => mainWindow?.webContents.send('menu:save') },
        { label: 'Open Project...', accelerator: 'CmdOrCtrl+Shift+O', click: () => mainWindow?.webContents.send('menu:open') },
        { type: 'separator' },
        { label: 'Export Video...', accelerator: 'CmdOrCtrl+E', click: () => mainWindow?.webContents.send('menu:export') },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => mainWindow?.webContents.send('menu:undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Y', click: () => mainWindow?.webContents.send('menu:redo') },
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
