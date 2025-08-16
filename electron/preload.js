const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('screenTimeAPI', {
  getUsage: () => ipcRenderer.invoke('usage:get'),
  exportData: () => ipcRenderer.invoke('usage:export'),
  getSystemInfo: () => ipcRenderer.invoke('usage:getSystemInfo'),
  clearData: () => ipcRenderer.invoke('usage:clearData'),
  toggleTheme: () => ipcRenderer.invoke('theme:toggle'),
  getTheme: () => ipcRenderer.invoke('theme:get'),
  onUsageUpdate: (cb) => {
    ipcRenderer.removeAllListeners('usage:update');
    ipcRenderer.on('usage:update', (_, data) => cb(data));
  }
});
