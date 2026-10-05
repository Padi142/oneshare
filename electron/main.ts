import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeTheme,
  shell,
} from "electron";
import type {
  MenuItemConstructorOptions,
  Rectangle,
  WebContents,
} from "electron";
import {
  createWriteStream,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { mkdir, readFile, rename, stat, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { basename, extname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  DesktopDownloadFile,
  DesktopDownloadResult,
  DesktopFile,
  DesktopMenuAction,
} from "./types";

const APP_VERSION_CHANNEL = "app:get-version";
const OPEN_EXTERNAL_CHANNEL = "shell:open-external";
const READ_FILE_FROM_PATH_CHANNEL = "file:read-from-path";
const DOWNLOADED_FILES_CHANNEL = "file:downloaded-files";
const DOWNLOAD_FILE_CHANNEL = "file:download";
const DOWNLOAD_PROGRESS_CHANNEL = "file:download-progress";
const OPEN_DOWNLOADED_FILE_CHANNEL = "file:open-downloaded";
const SHOW_DOWNLOADED_FILE_CHANNEL = "file:show-downloaded";
/** Matched by the renderer to re-download files the user deleted. */
const NOT_DOWNLOADED_ERROR = "NOT_DOWNLOADED";
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

const DOWNLOAD_KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const DOWNLOAD_PROGRESS_INTERVAL_MS = 150;

function isDownloadKey(value: unknown): value is string {
  return typeof value === "string" && DOWNLOAD_KEY_PATTERN.test(value);
}

function isDownloadFile(value: unknown): value is DesktopDownloadFile {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isDownloadKey(candidate.key) &&
    typeof candidate.fileName === "string" &&
    candidate.fileName.trim().length > 0 &&
    candidate.fileName.length <= 255 &&
    typeof candidate.url === "string" &&
    isDownloadUrl(candidate.url)
  );
}

function isDownloadUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function safeDownloadFileName(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "-")
    .trim();
  const fileName = basename(normalized);
  if (!fileName || fileName === "." || fileName === "..") {
    return "download";
  }
  return fileName;
}

function nextAvailableDownloadPath(downloadsPath: string, fileName: string) {
  const extension = extname(fileName);
  const stem = extension ? fileName.slice(0, -extension.length) : fileName;
  let attempt = 0;

  while (true) {
    const suffix = attempt === 0 ? "" : ` (${attempt})`;
    const candidate = join(downloadsPath, `${stem}${suffix}${extension}`);
    if (!existsSync(candidate)) return candidate;
    attempt += 1;
  }
}

/** Downloads land in ~/Downloads/OneShare, like Telegram's Downloads/Telegram. */
function downloadsFolder(): string {
  return join(app.getPath("downloads"), APP_NAME);
}

function downloadIndexPath(): string {
  return join(app.getPath("userData"), "downloads.json");
}

/** Maps attachment keys to the absolute path each one was saved to. */
function readDownloadIndex(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(downloadIndexPath(), "utf8"),
    );
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          isDownloadKey(entry[0]) &&
          typeof entry[1] === "string" &&
          isAbsolute(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

function writeDownloadIndex(index: Record<string, string>): void {
  writeFileSync(downloadIndexPath(), JSON.stringify(index), "utf8");
}

/** The saved path for a key, or undefined once the user moved or deleted it. */
function downloadedPath(key: unknown): string | undefined {
  if (!isDownloadKey(key)) return undefined;
  const path = readDownloadIndex()[key];
  return path && existsSync(path) ? path : undefined;
}

function downloadedKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const index = readDownloadIndex();
  return value.filter(
    (key): key is string =>
      isDownloadKey(key) && index[key] !== undefined && existsSync(index[key]),
  );
}

function sendDownloadProgress(
  sender: WebContents,
  key: string,
  received: number,
  total: number,
): void {
  if (!sender.isDestroyed()) {
    sender.send(DOWNLOAD_PROGRESS_CHANNEL, { key, received, total });
  }
}

async function downloadFile(
  sender: WebContents,
  value: unknown,
): Promise<DesktopDownloadResult> {
  if (!isDownloadFile(value)) {
    throw new Error("That file could not be downloaded.");
  }

  const existing = downloadedPath(value.key);
  if (existing) return { fileName: basename(existing) };

  const response = await fetch(value.url);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}).`);
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
    throw new Error("The file is larger than 500 MB.");
  }
  const total = Number.isFinite(contentLength) ? contentLength : -1;

  if (!response.body) {
    throw new Error("The download had no file contents.");
  }

  const folder = downloadsFolder();
  await mkdir(folder, { recursive: true });
  const temporaryPath = join(folder, `.oneshare-${randomUUID()}.tmp`);

  let received = 0;
  let lastProgressAt = 0;
  const countProgress = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > MAX_UPLOAD_BYTES) {
        callback(new Error("The file is larger than 500 MB."));
        return;
      }
      const now = Date.now();
      if (now - lastProgressAt >= DOWNLOAD_PROGRESS_INTERVAL_MS) {
        lastProgressAt = now;
        sendDownloadProgress(sender, value.key, received, total);
      }
      callback(null, chunk);
    },
  });

  try {
    const nodeResponseBody = response.body as unknown as Parameters<
      typeof Readable.fromWeb
    >[0];
    await pipeline(
      Readable.fromWeb(nodeResponseBody),
      countProgress,
      createWriteStream(temporaryPath, { flags: "wx" }),
    );
    sendDownloadProgress(sender, value.key, received, total);

    const destination = nextAvailableDownloadPath(
      folder,
      safeDownloadFileName(value.fileName),
    );
    await rename(temporaryPath, destination);
    writeDownloadIndex({ ...readDownloadIndex(), [value.key]: destination });
    return { fileName: basename(destination) };
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function openDownloadedFile(key: unknown): Promise<void> {
  const path = downloadedPath(key);
  if (!path) throw new Error(NOT_DOWNLOADED_ERROR);
  const failure = await shell.openPath(path);
  if (failure) throw new Error(failure);
}

function showDownloadedFile(key: unknown): void {
  const path = downloadedPath(key);
  if (!path) throw new Error(NOT_DOWNLOADED_ERROR);
  shell.showItemInFolder(path);
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
  ipcMain.handle(DOWNLOADED_FILES_CHANNEL, (_event, value: unknown) =>
    downloadedKeys(value),
  );
  ipcMain.handle(DOWNLOAD_FILE_CHANNEL, (event, value: unknown) =>
    downloadFile(event.sender, value),
  );
  ipcMain.handle(OPEN_DOWNLOADED_FILE_CHANNEL, (_event, value: unknown) =>
    openDownloadedFile(value),
  );
  ipcMain.handle(SHOW_DOWNLOADED_FILE_CHANNEL, (_event, value: unknown) =>
    showDownloadedFile(value),
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
    ...(process.platform === "linux"
      ? { icon: join(app.getAppPath(), "dist", "icon.png") }
      : {}),
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#111214" : "#ffffff",
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
