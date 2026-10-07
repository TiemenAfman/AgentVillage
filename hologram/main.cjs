// The island as a hologram on the desktop: a frameless, see-through Electron window that loads
// the distillate's page with `?hologram` (web/js/hologram.js), so only the island floats there.
//
//   npm run hologram
//
// Left button turns it, the wheel zooms, the right button drags the window across the desktop.
// Where the window shows nothing, the mouse goes through to whatever is behind it: the page reads
// the pixel under the pointer every frame and says island or nothing (`holo:ignore`), and the
// window then ignores the mouse - with `forward`, so it still hears the pointer move and can say
// "island" again the moment it is back over the coast.
//
// The islander is started if nothing answers on PORT (node start.mjs, the distillate's own home),
// and stopped again on quit only if this window started it. The tray icon is the way out: there
// is no frame to close.
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 4848);
const URL = `http://localhost:${PORT}/?hologram`;   // + &wander=0 when the director is off
const SIZES = { Klein: 480, Middel: 720, Groot: 1000 };

let win = null;
let tray = null;
let islander = null;
const prefsFile = () => path.join(app.getPath('userData'), 'hologram.json');
let prefs = { size: 720, x: null, y: null, onTop: true, wander: true };
try { prefs = { ...prefs, ...JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) }; } catch { /* first run */ }
let saveTimer = null;
function savePrefs() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { fs.writeFileSync(prefsFile(), JSON.stringify(prefs, null, 2)); } catch { /* nothing to lose */ } }, 400);
}

function answers() {
  return new Promise((done) => {
    const req = http.get(`http://localhost:${PORT}/api/hello`, (res) => { res.resume(); done(res.statusCode === 200); });
    req.on('error', () => done(false));
    req.setTimeout(1500, () => { req.destroy(); done(false); });
  });
}

async function ensureIslander() {
  if (await answers()) return true;
  islander = spawn(process.platform === 'win32' ? 'node.exe' : 'node', ['start.mjs', '--port', String(PORT), '--no-open'], {
    cwd: ROOT, windowsHide: true, stdio: 'ignore',
  });
  islander.on('exit', () => { islander = null; });
  // The first scan of a cold island takes its time; a minute is generous.
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await answers()) return true;
  }
  return false;
}

function onScreen(x, y, size) {
  return screen.getAllDisplays().some(({ workArea: a }) => x + size / 2 > a.x && x + size / 2 < a.x + a.width && y + size / 2 > a.y && y + size / 2 < a.y + a.height);
}

function createWindow() {
  const size = prefs.size;
  const placed = prefs.x != null && onScreen(prefs.x, prefs.y, size);
  win = new BrowserWindow({
    width: size, height: size,
    ...(placed ? { x: prefs.x, y: prefs.y } : {}),
    transparent: true, frame: false, hasShadow: false, resizable: false,
    backgroundColor: '#00000000', skipTaskbar: true, alwaysOnTop: prefs.onTop,
    title: 'Promptholm hologram',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, backgroundThrottling: false },
  });
  win.loadURL(prefs.wander ? URL : `${URL}&wander=0`);
  win.on('moved', () => { if (full) return; const [x, y] = win.getPosition(); prefs.x = x; prefs.y = y; savePrefs(); });
  win.on('closed', () => { win = null; });
}

// Dragging the window with the right button: where the window and the cursor were when it began,
// then the window follows the cursor - read here, from the screen, so a drag that outruns the page
// (the cursor leaving the window between two pointer events) still lands where the cursor is.
let drag = null;
ipcMain.on('holo:drag-start', () => {
  if (!win) return;
  const [x, y] = win.getPosition();
  drag = { x, y, cursor: screen.getCursorScreenPoint() };
});
ipcMain.on('holo:drag-move', () => {
  if (!win || !drag) return;
  const c = screen.getCursorScreenPoint();
  win.setPosition(drag.x + c.x - drag.cursor.x, drag.y + c.y - drag.cursor.y);
});
ipcMain.on('holo:drag-end', () => { drag = null; });
ipcMain.on('holo:ignore', (_e, ignore) => {
  if (win && !drag) win.setIgnoreMouseEvents(!!ignore, { forward: true });
});

// The whole screen the window is on, and back to the square it was. Its own bounds rather than
// setFullScreen: a see-through window made full screen on Windows is drawn opaque by some drivers,
// and this is the same picture without asking the window manager for anything.
let full = null;   // the bounds to go back to, while full
function toggleFull() {
  if (!win) return;
  if (full) {
    win.setBounds(full);
    full = null;
  } else {
    full = win.getBounds();
    win.setBounds(screen.getDisplayMatching(full).bounds);
  }
  buildMenu();
}
ipcMain.on('holo:full', () => toggleFull());

function setSize(size) {
  if (!win) return;
  if (full) { win.setBounds(full); full = null; }
  const [x, y] = win.getPosition();
  const [w] = win.getSize();
  // Grown or shrunk about its middle, so the island stays where it was on the desktop.
  const d = Math.round((size - w) / 2);
  win.setBounds({ x: x - d, y: y - d, width: size, height: size });
  prefs.size = size; prefs.x = x - d; prefs.y = y - d; savePrefs();
  buildMenu();
}

function buildMenu() {
  const menu = Menu.buildFromTemplate([
    { label: 'Promptholm hologram', enabled: false },
    { type: 'separator' },
    ...Object.entries(SIZES).map(([label, size]) => ({ label, type: 'radio', checked: prefs.size === size, click: () => setSize(size) })),
    { label: 'Volledig scherm (F11)', type: 'checkbox', checked: !!full, click: () => toggleFull() },
    { type: 'separator' },
    { label: 'Regisseur (camera dwaalt zelf rond)', type: 'checkbox', checked: prefs.wander, click: (item) => { prefs.wander = item.checked; if (win) win.webContents.send('holo:wander', item.checked); savePrefs(); } },
    { label: 'Altijd bovenop', type: 'checkbox', checked: prefs.onTop, click: (item) => { prefs.onTop = item.checked; if (win) win.setAlwaysOnTop(item.checked); savePrefs(); } },
    { label: 'Naar het midden van het scherm', click: () => { if (win) { win.center(); const [x, y] = win.getPosition(); prefs.x = x; prefs.y = y; savePrefs(); } } },
    { label: 'Opnieuw laden', click: () => { if (win) win.reload(); } },
    { type: 'separator' },
    { label: 'Sluiten', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

app.whenReady().then(async () => {
  const icon = nativeImage.createFromPath(path.join(ROOT, 'web', 'icons', 'island-192.png')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Promptholm hologram');
  buildMenu();
  if (!(await ensureIslander())) {
    console.error(`[hologram] nothing answers on http://localhost:${PORT}/ and the island would not start`);
    app.quit();
    return;
  }
  createWindow();
});

app.on('window-all-closed', () => { /* the tray keeps it alive; Sluiten quits */ });
app.on('before-quit', () => { if (islander) { try { islander.kill(); } catch { /* gone already */ } } });
