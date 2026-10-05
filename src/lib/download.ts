import {
  Capacitor,
  registerPlugin,
  type Plugin,
  type PluginListenerHandle,
} from "@capacitor/core";
import type { MessageAttachment } from "../types";

/**
 * Telegram-style local files. On desktop an attachment is saved once into
 * ~/Downloads/OneShare, on Android/iOS into OneShare's own storage, and from
 * then on it opens straight in the system app for its type. The plain web app
 * can't keep files, so it falls back to browser downloads and new tabs.
 */

export interface DownloadFile {
  /** Stable attachment id; the same key always maps to the same saved file. */
  key: string;
  fileName: string;
  mimeType?: string;
  url: string;
}

export type LocalFileState =
  | { status: "unknown" }
  | { status: "remote" }
  /** `progress` runs 0–1, and is undefined while the size isn't known. */
  | { status: "downloading"; progress?: number }
  | { status: "local" };

export interface DownloadFailure {
  fileName: string;
  reason: string;
}

export interface DownloadSummary {
  saved: number;
  failed: DownloadFailure[];
}

interface DownloadProgress {
  key: string;
  received: number;
  total: number;
}

interface FileBackend {
  /** Files stay on the device and can be opened again without a download. */
  persistent: boolean;
  downloaded(keys: string[]): Promise<string[]>;
  download(file: DownloadFile): Promise<void>;
  open(file: DownloadFile): Promise<void>;
  reveal?(file: DownloadFile): Promise<void>;
  onProgress?(listener: (progress: DownloadProgress) => void): void;
}

interface OneShareFilesPlugin extends Plugin {
  status(options: { keys: string[] }): Promise<{ downloaded: string[] }>;
  download(options: {
    key: string;
    url: string;
    fileName: string;
  }): Promise<{ fileName: string }>;
  open(options: { key: string; mimeType?: string }): Promise<void>;
  addListener(
    eventName: "downloadProgress",
    listener: (progress: DownloadProgress) => void,
  ): Promise<PluginListenerHandle>;
}

const NOT_DOWNLOADED = "NOT_DOWNLOADED";
const KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function nativeBackend(): FileBackend {
  const plugin = registerPlugin<OneShareFilesPlugin>("OneShareFiles");
  return {
    persistent: true,
    downloaded: async (keys) => (await plugin.status({ keys })).downloaded,
    download: async ({ key, url, fileName }) => {
      await plugin.download({ key, url, fileName });
    },
    open: ({ key, mimeType }) => plugin.open({ key, mimeType }),
    onProgress: (listener) => {
      void plugin.addListener("downloadProgress", listener);
    },
  };
}

function desktopBackend(
  bridge: NonNullable<Window["desktopBridge"]>,
): FileBackend {
  return {
    persistent: true,
    downloaded: (keys) => bridge.getDownloadedFiles(keys),
    download: async ({ key, url, fileName, mimeType }) => {
      await bridge.downloadFile({ key, url, fileName, mimeType });
    },
    open: ({ key }) => bridge.openDownloadedFile(key),
    reveal: ({ key }) => bridge.showDownloadedFile(key),
    onProgress: (listener) => {
      bridge.onDownloadProgress(listener);
    },
  };
}

const browserBackend: FileBackend = {
  persistent: false,
  downloaded: async () => [],
  download: async (file) => {
    const response = await fetch(file.url, { credentials: "omit" });
    if (!response.ok) throw new Error(`Download failed (${response.status}).`);
    const blobUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = file.fileName;
    link.style.display = "none";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  },
  open: async (file) => {
    window.open(file.url, "_blank", "noopener,noreferrer");
  },
};

function selectBackend(): FileBackend {
  if (
    Capacitor.isNativePlatform() &&
    Capacitor.isPluginAvailable("OneShareFiles")
  ) {
    return nativeBackend();
  }
  if (window.desktopBridge?.isElectron) {
    return desktopBackend(window.desktopBridge);
  }
  return browserBackend;
}

const backend = selectBackend();

/** Native shells open saved files in the system app; the web opens a tab. */
export const opensLocalFiles = backend.persistent;
/** Desktop can point the file manager at a saved file. */
export const canRevealFiles = backend.reveal !== undefined;

const UNKNOWN: LocalFileState = { status: "unknown" };
const REMOTE: LocalFileState = { status: "remote" };
const LOCAL: LocalFileState = { status: "local" };

const states = new Map<string, LocalFileState>();
const listeners = new Set<() => void>();
const inflight = new Map<string, Promise<void>>();
const pendingStatusKeys = new Set<string>();
let isStatusCheckScheduled = false;

function setState(key: string, state: LocalFileState) {
  states.set(key, state);
  for (const listener of listeners) listener();
}

backend.onProgress?.(({ key, received, total }) => {
  if (states.get(key)?.status !== "downloading") return;
  setState(key, {
    status: "downloading",
    progress: total > 0 ? Math.min(received / total, 1) : undefined,
  });
});

export function subscribeLocalFiles(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function localFileState(key: string): LocalFileState {
  return states.get(key) ?? UNKNOWN;
}

/** Batches every status lookup made during one render into a single call. */
export function checkLocalFile(key: string): void {
  if (states.has(key) || pendingStatusKeys.has(key)) return;
  if (!backend.persistent) {
    setState(key, REMOTE);
    return;
  }

  pendingStatusKeys.add(key);
  if (isStatusCheckScheduled) return;
  isStatusCheckScheduled = true;
  queueMicrotask(async () => {
    isStatusCheckScheduled = false;
    const keys = [...pendingStatusKeys];
    let downloaded = new Set<string>();
    try {
      downloaded = new Set(await backend.downloaded(keys));
    } catch {
      // Treat an unreadable store as empty; downloading again repairs it.
    }
    for (const key of keys) {
      pendingStatusKeys.delete(key);
      if (localFileState(key).status === "unknown") {
        setState(key, downloaded.has(key) ? LOCAL : REMOTE);
      }
    }
  });
}

export function attachmentFile(
  attachment: MessageAttachment,
): DownloadFile | undefined {
  if (!attachment.url || !attachment.storageId) return undefined;
  if (!KEY_PATTERN.test(attachment.storageId)) return undefined;
  return {
    key: attachment.storageId,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    url: attachment.url,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isNotDownloaded(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return (
    code === NOT_DOWNLOADED ||
    (typeof message === "string" && message.includes(NOT_DOWNLOADED))
  );
}

/** Saves a file locally; concurrent calls for the same key share one download. */
export function downloadAttachment(file: DownloadFile): Promise<void> {
  const running = inflight.get(file.key);
  if (running) return running;

  const download = (async () => {
    setState(file.key, { status: "downloading" });
    try {
      await backend.download(file);
      setState(file.key, LOCAL);
    } catch (error) {
      setState(file.key, REMOTE);
      throw new Error(errorMessage(error, "Download failed."));
    } finally {
      inflight.delete(file.key);
    }
  })();
  inflight.set(file.key, download);
  return download;
}

/** Opens the file in its system app, downloading it first if needed. */
export async function openAttachment(file: DownloadFile): Promise<void> {
  if (!backend.persistent) {
    await backend.open(file);
    return;
  }

  if (localFileState(file.key).status !== "local") {
    await downloadAttachment(file);
  }
  try {
    await backend.open(file);
  } catch (error) {
    if (!isNotDownloaded(error)) {
      throw new Error(errorMessage(error, "Couldn't open that file."));
    }
    // The user deleted the saved copy since; fetch it again.
    setState(file.key, REMOTE);
    await downloadAttachment(file);
    await backend.open(file);
  }
}

export async function revealAttachment(file: DownloadFile): Promise<void> {
  if (!backend.reveal) return;
  try {
    await backend.reveal(file);
  } catch (error) {
    if (!isNotDownloaded(error)) throw error;
    setState(file.key, REMOTE);
  }
}

export async function downloadFiles(
  files: readonly DownloadFile[],
): Promise<DownloadSummary> {
  let saved = 0;
  const failed: DownloadFailure[] = [];
  for (const file of files) {
    try {
      await downloadAttachment(file);
      saved += 1;
    } catch (error) {
      failed.push({
        fileName: file.fileName,
        reason: errorMessage(error, "Download failed."),
      });
    }
  }
  return { saved, failed };
}

/** Where saved files end up, for user-facing messages. */
export const downloadsLocation = window.desktopBridge?.isElectron
  ? "Downloads/OneShare"
  : backend.persistent
    ? "OneShare"
    : "Downloads";
