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

// Enhanced macOS Screen Time Integration
async function getScreenTimeData() {
  return new Promise((resolve, reject) => {
    // Try to get data from Screen Time database (requires permissions)
    exec(`
      sqlite3 ~/Library/Application\\ Support/Knowledge/knowledgeC.db "
      SELECT 
        ZOBJECT.ZVALUEDOUBLE as usage_time,
        ZOBJECT.ZCREATIONDATE as timestamp,
        ZOBJECT.ZSTREAMNAME as app_name
      FROM ZOBJECT 
      WHERE ZSTREAMNAME LIKE '%usage%' 
      AND ZCREATIONDATE > (SELECT julianday('now') - 1)
      ORDER BY ZCREATIONDATE DESC 
      LIMIT 100;"
    `, (error, stdout, stderr) => {
      if (error) {
        console.log('Screen Time database access failed, using fallback polling');
        resolve([]);
      } else {
        const lines = stdout.trim().split('\n').filter(line => line);
        const data = lines.map(line => {
          const [usage_time, timestamp, app_name] = line.split('|');
          return { usage_time: parseFloat(usage_time), timestamp, app_name };
        });
        resolve(data);
      }
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
    
    // Try to get enhanced screen time data first
    try {
      const screenTimeData = await getScreenTimeData();
      if (screenTimeData.length > 0) {
        await processScreenTimeData(screenTimeData);
      }
    } catch (e) {
      console.log('Using fallback active window polling');
    }
    
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

async function processScreenTimeData(screenTimeData) {
  // Process raw Screen Time data and merge with our tracking
  for (const entry of screenTimeData) {
    if (entry.app_name && entry.usage_time > 0) {
      const id = entry.app_name;
      if (!usage[id]) {
        usage[id] = {
          name: entry.app_name,
          bundleId: id,
          iconDataURL: null,
          appPath: '',
          totalMs: entry.usage_time * 1000, // Convert to ms
          lastStart: null,
          sessions: [],
          windowTitle: ''
        };
      } else {
        // Merge with existing data
        usage[id].totalMs = Math.max(usage[id].totalMs, entry.usage_time * 1000);
      }
    }
  }
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
});

app.on('window-all-closed', () => {
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
