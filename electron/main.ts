import { app, BrowserWindow, ipcMain, Menu, shell } from "electron";
import type { MenuItemConstructorOptions, Rectangle } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { DesktopFile, DesktopMenuAction } from "./types";

const APP_VERSION_CHANNEL = "app:get-version";
const OPEN_EXTERNAL_CHANNEL = "shell:open-external";
const READ_FILE_FROM_PATH_CHANNEL = "file:read-from-path";
const MENU_ACTION_CHANNEL = "menu:action";

const APP_NAME = "OneShare";
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL?.trim();
const MIN_WINDOW_WIDTH = 720;
const MIN_WINDOW_HEIGHT = 520;
const DEFAULT_WINDOW_BOUNDS: Rectangle = {
  width: 1120,
  height: 760,
  x: 0,
  y: 0,
};

type PersistedWindowState = {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized?: boolean;
};

let mainWindow: BrowserWindow | null = null;

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".m4v": "video/x-m4v",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
  ".webp": "image/webp",
};

function stateFilePath(): string {
  return join(app.getPath("userData"), "window-state.json");
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readWindowState(): PersistedWindowState {
  const fallback: PersistedWindowState = {
    width: DEFAULT_WINDOW_BOUNDS.width,
    height: DEFAULT_WINDOW_BOUNDS.height,
  };

  try {
    const statePath = stateFilePath();
    if (!existsSync(statePath)) {
      return fallback;
    }

    const parsed: unknown = JSON.parse(readFileSync(statePath, "utf8"));
    if (typeof parsed !== "object" || parsed === null) {
      return fallback;
    }

    const state = parsed as Record<string, unknown>;
    return {
      width:
        isFiniteNumber(state.width) && state.width >= MIN_WINDOW_WIDTH
          ? state.width
          : fallback.width,
      height:
        isFiniteNumber(state.height) && state.height >= MIN_WINDOW_HEIGHT
          ? state.height
          : fallback.height,
      ...(isFiniteNumber(state.x) ? { x: state.x } : {}),
      ...(isFiniteNumber(state.y) ? { y: state.y } : {}),
      ...(typeof state.maximized === "boolean"
        ? { maximized: state.maximized }
        : {}),
    };
  } catch {
    return fallback;
  }
}

function writeWindowState(window: BrowserWindow): void {
  if (window.isDestroyed()) {
    return;
  }

  const bounds = window.isMaximized()
    ? window.getNormalBounds()
    : window.getBounds();
  const state: PersistedWindowState = {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    maximized: window.isMaximized(),
  };

  try {
    writeFileSync(stateFilePath(), JSON.stringify(state), "utf8");
  } catch {
    // Window state is a convenience. A read-only or unavailable userData path
    // should never prevent the app from opening or closing cleanly.
  }
}

function isSafeExternalUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

async function openExternalUrl(value: unknown): Promise<boolean> {
  if (!isSafeExternalUrl(value)) {
    return false;
  }

  await shell.openExternal(value);
  return true;
}

function pathFromPaste(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Paste an absolute path to a file.");
  }

  const trimmed = value.trim();
  const unquoted =
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
      ? trimmed.slice(1, -1)
      : trimmed;

  if (!unquoted || unquoted.includes("\n")) {
    throw new Error("Paste one absolute path to a file.");
  }

  let filePath = unquoted;
  if (filePath.startsWith("file://")) {
    try {
      filePath = fileURLToPath(filePath);
    } catch {
      throw new Error("That file URL isn't valid.");
    }
  }

  if (!isAbsolute(filePath)) {
    throw new Error("Paste an absolute path to a file.");
  }

  return filePath;
}

function mimeTypeForPath(filePath: string): string {
  return (
    MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream"
  );
}

async function readFileFromPath(value: unknown): Promise<DesktopFile> {
  const filePath = pathFromPaste(value);

  let fileStats: Awaited<ReturnType<typeof stat>>;
  try {
    fileStats = await stat(filePath);
  } catch {
    throw new Error("Couldn't find a file at that path.");
  }

  if (!fileStats.isFile()) {
    throw new Error("Paste the path to a file, not a folder.");
  }
  if (fileStats.size > MAX_UPLOAD_BYTES) {
    throw new Error("That file is larger than 500 MB.");
  }

  try {
    const contents = await readFile(filePath);
    const copy = new Uint8Array(contents.byteLength);
    copy.set(contents);
    return {
      name: basename(filePath),
      mimeType: mimeTypeForPath(filePath),
      lastModified: Math.round(fileStats.mtimeMs),
      contents: copy.buffer,
    };
  } catch {
    throw new Error("Couldn't read that file.");
  }
}

function isRendererUrl(url: string): boolean {
  if (DEV_SERVER_URL) {
    try {
      return new URL(url).origin === new URL(DEV_SERVER_URL).origin;
    } catch {
      return false;
    }
  }

  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "file:" &&
      fileURLToPath(parsed) === join(app.getAppPath(), "dist", "index.html")
    );
  } catch {
    return false;
  }
}

function sendMenuAction(action: DesktopMenuAction): void {
  if (mainWindow?.isDestroyed() === false) {
    mainWindow.webContents.send(MENU_ACTION_CHANNEL, action);
  }
}

function buildApplicationMenu(): void {
  const viewSubmenu: MenuItemConstructorOptions[] = [
    { role: "reload" },
    { role: "forceReload", visible: !app.isPackaged },
    { role: "toggleDevTools", visible: !app.isPackaged },
    { type: "separator" },
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
  ];

  const template: MenuItemConstructorOptions[] = [
    {
      label: APP_NAME,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
      visible: process.platform === "darwin",
    },
    {
      label: "File",
      submenu: [
        {
          label: "New message",
          accelerator: "CommandOrControl+N",
          click: () => sendMenuAction("new-message"),
        },
        { type: "separator" },
        { role: "close" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Search messages",
          accelerator: "CommandOrControl+K",
          click: () => sendMenuAction("focus-search"),
        },
        { type: "separator" },
        ...viewSubmenu,
      ],
    },
    {
      role: "windowMenu",
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpcHandlers(): void {
  ipcMain.handle(APP_VERSION_CHANNEL, () => app.getVersion());
  ipcMain.handle(OPEN_EXTERNAL_CHANNEL, (_event, value: unknown) =>
    openExternalUrl(value),
  );
  ipcMain.handle(READ_FILE_FROM_PATH_CHANNEL, (_event, value: unknown) =>
    readFileFromPath(value),
  );
}

function createMainWindow(): BrowserWindow {
  const state = readWindowState();
  const preloadPath = join(app.getAppPath(), "dist-electron", "preload.cjs");
  const window = new BrowserWindow({
    ...state,
    width: state.width,
    height: state.height,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    title: APP_NAME,
    backgroundColor: "#101820",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: true,
      devTools: !app.isPackaged,
    },
  });

  if (state.maximized) {
    window.maximize();
  }

  window.once("ready-to-show", () => window.show());
  window.on("move", () => writeWindowState(window));
  window.on("resize", () => writeWindowState(window));
  window.on("close", () => writeWindowState(window));
  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalUrl(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (isRendererUrl(url)) {
      return;
    }

    event.preventDefault();
    void openExternalUrl(url);
  });

  if (DEV_SERVER_URL) {
    void window.loadURL(DEV_SERVER_URL);
  } else {
    void window.loadFile(join(app.getAppPath(), "dist", "index.html"));
  }

  return window;
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    registerIpcHandlers();
    buildApplicationMenu();
    mainWindow = createMainWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
