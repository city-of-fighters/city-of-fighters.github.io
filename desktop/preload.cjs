// Gives the site one extra: the OBS WebSocket address and password from this computer's OBS settings.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('cofDesktop', { obsLogin: () => ipcRenderer.invoke('obs-login') });
