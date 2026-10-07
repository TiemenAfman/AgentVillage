// What the hologram's page may ask of its window (hologram/main.cjs), and nothing else: whether
// the mouse should go through it, and a drag of the window with the right button.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('holo', {
  setIgnore: (ignore) => ipcRenderer.send('holo:ignore', !!ignore),
  dragStart: () => ipcRenderer.send('holo:drag-start'),
  dragMove: () => ipcRenderer.send('holo:drag-move'),
  dragEnd: () => ipcRenderer.send('holo:drag-end'),
  toggleFull: () => ipcRenderer.send('holo:full'),
  onWander: (fn) => ipcRenderer.on('holo:wander', (_e, on) => fn(on)),
});
