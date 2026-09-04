import type { AttachmentKind, MessageRecord } from "../types";

export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
}

export function formatDuration(durationMs?: number): string | undefined {
  if (!durationMs || durationMs < 0) return undefined;
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function isSameDate(left: number, right: number): boolean {
  return new Date(left).toDateString() === new Date(right).toDateString();
}

export function messageText(message: MessageRecord): string {
  return message.text ?? "";
}

export function kindForFile(file: File): AttachmentKind {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return "file";
}

export function matchesSearch(message: MessageRecord, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  const attachmentValues = message.attachments.flatMap((attachment) => [
    attachment.fileName,
    attachment.mimeType,
  ]);
  return [messageText(message), ...attachmentValues].some((value) =>
    value.toLocaleLowerCase().includes(normalized),
  );
}

export function sortMessages(messages: MessageRecord[]): MessageRecord[] {
  return [...messages].sort(
    (left, right) => left._creationTime - right._creationTime,
  );
}
