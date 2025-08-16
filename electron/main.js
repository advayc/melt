const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');
const activeWin = require('active-win');
const fs = require('fs');

let mainWindow;
let usage = {}; // { bundleId: { name, iconDataURL, totalMs, lastStart, sessions: [] } }
let pollingInterval;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    title: 'Screen Time Tracker',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  const url = isDev ? 'http://localhost:5173' : path.join(__dirname, '../dist/index.html');
  if (isDev) {
    mainWindow.loadURL(url);
  } else {
    mainWindow.loadFile(url);
  }
}

async function pollActiveApp() {
  try {
    const info = await activeWin();
    const now = Date.now();
    if (!info) return;
    const { owner, title } = info;
    if (!owner) return;
    const id = owner.bundleId || owner.name;
    if (!usage[id]) {
      let iconDataURL = null;
      if (owner.icon) {
        try {
          const img = nativeImage.createFromBuffer(owner.icon);
          iconDataURL = img.resize({ width: 32, height: 32 }).toDataURL();
        } catch {}
      }
      usage[id] = {
        name: owner.name,
        iconDataURL,
        totalMs: 0,
        lastStart: now,
        sessions: []
      };
    }
    // update timing
    for (const key of Object.keys(usage)) {
      const appUsage = usage[key];
      if (key === id) {
        if (!appUsage.lastStart) appUsage.lastStart = now;
      } else if (appUsage.lastStart) {
        // the app lost focus, close its session segment
        const delta = now - appUsage.lastStart;
        appUsage.totalMs += delta;
        appUsage.sessions.push({ start: appUsage.lastStart, end: now, duration: delta, title: appUsage.name });
        appUsage.lastStart = null;
      }
    }
    // ensure current app has start timestamp
    usage[id].lastStart = usage[id].lastStart || now;

    if (mainWindow) {
      mainWindow.webContents.send('usage:update', serializeUsage());
    }
  } catch (e) {
    // swallow polling errors
  }
}

function serializeUsage() {
  const now = Date.now();
  return Object.entries(usage).map(([id, u]) => {
    let runningMs = u.totalMs;
    if (u.lastStart) runningMs += (now - u.lastStart);
    return {
      id,
      name: u.name,
      iconDataURL: u.iconDataURL,
      totalMs: runningMs,
      sessions: u.sessions
    };
  }).sort((a,b)=>b.totalMs - a.totalMs);
}

ipcMain.handle('usage:get', () => {
  return serializeUsage();
});

ipcMain.handle('usage:export', () => {
  const data = JSON.stringify(serializeUsage(), null, 2);
  const file = path.join(app.getPath('documents'), `screen-time-${Date.now()}.json`);
  fs.writeFileSync(file, data);
  return file;
});

app.whenReady().then(() => {
  createWindow();
  pollingInterval = setInterval(pollActiveApp, 3000); // 3s granularity
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  clearInterval(pollingInterval);
});
