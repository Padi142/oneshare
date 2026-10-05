import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  attachmentFile,
  checkLocalFile,
  downloadAttachment,
  localFileState,
  openAttachment,
  revealAttachment,
  subscribeLocalFiles,
  type DownloadFile,
  type LocalFileState,
} from "../lib/download";
import type { MessageAttachment } from "../types";

const UNAVAILABLE: LocalFileState = { status: "unknown" };
const ERROR_VISIBLE_MS = 4000;

export interface LocalFile {
  /** Undefined while the attachment has no downloadable URL yet. */
  file?: DownloadFile;
  state: LocalFileState;
  error?: string;
  download: () => void;
  open: () => void;
  reveal: () => void;
}

/** Tracks one attachment's saved copy and exposes Telegram-style actions. */
export function useLocalFile(attachment: MessageAttachment): LocalFile {
  const { storageId, url, fileName, mimeType } = attachment;
  const file = useMemo(
    () => attachmentFile({ ...attachment, storageId, url, fileName, mimeType }),
    // Only these fields feed attachmentFile; the object itself is rebuilt often.
    [storageId, url, fileName, mimeType],
  );
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (file) checkLocalFile(file.key);
  }, [file]);

  useEffect(() => {
    if (!error) return;
    const timeout = window.setTimeout(
      () => setError(undefined),
      ERROR_VISIBLE_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [error]);

  const state = useSyncExternalStore(subscribeLocalFiles, () =>
    file ? localFileState(file.key) : UNAVAILABLE,
  );

  const run = useCallback(
    (action: (file: DownloadFile) => Promise<void>) => {
      if (!file) return;
      setError(undefined);
      action(file).catch((reason: unknown) =>
        setError(
          reason instanceof Error && reason.message
            ? reason.message
            : "Something went wrong.",
        ),
      );
    },
    [file],
  );

  return {
    file,
    state,
    error,
    download: useCallback(() => run(downloadAttachment), [run]),
    open: useCallback(() => run(openAttachment), [run]),
    reveal: useCallback(() => run(revealAttachment), [run]),
  };
}
