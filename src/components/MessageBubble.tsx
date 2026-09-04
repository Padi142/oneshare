import { useState } from "react";
import {
  CheckDoubleIcon,
  ClipboardIcon,
  DownloadIcon,
  FileIcon,
  ImageIcon,
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
  onRequestDelete: (message: LocalMessage) => void;
}

function AttachmentVisual({ attachment }: { attachment: MessageAttachment }) {
  if (
    (attachment.kind === "image" || attachment.kind === "video") &&
    attachment.url
  ) {
    if (attachment.kind === "image") {
      return (
        <a
          className="media-preview"
          href={attachment.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${attachment.fileName}`}
        >
          <img src={attachment.url} alt={attachment.fileName} loading="lazy" />
        </a>
      );
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
      className={`message-row ${message.localStatus ? "message-row--local" : ""}`}
      data-message-id={message._id}
    >
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
            <span className="message-state message-state--error">Not sent</span>
          ) : null}
          {!message.localStatus ? (
            <CheckDoubleIcon className="message-checks" size={16} />
          ) : null}
        </footer>
        <div className="message-actions" aria-label="Message actions">
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
            className="icon-button icon-button--danger"
            onClick={() => onRequestDelete(message)}
            aria-label="Delete message"
            title="Delete message"
          >
            <TrashIcon size={15} />
          </button>
        </div>
      </div>
    </article>
  );
}
