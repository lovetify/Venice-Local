// Electron main process for Venice Local
// Creates the desktop window and loads our app shell.
const { app, BrowserWindow, session } = require('electron');
const fs = require('fs/promises');
const path = require('path');

async function clearAppData() {
  // Clear cache and storage so packaged builds start clean.
  const userData = app.getPath('userData');
  const serviceWorkerPath = path.join(userData, 'Service Worker');

  // Remove the Service Worker folder directly; clearStorageData sometimes fails if it's corrupted.
  await fs.rm(serviceWorkerPath, { recursive: true, force: true }).catch(() => {});

  const ses = session.defaultSession;
  // Clear both cache + persistent storage to avoid stale auth sessions.
  await ses.clearCache();
  await ses.clearStorageData({
    storages: ['serviceworkers', 'caches', 'indexdb', 'localstorage']
  });
}

function createWindow() {
  // Build the main browser window with preload access.
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 720,
    backgroundColor: '#DEE1DD',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false // Simplified for prototype; allows renderer to access required APIs
    }
  });

  // Use an absolute path so packaged ZIP/DMG can always resolve assets relative to index.html.
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(async () => {
  // Show the UI when Electron is ready.
  await clearAppData();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Quit on all platforms except macOS (common Electron pattern).
  if (process.platform !== 'darwin') app.quit();
});
