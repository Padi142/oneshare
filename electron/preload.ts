import { contextBridge, ipcRenderer } from "electron";

import type {
  DesktopBridge,
  DesktopFile,
  DesktopMenuAction,
  DesktopPlatform,
} from "./types";

const APP_VERSION_CHANNEL = "app:get-version";
const OPEN_EXTERNAL_CHANNEL = "shell:open-external";
const READ_FILE_FROM_PATH_CHANNEL = "file:read-from-path";
const MENU_ACTION_CHANNEL = "menu:action";

const MENU_ACTIONS = new Set<DesktopMenuAction>([
  "new-message",
  "focus-search",
]);

const bridge: DesktopBridge = Object.freeze({
  isElectron: true as const,
  platform: process.platform as DesktopPlatform,
  getAppVersion: () => ipcRenderer.invoke(APP_VERSION_CHANNEL),
  openExternal: (url: string) => ipcRenderer.invoke(OPEN_EXTERNAL_CHANNEL, url),
  readFileFromPath: (path: string) =>
    ipcRenderer.invoke(
      READ_FILE_FROM_PATH_CHANNEL,
      path,
    ) as Promise<DesktopFile>,
  onMenuAction: (listener: (action: DesktopMenuAction) => void) => {
    const wrappedListener = (
      _event: Electron.IpcRendererEvent,
      value: unknown,
    ) => {
      if (
        typeof value !== "string" ||
        !MENU_ACTIONS.has(value as DesktopMenuAction)
      ) {
        return;
      }

      listener(value as DesktopMenuAction);
    };

    ipcRenderer.on(MENU_ACTION_CHANNEL, wrappedListener);
    return () =>
      ipcRenderer.removeListener(MENU_ACTION_CHANNEL, wrappedListener);
  },
});

contextBridge.exposeInMainWorld("desktopBridge", bridge);
