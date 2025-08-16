const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('screenTimeAPI', {
  getUsage: () => ipcRenderer.invoke('usage:get'),
  exportData: () => ipcRenderer.invoke('usage:export'),
  getSystemInfo: () => ipcRenderer.invoke('usage:getSystemInfo'),
  clearData: () => ipcRenderer.invoke('usage:clearData'),
  onUsageUpdate: (cb) => {
    ipcRenderer.removeAllListeners('usage:update');
    ipcRenderer.on('usage:update', (_, data) => cb(data));
  }
});
