import { join } from 'node:path';
import { app, BrowserWindow, dialog, Menu, session, type WebContents } from 'electron';
import { registerIpcRouter } from './ipc/router';
import { bootstrapWorkspace } from './app-bootstrap';

/**
 * Electron main process entry. Implements the hardened window + IPC boundary (M0/M1):
 *  - contextIsolation on, sandbox on, nodeIntegration off,
 *  - strict-ish CSP, deny external navigation / window.open,
 *  - single-instance lock,
 *  - IPC router with a sender-frame check.
 * See SWAFT_ARCHITECTURE.md §2, §5 and SWAFT_SECURITY_MODEL.md §3.
 */

let mainWindow: BrowserWindow | null = null;

// Test hook: the e2e suite points userData at a temp dir so a test run never touches (or depends
// on) the real profile — accounts, secrets and the app store all live under userData.
if (process.env.SWAFT_USER_DATA_DIR) {
  app.setPath('userData', process.env.SWAFT_USER_DATA_DIR);
}

const isDev = !!process.env.ELECTRON_RENDERER_URL;

// Production CSP is strict (Vite emits external scripts). In dev, the Vite React plugin injects an
// inline HMR preamble and uses eval-based tooling, so 'unsafe-inline'/'unsafe-eval' are required —
// only in dev. Without this the renderer shows a black screen (preamble blocked → React never mounts).
const CSP = isDev
  ? "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; " +
    "font-src 'self' data:; " +
    "connect-src 'self' ws: http://localhost:* http://127.0.0.1:*"
  : "default-src 'self'; " +
    "script-src 'self'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; " +
    "font-src 'self' data:; " +
    "connect-src 'self'";

function isTrustedSender(sender: WebContents): boolean {
  return mainWindow !== null && sender === mainWindow.webContents;
}

function createWindow(): void {
  // No native application menu (File/Edit/View/Window/Help) — Swaft drives everything from its UI.
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0f17',
    title: 'Swaft',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // Deny opening new windows and external navigation (IPC-8 / Electron hardening).
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = process.env.ELECTRON_RENDERER_URL ?? '';
    if (!allowed || !url.startsWith(allowed)) event.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// Single-instance lock.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  const bootstrap = app.whenReady().then(() => {
    // Apply a Content-Security-Policy to all responses.
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [CSP],
        },
      });
    });

    // App-level store + workspace service (worker-backed `.swaft`) + native dialogs.
    bootstrapWorkspace(() => mainWindow);
    registerIpcRouter(isTrustedSender);
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  // A failed bootstrap would otherwise be a silent unhandled rejection and a zombie process.
  bootstrap.catch((err: unknown) => {
    console.error('[swaft] fatal: bootstrap failed:', err);
    dialog.showErrorBox('Swaft failed to start', err instanceof Error ? err.stack ?? err.message : String(err));
    app.quit();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
