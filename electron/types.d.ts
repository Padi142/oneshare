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

export interface DesktopBridge {
  readonly isElectron: true;
  readonly platform: DesktopPlatform;
  getAppVersion(): Promise<string>;
  openExternal(url: string): Promise<boolean>;
  onMenuAction(listener: (action: DesktopMenuAction) => void): () => void;
}

declare global {
  interface Window {
    /** Present only in the Electron desktop shell; web and Capacitor stay browser-native. */
    readonly desktopBridge?: DesktopBridge;
  }
}
