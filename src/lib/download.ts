import { Capacitor, registerPlugin, type Plugin } from "@capacitor/core";

export interface DownloadFile {
  fileName: string;
  mimeType?: string;
  url: string;
}

export interface DownloadFailure {
  fileName: string;
  reason: string;
}

export interface DownloadSummary {
  destination: "browser" | "downloads" | "queued";
  saved: number;
  failed: DownloadFailure[];
}

interface NativeDownloadResult {
  enqueued: string[];
  failed: DownloadFailure[];
}

interface OneShareDownloadsPlugin extends Plugin {
  downloadFiles(options: {
    files: DownloadFile[];
  }): Promise<NativeDownloadResult>;
}

const nativeDownloads =
  registerPlugin<OneShareDownloadsPlugin>("OneShareDownloads");

async function downloadFilesInBrowser(
  files: readonly DownloadFile[],
): Promise<DownloadSummary> {
  let saved = 0;
  const failed: DownloadFailure[] = [];

  for (const file of files) {
    try {
      const response = await fetch(file.url, { credentials: "omit" });
      if (!response.ok)
        throw new Error(`Download failed (${response.status}).`);
      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = file.fileName;
      link.style.display = "none";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      saved += 1;
    } catch (error) {
      failed.push({
        fileName: file.fileName,
        reason:
          error instanceof Error && error.message
            ? error.message
            : "Download failed.",
      });
    }
  }

  return { destination: "browser", saved, failed };
}

export async function downloadFiles(
  files: readonly DownloadFile[],
): Promise<DownloadSummary> {
  if (
    Capacitor.getPlatform() === "android" &&
    Capacitor.isPluginAvailable("OneShareDownloads")
  ) {
    const result = await nativeDownloads.downloadFiles({ files: [...files] });
    return {
      destination: "queued",
      saved: result.enqueued.length,
      failed: result.failed,
    };
  }

  if (window.desktopBridge?.isElectron) {
    const result = await window.desktopBridge.downloadFiles([...files]);
    return {
      destination: "downloads",
      saved: result.saved.length,
      failed: result.failed,
    };
  }

  return downloadFilesInBrowser(files);
}
