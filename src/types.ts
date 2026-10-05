export type MessageKind = "text" | "image" | "video" | "file";

export type AttachmentKind = Exclude<MessageKind, "text">;

export interface MessageAttachment {
  kind: AttachmentKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageId?: string;
  url?: string | null;
  width?: number;
  height?: number;
  durationMs?: number;
}

export interface MessageLabel {
  name: string;
  source: "system" | "user" | "ai";
}

export interface MessageRecord {
  _id: string;
  _creationTime: number;
  text?: string;
  attachments: MessageAttachment[];
  labels?: MessageLabel[];
  senderId?: string;
  deletedAt?: number;
}

export interface StagedAttachment {
  id: string;
  file: File;
  previewUrl: string;
  kind: AttachmentKind;
  state: "ready" | "uploading" | "sent" | "error";
  progress: number;
  error?: string;
}

export interface SendAttachmentInput {
  kind: AttachmentKind;
  fileName: string;
  mimeType?: string;
  storageId: string;
  width?: number;
  height?: number;
  durationMs?: number;
}

export interface UploadResult {
  storageId: string;
  url?: string;
}

export type AuthMode = "signIn" | "signUp";
