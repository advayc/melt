const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('screenTimeAPI', {
  getUsage: () => ipcRenderer.invoke('usage:get'),
  exportData: () => ipcRenderer.invoke('usage:export'),
  onUsageUpdate: (cb) => {
    ipcRenderer.removeAllListeners('usage:update');
    ipcRenderer.on('usage:update', (_, data) => cb(data));
  }
});
