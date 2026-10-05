import { useEffect, useRef, useState } from "react";
import {
  ArrowDownIcon,
  CheckIcon,
  ClipboardIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FolderIcon,
  ImageIcon,
  LoaderIcon,
  SelectIcon,
  TagIcon,
  TrashIcon,
  VideoIcon,
} from "../lib/icons";
import {
  fileIconFor,
  HASHTAG_PATTERN,
  hashtagsIn,
  labelHue,
  normalizeLabel,
} from "../lib/facets";
import {
  formatBytes,
  formatDuration,
  formatTime,
  messageText,
} from "../lib/utils";
import {
  canRevealFiles,
  opensLocalFiles,
  type LocalFileState,
} from "../lib/download";
import { useLocalFile, type LocalFile } from "../hooks/useLocalFile";
import type { MessageAttachment } from "../types";
import type { LocalMessage } from "../hooks/useChat";
import { LabelPicker } from "./LabelPicker";
import { LabelPills } from "./LabelPills";

interface MessageBubbleProps {
  message: LocalMessage;
  isSelectionMode: boolean;
  isSelected: boolean;
  allLabels: string[];
  onStartSelection: (messageId: string) => void;
  onToggleSelect: (messageId: string) => void;
  onRequestDelete: (message: LocalMessage) => void;
  onSetLabel: (messageIds: string[], name: string, applied: boolean) => void;
  onSelectLabel: (name: string) => void;
}

async function clipboardImageBlob(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  if (typeof createImageBitmap !== "function") {
    throw new Error("Image conversion is not supported.");
  }

  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image conversion is not supported.");
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((png) => {
        if (png) resolve(png);
        else reject(new Error("Image conversion failed."));
      }, "image/png");
    });
  } finally {
    bitmap.close();
  }
}

function ImagePreview({ attachment }: { attachment: MessageAttachment }) {
  const localFile = useLocalFile(attachment);
  const [copyState, setCopyState] = useState<
    "idle" | "copying" | "copied" | "error"
  >("idle");

  useEffect(() => {
    if (copyState === "idle" || copyState === "copying") return;
    const timeout = window.setTimeout(() => setCopyState("idle"), 1800);
    return () => window.clearTimeout(timeout);
  }, [copyState]);

  async function copyImage(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (
      !attachment.url ||
      !navigator.clipboard?.write ||
      typeof ClipboardItem === "undefined"
    ) {
      setCopyState("error");
      return;
    }

    setCopyState("copying");
    try {
      const clipboardBlob = fetch(attachment.url, { credentials: "omit" }).then(
        async (response) => {
          if (!response.ok) throw new Error("Image could not be read.");
          return clipboardImageBlob(await response.blob());
        },
      );
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": clipboardBlob }),
      ]);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  // Native shells open the saved image in the system viewer; the web keeps
  // the plain link to a new tab.
  function openImage(event: React.MouseEvent<HTMLAnchorElement>) {
    if (!opensLocalFiles || !localFile.file) return;
    event.preventDefault();
    localFile.open();
  }

  const copyMessage =
    copyState === "copied"
      ? "Image copied"
      : copyState === "copying"
        ? "Copying image…"
        : copyState === "error"
          ? "Couldn’t copy image"
          : "Right-click to copy image";
  const statusMessage =
    localFile.error ?? (copyState !== "idle" ? copyMessage : undefined);

  return (
    <div className="media-preview">
      <a
        className="media-preview-link"
        href={attachment.url ?? undefined}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${attachment.fileName}`}
        title={`${attachment.fileName} · ${copyMessage}`}
        onClick={openImage}
        onContextMenu={(event) => void copyImage(event)}
      >
        <img
          src={attachment.url ?? undefined}
          alt={attachment.fileName}
          loading="lazy"
        />
      </a>
      <AttachmentDownloadButton
        localFile={localFile}
        fileName={attachment.fileName}
      />
      {statusMessage ? (
        <span className="media-copy-status" role="status" aria-live="polite">
          {statusMessage}
        </span>
      ) : null}
    </div>
  );
}

function ProgressRing({
  progress,
  size = 16,
}: {
  progress?: number;
  size?: number;
}) {
  if (progress === undefined)
    return <LoaderIcon className="spin" size={size} />;
  const radius = 9;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg
      className="progress-ring"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="progress-ring-track" cx="12" cy="12" r={radius} />
      <circle
        className="progress-ring-value"
        cx="12"
        cy="12"
        r={radius}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - progress)}
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
}

/** Download → progress → open (mobile) or show in folder (desktop). */
export function AttachmentDownloadButton({
  localFile,
  fileName,
  className = "media-download",
}: {
  localFile: LocalFile;
  fileName: string;
  className?: string;
}) {
  const { file, state, error } = localFile;
  if (!file) return null;

  const isDownloading = state.status === "downloading";
  const isSaved = state.status === "local";
  const label = error
    ? error
    : isDownloading
      ? state.progress === undefined
        ? `Downloading ${fileName}`
        : `Downloading ${fileName} (${Math.round(state.progress * 100)}%)`
      : isSaved && canRevealFiles
        ? `Show ${fileName} in folder`
        : isSaved && opensLocalFiles
          ? `Open ${fileName}`
          : `Download ${fileName}`;

  function handleClick(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (isDownloading) return;
    if (isSaved && canRevealFiles) localFile.reveal();
    else if (isSaved && opensLocalFiles) localFile.open();
    else localFile.download();
  }

  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      onClick={handleClick}
      aria-busy={isDownloading}
      aria-label={label}
      title={label}
    >
      {isDownloading ? (
        <ProgressRing progress={state.progress} />
      ) : isSaved && canRevealFiles ? (
        <FolderIcon size={16} />
      ) : isSaved && opensLocalFiles ? (
        <ExternalLinkIcon size={16} />
      ) : isSaved ? (
        <CheckIcon size={16} />
      ) : (
        <DownloadIcon size={16} />
      )}
    </button>
  );
}

/** The file-type icon, with a download badge until it's saved locally. */
export function FileStatusIcon({
  attachment,
  state,
}: {
  attachment: MessageAttachment;
  state: LocalFileState;
}) {
  const FileTypeIcon =
    attachment.kind === "image"
      ? ImageIcon
      : attachment.kind === "video"
        ? VideoIcon
        : fileIconFor(attachment);

  return (
    <span className="file-icon">
      {state.status === "downloading" ? (
        <ProgressRing progress={state.progress} size={24} />
      ) : (
        <FileTypeIcon size={20} />
      )}
      {opensLocalFiles && state.status === "remote" ? (
        <span className="file-icon-badge">
          <ArrowDownIcon size={10} strokeWidth={2.6} />
        </span>
      ) : null}
    </span>
  );
}

/** Size line under a file name, swapped for progress or an error. */
export function fileDetail(
  attachment: MessageAttachment,
  { state, error }: LocalFile,
): string {
  if (error) return error;
  const size = formatBytes(attachment.sizeBytes);
  if (state.status === "downloading") {
    return state.progress === undefined
      ? `Downloading… · ${size}`
      : `${Math.round(state.progress * 100)}% of ${size}`;
  }
  return attachment.durationMs
    ? `${size}, ${formatDuration(attachment.durationMs)}`
    : size;
}

function VideoPreview({ attachment }: { attachment: MessageAttachment }) {
  const localFile = useLocalFile(attachment);
  return (
    <div className="media-preview">
      <video
        className="media-preview-video"
        src={attachment.url ?? undefined}
        controls
        preload="metadata"
        aria-label={attachment.fileName}
      />
      <AttachmentDownloadButton
        localFile={localFile}
        fileName={attachment.fileName}
      />
      {localFile.error ? (
        <span className="media-copy-status" role="status" aria-live="polite">
          {localFile.error}
        </span>
      ) : null}
    </div>
  );
}

function FileCard({ attachment }: { attachment: MessageAttachment }) {
  const localFile = useLocalFile(attachment);
  return (
    <div className="file-card">
      <button
        type="button"
        className="file-card-open"
        onClick={localFile.open}
        disabled={!localFile.file}
        title={`Open ${attachment.fileName}`}
      >
        <FileStatusIcon attachment={attachment} state={localFile.state} />
        <span className="file-card-copy">
          <strong title={attachment.fileName}>{attachment.fileName}</strong>
          <small className={localFile.error ? "file-detail-error" : undefined}>
            {fileDetail(attachment, localFile)}
          </small>
        </span>
      </button>
      <AttachmentDownloadButton
        localFile={localFile}
        fileName={attachment.fileName}
        className="file-download"
      />
    </div>
  );
}

export function AttachmentVisual({
  attachment,
}: {
  attachment: MessageAttachment;
}) {
  if (attachment.kind === "image" && attachment.url) {
    return <ImagePreview attachment={attachment} />;
  }
  if (attachment.kind === "video" && attachment.url) {
    return <VideoPreview attachment={attachment} />;
  }
  return <FileCard attachment={attachment} />;
}

const URL_PATTERN = /(https?:\/\/[^\s<>"']+)/g;
const TRAILING_PUNCTUATION = /[.,!?;:)\]}]+$/;

function withHashtags(
  text: string,
  key: number,
  onSelectLabel: (name: string) => void,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(HASHTAG_PATTERN)) {
    const name = normalizeLabel(match[2]);
    if (name === undefined) continue;
    const start = match.index + match[1].length;
    nodes.push(text.slice(cursor, start));
    nodes.push(
      <button
        key={`${key}-${start}`}
        type="button"
        className="hashtag"
        style={{ "--label-hue": labelHue(name) } as React.CSSProperties}
        onClick={() => onSelectLabel(name)}
        title={`Show all #${name}`}
      >
        #{match[2]}
      </button>,
    );
    cursor = start + match[2].length + 1;
  }
  nodes.push(text.slice(cursor));
  return nodes;
}

/** Renders message text with bare http(s) URLs and #labels made clickable. */
function MessageText({
  text,
  onSelectLabel,
}: {
  text: string;
  onSelectLabel: (name: string) => void;
}) {
  const parts = text.split(URL_PATTERN);
  return (
    <p className="message-text">
      {parts.map((part, index) => {
        if (index % 2 === 0) return withHashtags(part, index, onSelectLabel);
        const trailing = part.match(TRAILING_PUNCTUATION)?.[0] ?? "";
        const url = trailing ? part.slice(0, -trailing.length) : part;
        return (
          <span key={index}>
            <a href={url} target="_blank" rel="noreferrer">
              {url}
            </a>
            {trailing}
          </span>
        );
      })}
    </p>
  );
}

const canHover = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(hover: hover)").matches;

export function MessageBubble({
  message,
  isSelectionMode,
  isSelected,
  allLabels,
  onStartSelection,
  onToggleSelect,
  onRequestDelete,
  onSetLabel,
  onSelectLabel,
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [isLabelPickerOpen, setIsLabelPickerOpen] = useState(false);
  const rowRef = useRef<HTMLElement>(null);
  const labelButtonRef = useRef<HTMLButtonElement>(null);
  const text = messageText(message);
  const labels = message.labels ?? [];
  const labelNames = new Set(labels.map((label) => label.name));
  // Hashtags are already visible and clickable in the text itself.
  const typedLabels = new Set(hashtagsIn(text));
  const extraLabels = labels.filter((label) => !typedLabels.has(label.name));
  const pickerLabels = [...new Set([...allLabels, ...labelNames])].sort();
  const attachments = message.attachments;
  const hasMedia = attachments.some(
    (attachment) =>
      (attachment.kind === "image" || attachment.kind === "video") &&
      attachment.url,
  );

  useEffect(() => {
    if (!isActive) return;
    function handlePointerDown(event: PointerEvent) {
      if (!rowRef.current?.contains(event.target as Node)) setIsActive(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isActive]);

  useEffect(() => {
    if (isSelectionMode) setIsActive(false);
  }, [isSelectionMode]);

  async function copyMessage() {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  // Touch devices have no hover, so a tap on the bubble reveals the actions.
  function handleBubbleClick(event: React.MouseEvent<HTMLDivElement>) {
    if (isSelectionMode || canHover()) return;
    if ((event.target as HTMLElement).closest("a, button, video")) return;
    setIsActive((active) => !active);
  }

  return (
    <article
      ref={rowRef}
      className={[
        "message-row",
        isSelectionMode ? "message-row--selecting" : "",
        isSelected ? "message-row--selected" : "",
        isActive ? "message-row--active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-message-id={message._id}
    >
      {isSelectionMode ? (
        <button
          type="button"
          className="message-select"
          onClick={() => onToggleSelect(message._id)}
          aria-pressed={isSelected}
          aria-label={isSelected ? "Deselect message" : "Select message"}
        >
          <span className="message-check" aria-hidden="true">
            {isSelected ? <CheckIcon size={14} strokeWidth={2.6} /> : null}
          </span>
        </button>
      ) : null}
      <div className="message-wrap">
        {isSelectionMode ? null : (
          <div className="message-actions" aria-label="Message actions">
            {text ? (
              <button
                type="button"
                className="icon-button"
                onClick={copyMessage}
                aria-label={copied ? "Copied" : "Copy text"}
                title={copied ? "Copied" : "Copy text"}
              >
                {copied ? <CheckIcon size={16} /> : <ClipboardIcon size={16} />}
              </button>
            ) : null}
            {message.localStatus === undefined ? (
              <button
                ref={labelButtonRef}
                type="button"
                className="icon-button"
                onClick={() => setIsLabelPickerOpen((open) => !open)}
                aria-label="Labels"
                aria-expanded={isLabelPickerOpen}
                title="Labels"
              >
                <TagIcon size={16} />
              </button>
            ) : null}
            <button
              type="button"
              className="icon-button"
              onClick={() => onStartSelection(message._id)}
              aria-label="Select message"
              title="Select"
            >
              <SelectIcon size={16} />
            </button>
            <button
              type="button"
              className="icon-button icon-button--danger"
              onClick={() => onRequestDelete(message)}
              aria-label="Delete message"
              title="Delete"
            >
              <TrashIcon size={16} />
            </button>
          </div>
        )}
        <div
          className={`message-bubble ${hasMedia && !text ? "message-bubble--media" : ""}`}
          onClick={handleBubbleClick}
        >
          {attachments.map((attachment) => (
            <AttachmentVisual
              key={`${message._id}-${attachment.storageId ?? attachment.fileName}`}
              attachment={attachment}
            />
          ))}
          {text ? (
            <MessageText text={text} onSelectLabel={onSelectLabel} />
          ) : null}
          <footer className="message-meta">
            <LabelPills labels={extraLabels} onSelect={onSelectLabel} />
            {message.localStatus === "sending" ? (
              <span>Sending…</span>
            ) : message.localStatus === "failed" ? (
              <span className="message-meta-error">Not sent</span>
            ) : (
              <time dateTime={new Date(message._creationTime).toISOString()}>
                {formatTime(message._creationTime)}
              </time>
            )}
          </footer>
        </div>
      </div>
      {isLabelPickerOpen ? (
        <LabelPicker
          anchorRef={labelButtonRef}
          labels={pickerLabels}
          stateOf={(name) => (labelNames.has(name) ? "all" : "none")}
          onToggle={(name, applied) => onSetLabel([message._id], name, applied)}
          onClose={() => setIsLabelPickerOpen(false)}
        />
      ) : null}
    </article>
  );
}
