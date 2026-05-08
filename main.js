const { app, BrowserWindow, ipcMain, shell, nativeTheme } = require('electron');
const Session = require('./session');

process.on('uncaughtException', (e) => console.error('[uncaught]', e));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

let win;
const session = new Session();

function createWindow() {
    win = new BrowserWindow({
        width: 480,
        height: 640,
        resizable: false,
        titleBarStyle: 'hiddenInset',
        transparent: true,
        backgroundColor: '#00000000',
        vibrancy: 'under-window',
        visualEffectState: 'active',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    win.loadFile('index.html');

    win.on('focus', () => session.sendPresence('active'));
    win.on('blur',  () => session.sendPresence('away'));
}

app.whenReady().then(async () => {
    nativeTheme.themeSource = 'dark';
    await session.connect();
    createWindow();
});

app.on('window-all-closed', async () => {
    await session.close();
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Начать сессию — генерируем ключи, кладём в Redis
ipcMain.handle('start-session', async () => {
    const fingerprint = session.generateKeys();
    await session.startSession();

    wireSessionEvents();
    return fingerprint;
});

// Присоединиться по fingerprint
ipcMain.handle('join-session', async (_, fingerprint) => {
    session.generateKeys();
    wireSessionEvents();
    await session.joinSession(fingerprint.trim().toUpperCase());
    return session.fingerprint;
});

function wireSessionEvents() {
    session.onPeerConnected    = (peerFp) => win.webContents.send('peer-connected', peerFp);
    session.onPeerDisconnected = ()       => win.webContents.send('peer-disconnected');
    session.onPeerPresence     = (state)  => win.webContents.send('peer-presence', state);
    session.onMessage          = (text)   => win.webContents.send('message', text);
}

// Отправить сообщение
ipcMain.handle('send-message', async (_, text) => {
    await session.sendMessage(text);
});

// Открыть изображение во внешнем просмотрщике
ipcMain.handle('open-image', async (_, dataUrl) => {
    const { writeFileSync } = require('fs');
    const { tmpdir } = require('os');
    const path = require('path');
    const tmp = path.join(tmpdir(), `phantom-${Date.now()}.jpg`);
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    writeFileSync(tmp, Buffer.from(base64, 'base64'));
    shell.openPath(tmp);
});
