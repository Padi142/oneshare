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
  fileName: string;
  mimeType?: string;
  url: string;
}

export interface DesktopDownloadResult {
  saved: string[];
  failed: Array<{
    fileName: string;
    reason: string;
  }>;
}

export interface DesktopBridge {
  readonly isElectron: true;
  readonly platform: DesktopPlatform;
  getAppVersion(): Promise<string>;
  openExternal(url: string): Promise<boolean>;
  readFileFromPath(path: string): Promise<DesktopFile>;
  downloadFiles(files: DesktopDownloadFile[]): Promise<DesktopDownloadResult>;
  onMenuAction(listener: (action: DesktopMenuAction) => void): () => void;
}

declare global {
  interface Window {
    /** Present only in the Electron desktop shell; web and Capacitor stay browser-native. */
    readonly desktopBridge?: DesktopBridge;
  }
}
