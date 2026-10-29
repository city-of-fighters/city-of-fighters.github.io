// City of Fighters desktop app: the website's control panel, Stream tab and phone remote in their own window.
// It loads the live site, so the app is always as up to date as the website.
const { app, BrowserWindow, Menu, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const SITE = 'https://gaberpet.github.io/city-of-fighters/';
const SMOKE = !!process.env.COF_SMOKE; // `COF_SMOKE=1 electron .` checks a build without a display, then exits

const OFFLINE = `data:text/html;charset=utf-8,${encodeURIComponent(`<body style="margin:0;height:100vh;display:grid;place-items:center;
  background:#0c0714;color:#f4eefc;font:18px system-ui;text-align:center"><div><h1 style="color:#ff2d78">No connection</h1>
  <p>City of Fighters needs the internet. Trying again every 5 seconds…</p></div></body>`)}`;

function createWindow() {
  const win = new BrowserWindow({
    show: !SMOKE,
    width: 1440,
    height: 940,
    minWidth: 380,
    minHeight: 600,
    title: 'City of Fighters',
    backgroundColor: '#0c0714',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  // Pages of the site stay in the app (new windows open as app windows); anything else opens in the browser.
  const ours = url => url.startsWith(SITE);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (ours(url)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: '#0c0714' } };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!ours(url) && !url.startsWith('data:')) { e.preventDefault(); shell.openExternal(url); } });

  // No internet: show a message and keep retrying.
  let retry;
  win.webContents.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = navigation replaced by another one
    win.loadURL(OFFLINE);
    clearTimeout(retry);
    retry = setTimeout(() => win.loadURL(SITE + 'admin.html'), 5000);
  });

  if (SMOKE) runSmokeTest(win);
  win.loadURL(SITE + 'admin.html');
}

function runSmokeTest(win) {
  const done = (result, ok) => {
    console.log('SMOKE_RESULT ' + JSON.stringify(result));
    if (process.env.COF_SMOKE_OUT) fs.writeFileSync(process.env.COF_SMOKE_OUT, JSON.stringify(result));
    app.exit(ok ? 0 : 1);
  };
  setTimeout(() => done({ error: 'timeout' }, false), 60000);
  win.webContents.once('did-finish-load', async () => {
    try {
      const title = await win.webContents.executeJavaScript('document.title');
      const login = await win.webContents.executeJavaScript('!!document.getElementById("login")');
      done({ url: win.webContents.getURL(), title, login }, title.includes('City of Fighters') && login);
    } catch (e) { done({ error: String(e) }, false); }
  });
}

Menu.setApplicationMenu(Menu.buildFromTemplate([
  { label: 'App', submenu: [
    { label: 'Control panel', accelerator: 'CmdOrCtrl+1', click: (_, w) => w?.loadURL(SITE + 'admin.html') },
    { label: 'Stream', accelerator: 'CmdOrCtrl+2', click: (_, w) => w?.loadURL(SITE + 'studio.html') },
    { label: 'Phone remote', accelerator: 'CmdOrCtrl+3', click: (_, w) => w?.loadURL(SITE + 'phone.html') },
    { type: 'separator' }, { role: 'quit' },
  ] },
  { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }] },
]));

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
