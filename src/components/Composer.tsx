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
  VideoIcon,
  XIcon,
} from "../lib/icons";
import { formatBytes, kindForFile, MAX_UPLOAD_BYTES } from "../lib/utils";
import type {
  SendAttachmentInput,
  StagedAttachment,
  UploadResult,
} from "../types";

interface ComposerProps {
  onSendMessage: (
    text: string,
    attachments: SendAttachmentInput[],
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

export function Composer({ onSendMessage, onUploadFile }: ComposerProps) {
  const [text, setText] = useState("");
  const [staged, setStaged] = useState<StagedAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragDepth = useRef(0);
  const previewUrlsRef = useRef(new Set<string>());

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
    },
    [],
  );

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const candidates = Array.from(incoming);
    const tooLarge = candidates
      .map(fileError)
      .find((message) => message !== undefined);
    if (tooLarge) setError(tooLarge);
    const accepted = filesFromList(candidates);
    if (accepted.length === 0) return;
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
    setError(undefined);
  }, []);

  function removeFile(id: string) {
    setStaged((current) => {
      const item = current.find((candidate) => candidate.id === id);
      if (item) {
        URL.revokeObjectURL(item.previewUrl);
        previewUrlsRef.current.delete(item.previewUrl);
      }
      return current.filter((candidate) => candidate.id !== id);
    });
  }

  async function uploadOne(
    item: StagedAttachment,
  ): Promise<SendAttachmentInput> {
    setStaged((current) =>
      current.map((candidate) =>
        candidate.id === item.id
          ? { ...candidate, state: "uploading", progress: 0, error: undefined }
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
      setStaged((current) =>
        current.map((candidate) =>
          candidate.id === item.id
            ? { ...candidate, state: "sent", progress: 100 }
            : candidate,
        ),
      );
      return {
        storageId: result.storageId,
        kind: item.kind,
        fileName: item.file.name,
        ...(item.file.type ? { mimeType: item.file.type } : {}),
        ...metadata,
      };
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
  }

  async function retryFile(item: StagedAttachment) {
    setError(undefined);
    try {
      const attachment = await uploadOne(item);
      await onSendMessage("", [attachment]);
      removeFile(item.id);
    } catch (caught) {
      setError(uploadError(caught));
    }
  }

  async function handleSubmit() {
    if (isSending || (!text.trim() && staged.length === 0)) return;
    setError(undefined);
    setIsSending(true);
    try {
      const attachments: SendAttachmentInput[] = [];
      for (const item of staged) attachments.push(await uploadOne(item));
      await onSendMessage(text, attachments);
      staged.forEach((item) => {
        URL.revokeObjectURL(item.previewUrl);
        previewUrlsRef.current.delete(item.previewUrl);
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

  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return;
    event.preventDefault();
    addFiles(files);
  }

  function handleDragEnter(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current += 1;
    if (event.dataTransfer.types.includes("Files")) setIsDragging(true);
  }

  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setIsDragging(false);
    }
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    if (event.dataTransfer.files.length > 0) addFiles(event.dataTransfer.files);
  }

  const canSend = !isSending && Boolean(text.trim() || staged.length);

  return (
    <div
      className={`composer-wrap ${isDragging ? "composer-wrap--dragging" : ""}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      {isDragging ? (
        <div className="drop-overlay" role="status">
          <PaperclipIcon size={21} />
          <span>Drop to add to relay</span>
        </div>
      ) : null}
      {staged.length > 0 ? (
        <div className="staged-tray" aria-label="Files ready to send">
          {staged.map((item) => (
            <div
              className={`staged-item staged-item--${item.state}`}
              key={item.id}
            >
              {item.kind === "image" ? (
                <img src={item.previewUrl} alt="" />
              ) : (
                <span className={`staged-icon staged-icon--${item.kind}`}>
                  {attachmentIcon(item.kind)}
                </span>
              )}
              <span className="staged-copy">
                <strong title={item.file.name}>{item.file.name}</strong>
                <small>
                  {item.state === "uploading"
                    ? `${item.progress}%`
                    : formatBytes(item.file.size)}
                </small>
              </span>
              {item.state === "uploading" ? (
                <span
                  className="staged-progress"
                  aria-label={`Uploading ${item.progress}%`}
                >
                  <span style={{ width: `${item.progress}%` }} />
                </span>
              ) : null}
              {item.state === "error" ? (
                <button
                  className="staged-retry"
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
            </div>
          ))}
        </div>
      ) : null}
      <div className="composer-main">
        <button
          className="icon-button composer-attach"
          type="button"
          onClick={() => inputRef.current?.click()}
          aria-label="Attach files"
          title="Attach files"
          disabled={isSending}
        >
          <PaperclipIcon size={21} />
        </button>
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          multiple
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
          placeholder="Write a note or drop something here…"
          rows={1}
          aria-label="Message"
          disabled={isSending}
        />
        <button
          className="send-button"
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!canSend}
          aria-label="Send message"
          title="Send message"
        >
          <SendIcon size={19} />
        </button>
      </div>
      <div className="composer-footer">
        <span>
          {error ? (
            <span className="composer-error" role="alert">
              {error}
            </span>
          ) : (
            <>
              Enter to send <kbd>⇧</kbd> Enter for a new line
            </>
          )}
        </span>
        {isSending ? (
          <span className="composer-status">
            <LoaderIcon className="spin" size={14} /> Uploading
          </span>
        ) : null}
      </div>
    </div>
  );
}
