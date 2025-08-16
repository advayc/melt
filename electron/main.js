const { app, BrowserWindow, ipcMain, nativeImage, powerMonitor, systemPreferences, nativeTheme } = require('electron');
const path = require('path');
const { exec } = require('child_process');
// electron-is-dev was ESM only; use built-in isPackaged flag instead
const isDev = !app.isPackaged;
let getActiveWindow;
import('active-win').then(mod => { getActiveWindow = mod.default || mod; }).catch(()=>{});
const fs = require('fs');

let mainWindow;
let usage = {}; // { bundleId: { name, iconDataURL, totalMs, lastStart, sessions: [] } }
let pollingInterval;
let isIdle = false;
let lastActiveTime = Date.now();
let systemUsageData = {};

// ---- Screen Time (knowledgeC.db) integration ----
// We cache results to avoid hammering the SQLite DB each second.
let lastScreenTimeFetch = 0;
let cachedScreenTimeData = [];
const SCREEN_TIME_FETCH_INTERVAL_MS = 5 * 60 * 1000; // 5 min

async function getScreenTimeData(force = false) {
  const now = Date.now();
  if (!force && (now - lastScreenTimeFetch) < SCREEN_TIME_FETCH_INTERVAL_MS && cachedScreenTimeData.length) {
    return cachedScreenTimeData;
  }
  return new Promise((resolve) => {
    // Apple timestamps are seconds since 2001-01-01 (Mac absolute time). Need to add 978307200 to get Unix epoch.
    // Query last 24h usage sessions and aggregate per bundle id.
    const sql = `
      SELECT
        ZOBJECT.ZVALUESTRING AS bundle_id,
        (ZOBJECT.ZENDDATE - ZOBJECT.ZSTARTDATE) AS usage_seconds,
        (ZOBJECT.ZSTARTDATE + 978307200) AS start_unix,
        (ZOBJECT.ZENDDATE + 978307200) AS end_unix
      FROM ZOBJECT
      WHERE ZOBJECT.ZSTREAMNAME = '/app/usage'
        AND ZOBJECT.ZSTARTDATE > (strftime('%s','now') - 86400 - 978307200)
        AND ZOBJECT.ZENDDATE > 0
        AND ZOBJECT.ZENDDATE >= ZOBJECT.ZSTARTDATE
    `;
    exec(`sqlite3 ~/Library/Application\\ Support/Knowledge/knowledgeC.db "${sql}"`, (error, stdout, stderr) => {
      if (error || !stdout) {
        if (stderr && /Permission denied/i.test(stderr)) {
          console.log('Screen Time DB permission denied. Grant Full Disk Access to this app.');
        }
        resolve([]); // fallback only
        return;
      }
      const lines = stdout.trim().split('\n').filter(Boolean);
      const raw = lines.map(l => {
        const parts = l.split('|');
        const [bundle_id, usage_seconds, start_unix, end_unix] = parts;
        return {
          bundle_id,
            usage_seconds: parseFloat(usage_seconds) || 0,
            start: parseFloat(start_unix) * 1000,
            end: parseFloat(end_unix) * 1000
        };
      }).filter(r => r.bundle_id && r.usage_seconds > 0);

      // Aggregate per bundle
      const aggregate = {};
      for (const r of raw) {
        if (!aggregate[r.bundle_id]) {
          aggregate[r.bundle_id] = { bundle_id: r.bundle_id, totalMs: 0, sessions: [] };
        }
        const ms = r.usage_seconds * 1000;
        aggregate[r.bundle_id].totalMs += ms;
        aggregate[r.bundle_id].sessions.push({ start: r.start, end: r.end, duration: ms });
      }
      cachedScreenTimeData = Object.values(aggregate);
      lastScreenTimeFetch = now;
      resolve(cachedScreenTimeData);
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    title: 'Screen Time Tracker',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d1117' : '#ffffff',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  // Apply theme based on system preference
  mainWindow.webContents.on('did-finish-load', () => {
    const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
    mainWindow.webContents.executeJavaScript(`
      document.documentElement.setAttribute('data-theme', '${theme}');
    `);
  });

  const url = isDev ? 'http://localhost:5174' : path.join(__dirname, '../dist/index.html');
  if (isDev) {
    mainWindow.loadURL(url);
  } else {
    mainWindow.loadFile(url);
  }
}

async function pollActiveApp() {
  try {
    if (!getActiveWindow) return; // module not yet loaded
    
    // Check for system idle state
    const idleTime = powerMonitor.getSystemIdleTime();
    const wasIdle = isIdle;
    isIdle = idleTime > 30; // 30 seconds idle threshold
    
    if (isIdle && !wasIdle) {
      // Just went idle, pause all active sessions
      pauseAllActiveSessions();
      return;
    } else if (!isIdle && wasIdle) {
      // Just became active again
      lastActiveTime = Date.now();
    }
    
    if (isIdle) return; // Don't track while idle
    
    // Periodically fold in Screen Time baseline so we have usage even if app was closed earlier
    try {
      const screenTimeData = await getScreenTimeData();
      if (screenTimeData.length) {
        mergeScreenTimeBaseline(screenTimeData);
      }
    } catch {}
    
    // Fallback to active window polling
    const info = await getActiveWindow();
    const now = Date.now();
    if (!info) return;
    const { owner, title } = info;
    if (!owner) return;
    
    const id = owner.bundleId || owner.name;
    const processName = owner.name;
    
    if (!usage[id]) {
      let iconDataURL = null;
      if (owner.icon) {
        try {
          const img = nativeImage.createFromBuffer(owner.icon);
          iconDataURL = img.resize({ width: 32, height: 32 }).toDataURL();
        } catch {}
      }
      
      // Try to get additional app info from macOS
      let appPath = '';
      try {
        if (owner.bundleId) {
          appPath = await getAppPath(owner.bundleId);
        }
      } catch {}
      
      usage[id] = {
        name: processName,
        bundleId: owner.bundleId,
        iconDataURL,
        appPath,
        totalMs: 0,
        lastStart: now,
        sessions: [],
        windowTitle: title
      };
    }
    
    // Update timing for all apps
    for (const key of Object.keys(usage)) {
      const appUsage = usage[key];
      if (key === id) {
        // Current active app
        if (!appUsage.lastStart) appUsage.lastStart = now;
        appUsage.windowTitle = title; // Update current window title
      } else if (appUsage.lastStart) {
        // App lost focus, close its session segment
        const delta = now - appUsage.lastStart;
        appUsage.totalMs += delta;
        appUsage.sessions.push({ 
          start: appUsage.lastStart, 
          end: now, 
          duration: delta, 
          title: appUsage.windowTitle || appUsage.name 
        });
        appUsage.lastStart = null;
      }
    }
    
    // Ensure current app has start timestamp
    usage[id].lastStart = usage[id].lastStart || now;

    if (mainWindow) {
      mainWindow.webContents.send('usage:update', serializeUsage());
    }
  } catch (e) {
    console.error('Polling error:', e);
  }
}

function mergeScreenTimeBaseline(baseline) {
  for (const entry of baseline) {
    const id = entry.bundle_id;
    if (!id) continue;
    if (!usage[id]) {
      usage[id] = {
        name: id.split('.').slice(-1)[0] || id,
        bundleId: id,
        iconDataURL: null,
        appPath: '',
        totalMs: entry.totalMs,
        lastStart: null,
        sessions: entry.sessions,
        windowTitle: ''
      };
    } else {
      // Avoid double counting: ensure we only increase if baseline larger
      if (entry.totalMs > usage[id].totalMs) {
        usage[id].totalMs = entry.totalMs;
        // Optionally merge sessions (simple replacement to avoid duplicates)
        usage[id].sessions = mergeSessions(usage[id].sessions, entry.sessions);
      }
    }
  }
}

function mergeSessions(existing, incoming) {
  // Simple merge dedup by start+end
  const key = s => `${s.start}-${s.end}`;
  const map = new Map();
  for (const s of existing) map.set(key(s), s);
  for (const s of incoming) if (!map.has(key(s))) map.set(key(s), s);
  return Array.from(map.values()).sort((a,b)=>a.start-b.start);
}

function pauseAllActiveSessions() {
  const now = Date.now();
  for (const key of Object.keys(usage)) {
    const u = usage[key];
    if (u.lastStart) {
      const delta = now - u.lastStart;
      u.totalMs += delta;
      u.sessions.push({ 
        start: u.lastStart, 
        end: now, 
        duration: delta, 
        title: u.windowTitle || u.name,
        endReason: 'idle'
      });
      u.lastStart = null;
    }
  }
}

function getAppPath(bundleId) {
  return new Promise((resolve, reject) => {
    exec(`mdfind "kMDItemCFBundleIdentifier == '${bundleId}'"`, (error, stdout) => {
      if (error) {
        reject(error);
      } else {
        const paths = stdout.trim().split('\n').filter(p => p.endsWith('.app'));
        resolve(paths[0] || '');
      }
    });
  });
}

function serializeUsage() {
  const now = Date.now();
  return Object.entries(usage).map(([id, u]) => {
    let runningMs = u.totalMs;
    if (u.lastStart && !isIdle) runningMs += (now - u.lastStart);
    
    return {
      id,
      name: u.name,
      bundleId: u.bundleId,
      iconDataURL: u.iconDataURL,
      appPath: u.appPath,
      totalMs: runningMs,
      sessions: u.sessions,
      currentWindow: u.windowTitle,
      isActive: !!u.lastStart && !isIdle,
      lastActive: u.lastStart ? now : (u.sessions.length > 0 ? u.sessions[u.sessions.length - 1].end : 0)
    };
  }).sort((a,b) => b.totalMs - a.totalMs);
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

ipcMain.handle('usage:getSystemInfo', () => {
  return {
    isIdle,
    idleTime: powerMonitor.getSystemIdleTime(),
    uptime: process.uptime(),
    platform: process.platform,
    trackingStarted: app.getAppMetrics()[0]?.creationTime || Date.now()
  };
});

ipcMain.handle('usage:clearData', () => {
  usage = {};
  if (mainWindow) {
    mainWindow.webContents.send('usage:update', []);
  }
  return true;
});

ipcMain.handle('theme:toggle', () => {
  const newTheme = nativeTheme.shouldUseDarkColors ? 'light' : 'dark';
  nativeTheme.themeSource = newTheme;
  if (mainWindow) {
    mainWindow.webContents.executeJavaScript(`
      document.documentElement.setAttribute('data-theme', '${newTheme}');
    `);
  }
  return newTheme;
});

ipcMain.handle('theme:get', () => {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
});

// Tray / background operation so tracking continues when window closed
let tray;

app.whenReady().then(async () => {
  // Check for accessibility permissions on macOS
  if (process.platform === 'darwin') {
    const accessibilityTrusted = systemPreferences.isTrustedAccessibilityClient(false);
    if (!accessibilityTrusted) {
      console.log('Accessibility permission required for accurate tracking');
      // Prompt for permission
      systemPreferences.isTrustedAccessibilityClient(true);
    }
    
    // Request Full Disk Access for Screen Time data
    console.log('For enhanced tracking, grant Full Disk Access to this app in System Settings > Privacy & Security');
  }
  
  createWindow();
  
  // Start with more frequent polling for better accuracy
  pollingInterval = setInterval(pollActiveApp, 1000); // 1 second for better accuracy
  
  // Set up power monitor events
  powerMonitor.on('suspend', () => {
    console.log('System suspended - pausing tracking');
    pauseAllActiveSessions();
    isIdle = true;
  });
  
  powerMonitor.on('resume', () => {
    console.log('System resumed - resuming tracking');
    isIdle = false;
    lastActiveTime = Date.now();
  });
  
  // Theme change listener
  nativeTheme.on('updated', () => {
    if (mainWindow) {
      const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
      mainWindow.webContents.executeJavaScript(`
        document.documentElement.setAttribute('data-theme', '${theme}');
      `);
    }
  });
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Create tray icon (macOS keeps app alive without visible window)
  try {
    const iconPath = path.join(__dirname, 'trayTemplate.png');
    if (fs.existsSync(iconPath)) {
      const { Tray, Menu } = require('electron');
      tray = new Tray(iconPath);
      const contextMenu = Menu.buildFromTemplate([
        { label: 'Show Screen Time', click: () => { if (!mainWindow) createWindow(); else mainWindow.show(); } },
        { label: 'Fetch Screen Time Now', click: async () => { await getScreenTimeData(true).then(d=>mergeScreenTimeBaseline(d)); if (mainWindow) mainWindow.webContents.send('usage:update', serializeUsage()); } },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() }
      ]);
      tray.setToolTip('Screen Time Tracker');
      tray.setContextMenu(contextMenu);
      tray.on('click', () => { if (mainWindow) { mainWindow.show(); } else createWindow(); });
    }
  } catch {}
});

app.on('window-all-closed', () => {
  // On macOS keep running (background). On other platforms quit.
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  // finalize any running sessions so exported data has accurate totals
  const now = Date.now();
  for (const key of Object.keys(usage)) {
    const u = usage[key];
    if (u.lastStart) {
      const delta = now - u.lastStart;
      u.totalMs += delta;
      u.sessions.push({ start: u.lastStart, end: now, duration: delta, title: u.name });
      u.lastStart = null;
    }
  }
  clearInterval(pollingInterval);
});
