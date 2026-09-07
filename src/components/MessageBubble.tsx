import { useEffect, useState } from "react";
import {
  CheckDoubleIcon,
  ClipboardIcon,
  DownloadIcon,
  FileIcon,
  ImageIcon,
  SelectIcon,
  TrashIcon,
  VideoIcon,
} from "../lib/icons";
import {
  formatBytes,
  formatDuration,
  formatTime,
  messageText,
} from "../lib/utils";
import type { MessageAttachment } from "../types";
import type { LocalMessage } from "../hooks/useChat";

interface MessageBubbleProps {
  message: LocalMessage;
  isSelectionMode: boolean;
  isSelected: boolean;
  onStartSelection: (messageId: string) => void;
  onToggleSelect: (messageId: string) => void;
  onRequestDelete: (message: LocalMessage) => void;
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

  function openImage(event: React.MouseEvent<HTMLAnchorElement>) {
    if (!attachment.url || !window.desktopBridge?.isElectron) return;
    event.preventDefault();
    void window.desktopBridge.openExternal(attachment.url);
  }

  const copyMessage =
    copyState === "copied"
      ? "Image copied"
      : copyState === "copying"
        ? "Copying image…"
        : copyState === "error"
          ? "Couldn’t copy image"
          : "Right-click to copy image";

  return (
    <a
      className="media-preview"
      href={attachment.url ?? undefined}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open ${attachment.fileName} in a browser`}
      title={`${attachment.fileName} · ${copyMessage}`}
      onClick={openImage}
      onContextMenu={(event) => void copyImage(event)}
    >
      <img
        src={attachment.url ?? undefined}
        alt={attachment.fileName}
        loading="lazy"
      />
      {copyState !== "idle" ? (
        <span className="media-copy-status" role="status" aria-live="polite">
          {copyMessage}
        </span>
      ) : null}
    </a>
  );
}

function AttachmentVisual({ attachment }: { attachment: MessageAttachment }) {
  if (
    (attachment.kind === "image" || attachment.kind === "video") &&
    attachment.url
  ) {
    if (attachment.kind === "image") {
      return <ImagePreview attachment={attachment} />;
    }
    return (
      <video
        className="media-preview"
        src={attachment.url}
        controls
        preload="metadata"
        aria-label={attachment.fileName}
      />
    );
  }

  const isImage = attachment.kind === "image";
  const isVideo = attachment.kind === "video";
  return (
    <div className="file-card">
      <span className={`file-icon file-icon--${attachment.kind}`}>
        {isImage ? (
          <ImageIcon size={21} />
        ) : isVideo ? (
          <VideoIcon size={21} />
        ) : (
          <FileIcon size={21} />
        )}
      </span>
      <span className="file-card-copy">
        <strong>{attachment.fileName}</strong>
        <small>
          {formatBytes(attachment.sizeBytes)}
          {attachment.durationMs
            ? ` · ${formatDuration(attachment.durationMs)}`
            : ""}
        </small>
      </span>
      {attachment.url ? (
        <a
          className="icon-button file-download"
          href={attachment.url}
          download={attachment.fileName}
          aria-label={`Download ${attachment.fileName}`}
        >
          <DownloadIcon size={17} />
        </a>
      ) : null}
    </div>
  );
}

export function MessageBubble({
  message,
  isSelectionMode,
  isSelected,
  onStartSelection,
  onToggleSelect,
  onRequestDelete,
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const text = messageText(message);
  const attachments = message.attachments;

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

  return (
    <article
      className={`message-row ${message.localStatus ? "message-row--local" : ""} ${isSelectionMode ? "message-row--selection" : ""} ${isSelected ? "message-row--selected" : ""}`}
      data-message-id={message._id}
    >
      <div className="message-wrap">
        <div className="message-bubble">
          {attachments.map((attachment) => (
            <AttachmentVisual
              key={`${message._id}-${attachment.storageId ?? attachment.fileName}`}
              attachment={attachment}
            />
          ))}
          {text ? <p className="message-copy">{text}</p> : null}
          <footer className="message-meta">
            <time dateTime={new Date(message._creationTime).toISOString()}>
              {formatTime(message._creationTime)}
            </time>
            {message.localStatus === "sending" ? (
              <span className="message-state">Sending…</span>
            ) : null}
            {message.localStatus === "failed" ? (
              <span className="message-state message-state--error">
                Not sent
              </span>
            ) : null}
            {!message.localStatus ? (
              <CheckDoubleIcon className="message-checks" size={16} />
            ) : null}
          </footer>
          <div className="message-actions" aria-label="Message actions">
            {isSelectionMode ? (
              <button
                type="button"
                className="icon-button selection-toggle"
                onClick={() => onToggleSelect(message._id)}
                aria-label={isSelected ? "Deselect message" : "Select message"}
                aria-pressed={isSelected}
                title={isSelected ? "Deselect message" : "Select message"}
              >
                <SelectIcon size={15} />
              </button>
            ) : (
              <>
                {text ? (
                  <button
                    type="button"
                    className="icon-button"
                    onClick={copyMessage}
                    aria-label={copied ? "Copied" : "Copy text"}
                    title={copied ? "Copied" : "Copy text"}
                  >
                    {copied ? (
                      <CheckDoubleIcon size={15} />
                    ) : (
                      <ClipboardIcon size={15} />
                    )}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => onStartSelection(message._id)}
                  aria-label="Select message"
                  title="Select message"
                >
                  <SelectIcon size={15} />
                </button>
                <button
                  type="button"
                  className="icon-button icon-button--danger"
                  onClick={() => onRequestDelete(message)}
                  aria-label="Delete message"
                  title="Delete message"
                >
                  <TrashIcon size={15} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
