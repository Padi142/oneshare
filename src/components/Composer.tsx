import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  FileIcon,
  ImageIcon,
  LoaderIcon,
  PaperclipIcon,
  SendIcon,
  TagIcon,
  VideoIcon,
  XIcon,
} from "../lib/icons";
import { labelHue } from "../lib/facets";
import { formatBytes, kindForFile, MAX_UPLOAD_BYTES } from "../lib/utils";
import type {
  SendAttachmentInput,
  StagedAttachment,
  UploadResult,
} from "../types";

interface ComposerProps {
  /** Label of the current filter, added to new messages unless dismissed. */
  activeLabel?: string;
  onSendMessage: (
    text: string,
    attachments: SendAttachmentInput[],
    labels: string[],
  ) => Promise<void>;
  onUploadFile: (
    file: File,
    onProgress: (progress: number) => void,
  ) => Promise<UploadResult>;
}

interface MediaMetadata {
  width?: number;
  height?: number;
  durationMs?: number;
}

function filesFromList(list: FileList | File[]): File[] {
  return Array.from(list).filter((file) => file.size <= MAX_UPLOAD_BYTES);
}

function fileError(file: File): string | undefined {
  if (file.size > MAX_UPLOAD_BYTES)
    return `${file.name} is larger than 500 MB.`;
  return undefined;
}

async function mediaMetadata(
  file: File,
  kind: StagedAttachment["kind"],
  previewUrl: string,
): Promise<MediaMetadata> {
  if (kind === "image") {
    return await new Promise<MediaMetadata>((resolve) => {
      const image = new Image();
      image.onload = () =>
        resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => resolve({});
      image.src = previewUrl;
    });
  }
  if (kind === "video") {
    return await new Promise<MediaMetadata>((resolve) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () =>
        resolve({
          width: video.videoWidth,
          height: video.videoHeight,
          durationMs: Math.round(video.duration * 1000),
        });
      video.onerror = () => resolve({});
      video.src = previewUrl;
    });
  }
  return {};
}

function attachmentIcon(kind: StagedAttachment["kind"]) {
  if (kind === "image") return <ImageIcon size={17} />;
  if (kind === "video") return <VideoIcon size={17} />;
  return <FileIcon size={17} />;
}

function uploadError(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Upload failed. Try again.";
}

function looksLikeDesktopFilePath(value: string): boolean {
  const path = value.trim();
  return (
    path.startsWith("/") ||
    path.startsWith("file://") ||
    /^[a-z]:[\\/]/i.test(path)
  );
}

export function Composer({
  activeLabel,
  onSendMessage,
  onUploadFile,
}: ComposerProps) {
  const [text, setText] = useState("");
  const [dismissedLabel, setDismissedLabel] = useState<string>();
  const appliedLabel =
    activeLabel !== undefined && activeLabel !== dismissedLabel
      ? activeLabel
      : undefined;
  const appliedLabels = appliedLabel ? [appliedLabel] : [];

  useEffect(() => setDismissedLabel(undefined), [activeLabel]);
  const [staged, setStaged] = useState<StagedAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragDepth = useRef(0);
  const previewUrlsRef = useRef(new Set<string>());
  const uploadTasksRef = useRef(
    new Map<string, Promise<SendAttachmentInput>>(),
  );
  const uploadedAttachmentsRef = useRef(new Map<string, SendAttachmentInput>());

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [text]);

  useEffect(
    () => () => {
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current.clear();
      uploadTasksRef.current.clear();
      uploadedAttachmentsRef.current.clear();
    },
    [],
  );

  const addFiles = useCallback(
    (incoming: FileList | File[]): StagedAttachment[] => {
      const candidates = Array.from(incoming);
      const tooLarge = candidates
        .map(fileError)
        .find((message) => message !== undefined);
      if (tooLarge) setError(tooLarge);
      const accepted = filesFromList(candidates);
      if (accepted.length === 0) return [];
      const next = accepted.map((file): StagedAttachment => {
        const previewUrl = URL.createObjectURL(file);
        previewUrlsRef.current.add(previewUrl);
        return {
          id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
          file,
          previewUrl,
          kind: kindForFile(file),
          state: "ready",
          progress: 0,
        };
      });
      setStaged((current) => [...current, ...next]);
      next.forEach((item) => {
        void uploadOne(item).catch(() => undefined);
      });
      setError(undefined);
      return next;
    },
    [],
  );

  function removeFile(id: string) {
    setStaged((current) => {
      const item = current.find((candidate) => candidate.id === id);
      if (item) {
        URL.revokeObjectURL(item.previewUrl);
        previewUrlsRef.current.delete(item.previewUrl);
      }
      uploadedAttachmentsRef.current.delete(id);
      return current.filter((candidate) => candidate.id !== id);
    });
  }

  function uploadOne(item: StagedAttachment): Promise<SendAttachmentInput> {
    const uploadedAttachment = uploadedAttachmentsRef.current.get(item.id);
    if (uploadedAttachment) return Promise.resolve(uploadedAttachment);

    const existingTask = uploadTasksRef.current.get(item.id);
    if (existingTask) return existingTask;

    const task = (async (): Promise<SendAttachmentInput> => {
      setStaged((current) =>
        current.map((candidate) =>
          candidate.id === item.id
            ? {
                ...candidate,
                state: "uploading",
                progress: 0,
                error: undefined,
              }
            : candidate,
        ),
      );
      try {
        const result = await onUploadFile(item.file, (progress) => {
          setStaged((current) =>
            current.map((candidate) =>
              candidate.id === item.id ? { ...candidate, progress } : candidate,
            ),
          );
        });
        const metadata = await mediaMetadata(
          item.file,
          item.kind,
          item.previewUrl,
        );
        const attachment = {
          storageId: result.storageId,
          kind: item.kind,
          fileName: item.file.name,
          ...(item.file.type ? { mimeType: item.file.type } : {}),
          ...metadata,
        } satisfies SendAttachmentInput;
        uploadedAttachmentsRef.current.set(item.id, attachment);
        setStaged((current) =>
          current.map((candidate) =>
            candidate.id === item.id
              ? { ...candidate, state: "sent", progress: 100 }
              : candidate,
          ),
        );
        return attachment;
      } catch (caught) {
        const message = uploadError(caught);
        setStaged((current) =>
          current.map((candidate) =>
            candidate.id === item.id
              ? { ...candidate, state: "error", error: message }
              : candidate,
          ),
        );
        throw new Error(message);
      }
    })();

    uploadTasksRef.current.set(item.id, task);
    void task.then(
      () => uploadTasksRef.current.delete(item.id),
      () => uploadTasksRef.current.delete(item.id),
    );
    return task;
  }

  async function retryFile(item: StagedAttachment) {
    if (isSending) return;
    setError(undefined);
    setIsSending(true);
    try {
      const attachment = await uploadOne(item);
      await onSendMessage("", [attachment], appliedLabels);
      removeFile(item.id);
    } catch (caught) {
      setError(uploadError(caught));
    } finally {
      setIsSending(false);
      textareaRef.current?.focus();
    }
  }

  async function handleSubmit() {
    if (isSending || (!text.trim() && staged.length === 0)) return;
    setError(undefined);
    setIsSending(true);
    try {
      const items = [...staged];
      const attachments = await Promise.all(items.map(uploadOne));
      await onSendMessage(text, attachments, appliedLabels);
      items.forEach((item) => {
        URL.revokeObjectURL(item.previewUrl);
        previewUrlsRef.current.delete(item.previewUrl);
        uploadedAttachmentsRef.current.delete(item.id);
      });
      setStaged([]);
      setText("");
    } catch (caught) {
      setError(uploadError(caught));
    } finally {
      setIsSending(false);
      textareaRef.current?.focus();
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void handleSubmit();
    }
  }

  async function attachPastedDesktopFile(path: string) {
    if (!window.desktopBridge) return;

    setIsSending(true);
    try {
      const desktopFile = await window.desktopBridge.readFileFromPath(path);
      const file = new File([desktopFile.contents], desktopFile.name, {
        type: desktopFile.mimeType,
        lastModified: desktopFile.lastModified,
      });
      const [item] = addFiles([file]);
      if (!item) return;
      const attachment = await uploadOne(item);
      await onSendMessage("", [attachment], appliedLabels);
      removeFile(item.id);
    } catch (caught) {
      setError(uploadError(caught));
    } finally {
      setIsSending(false);
      textareaRef.current?.focus();
    }
  }

  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files);
    if (files.length > 0) {
      event.preventDefault();
      addFiles(files);
      return;
    }

    const pastedText = event.clipboardData.getData("text/plain");
    if (!window.desktopBridge || !looksLikeDesktopFilePath(pastedText)) return;

    event.preventDefault();
    void attachPastedDesktopFile(pastedText);
  }

  useEffect(() => {
    function isFileDrag(event: DragEvent): boolean {
      return event.dataTransfer?.types.includes("Files") ?? false;
    }

    function handleDragEnter(event: DragEvent) {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      dragDepth.current += 1;
      setIsDragging(true);
    }

    function handleDragOver(event: DragEvent) {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      setIsDragging(true);
    }

    function handleDragLeave(event: DragEvent) {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      dragDepth.current -= 1;
      if (dragDepth.current <= 0) {
        dragDepth.current = 0;
        setIsDragging(false);
      }
    }

    function handleDrop(event: DragEvent) {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setIsDragging(false);
      const files = event.dataTransfer?.files;
      if (files && files.length > 0) addFiles(files);
    }

    function resetDrag() {
      dragDepth.current = 0;
      setIsDragging(false);
    }

    document.addEventListener("dragenter", handleDragEnter);
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("dragleave", handleDragLeave);
    document.addEventListener("drop", handleDrop);
    document.addEventListener("dragend", resetDrag);
    window.addEventListener("blur", resetDrag);
    return () => {
      document.removeEventListener("dragenter", handleDragEnter);
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("dragleave", handleDragLeave);
      document.removeEventListener("drop", handleDrop);
      document.removeEventListener("dragend", resetDrag);
      window.removeEventListener("blur", resetDrag);
    };
  }, [addFiles]);

  const isUploading = staged.some((item) => item.state === "uploading");
  const canSend = !isSending && Boolean(text.trim() || staged.length);
  const composerStatus = isSending
    ? isUploading
      ? "Finishing upload…"
      : "Sending…"
    : isUploading
      ? "Uploading…"
      : undefined;

  return (
    <div className="composer">
      {isDragging ? (
        <div className="drop-overlay" role="status" aria-live="polite">
          <span>Drop to attach</span>
        </div>
      ) : null}
      {error ? (
        <p className="composer-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="composer-box">
        {appliedLabel ? (
          <div className="composer-label">
            <span
              className="composer-label-chip"
              style={
                { "--label-hue": labelHue(appliedLabel) } as React.CSSProperties
              }
            >
              <TagIcon size={13} />
              Adds <strong>#{appliedLabel}</strong>
              <button
                type="button"
                className="composer-label-remove"
                onClick={() => setDismissedLabel(appliedLabel)}
                aria-label={`Don't add #${appliedLabel}`}
                title={`Don't add #${appliedLabel}`}
              >
                <XIcon size={12} />
              </button>
            </span>
          </div>
        ) : null}
        {staged.length > 0 ? (
          <ul className="staged-list" aria-label="Attachments">
            {staged.map((item) => (
              <li
                className={`staged-item staged-item--${item.state}`}
                key={item.id}
              >
                {item.kind === "image" ? (
                  <img src={item.previewUrl} alt="" />
                ) : (
                  <span className="staged-icon">
                    {attachmentIcon(item.kind)}
                  </span>
                )}
                <span className="staged-copy">
                  <strong title={item.file.name}>{item.file.name}</strong>
                  <small>
                    {item.state === "uploading"
                      ? `Uploading ${item.progress}%`
                      : item.state === "error"
                        ? "Upload failed"
                        : formatBytes(item.file.size)}
                  </small>
                </span>
                {item.state === "uploading" ? (
                  <span
                    className="staged-progress"
                    role="progressbar"
                    aria-valuenow={item.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Uploading ${item.file.name}`}
                  >
                    <span style={{ width: `${item.progress}%` }} />
                  </span>
                ) : null}
                {item.state === "error" ? (
                  <button
                    className="text-button staged-retry"
                    type="button"
                    onClick={() => void retryFile(item)}
                  >
                    Retry
                  </button>
                ) : null}
                {item.state !== "uploading" ? (
                  <button
                    className="icon-button staged-remove"
                    type="button"
                    onClick={() => removeFile(item.id)}
                    aria-label={`Remove ${item.file.name}`}
                  >
                    <XIcon size={14} />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="composer-row">
          <button
            className="icon-button composer-attach"
            type="button"
            onClick={() => inputRef.current?.click()}
            aria-label="Attach files"
            title="Attach files"
            disabled={isSending}
          >
            <PaperclipIcon size={20} />
          </button>
          <input
            ref={inputRef}
            type="file"
            className="sr-only"
            multiple
            tabIndex={-1}
            onChange={(event) => {
              if (event.target.files) addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <textarea
            ref={textareaRef}
            className="composer-textarea"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Message"
            rows={1}
            aria-label="Message"
            disabled={isSending}
          />
          <button
            className="send-button"
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSend}
            aria-label="Send"
            title="Send (Enter)"
          >
            {isSending ? (
              <LoaderIcon className="spin" size={18} />
            ) : (
              <SendIcon size={18} />
            )}
          </button>
        </div>
      </div>
      <p className="composer-hint">
        {composerStatus ?? (
          <>
            <kbd>Enter</kbd> to send, <kbd>Shift</kbd> + <kbd>Enter</kbd> for a
            new line
          </>
        )}
      </p>
    </div>
  );
}
