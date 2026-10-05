export type DesktopPlatform =
  | "aix"
  | "android"
  | "darwin"
  | "freebsd"
  | "haiku"
  | "linux"
  | "openbsd"
  | "sunos"
  | "win32";

export type DesktopMenuAction = "new-message" | "focus-search";

export interface DesktopFile {
  name: string;
  mimeType: string;
  lastModified: number;
  contents: ArrayBuffer;
}

export interface DesktopDownloadFile {
  /** Stable attachment id; the same key always maps to the same saved file. */
  key: string;
  fileName: string;
  mimeType?: string;
  url: string;
}

export interface DesktopDownloadResult {
  fileName: string;
}

export interface DesktopDownloadProgress {
  key: string;
  received: number;
  /** -1 when the server didn't report a size. */
  total: number;
}

export interface DesktopBridge {
  readonly isElectron: true;
  readonly platform: DesktopPlatform;
  getAppVersion(): Promise<string>;
  openExternal(url: string): Promise<boolean>;
  readFileFromPath(path: string): Promise<DesktopFile>;
  /** Returns the subset of keys that are still saved on disk. */
  getDownloadedFiles(keys: string[]): Promise<string[]>;
  /** Saves into ~/Downloads/OneShare, or resolves at once if already saved. */
  downloadFile(file: DesktopDownloadFile): Promise<DesktopDownloadResult>;
  openDownloadedFile(key: string): Promise<void>;
  showDownloadedFile(key: string): Promise<void>;
  onDownloadProgress(
    listener: (progress: DesktopDownloadProgress) => void,
  ): () => void;
  onMenuAction(listener: (action: DesktopMenuAction) => void): () => void;
}

declare global {
  interface Window {
    /** Present only in the Electron desktop shell; web and Capacitor stay browser-native. */
    readonly desktopBridge?: DesktopBridge;
  }
}
