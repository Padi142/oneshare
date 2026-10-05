import { useCallback, useMemo, useState } from "react";
import { useMutation, usePaginatedQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { hashtagsIn, normalizeLabel } from "../lib/facets";
import { sortMessages } from "../lib/utils";
import type {
  MessageRecord,
  SendAttachmentInput,
  UploadResult,
} from "../types";

export type LocalMessage = MessageRecord & {
  localStatus?: "sending" | "failed";
};

interface UseChatResult {
  messages: LocalMessage[];
  isLoading: boolean;
  paginationStatus:
    "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";
  loadMore: (count: number) => void;
  sendText: (body: string) => Promise<void>;
  sendAttachment: (attachment: SendAttachmentInput) => Promise<void>;
  sendMessage: (
    body: string,
    attachments: SendAttachmentInput[],
    labels?: string[],
  ) => Promise<void>;
  uploadFile: (
    file: File,
    onProgress: (progress: number) => void,
  ) => Promise<UploadResult>;
  deleteMessage: (messageId: string) => Promise<void>;
  setLabel: (
    messageIds: string[],
    name: string,
    applied: boolean,
  ) => Promise<void>;
}

function pendingId(): string {
  return `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Messages for one filter facet ("type:pdf", "label:todo"), or all of them. */
export function useChat(facet?: string): UseChatResult {
  const page = usePaginatedQuery(
    api.messages.listMessages,
    facet === undefined ? {} : { facet },
    { initialNumItems: 32 },
  );
  const sendMutation = useMutation(api.messages.sendMessage);
  const deleteMutation = useMutation(api.messages.deleteMessage);
  const setLabelMutation = useMutation(api.facets.setLabel);
  const generateUploadUrl = useMutation(api.messages.createUploadUrl);
  const [pending, setPending] = useState<LocalMessage[]>([]);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());

  const messages = useMemo(() => {
    const visible = page.results.filter(
      (message) => !hiddenIds.has(message._id),
    );
    return sortMessages([...visible, ...pending]);
  }, [hiddenIds, page.results, pending]);

  const sendMessage = useCallback(
    async (
      body: string,
      attachments: SendAttachmentInput[],
      labels: string[] = [],
    ) => {
      const trimmed = body.trim();
      if (!trimmed && attachments.length === 0) return;
      const labelNames = new Set(
        [...hashtagsIn(trimmed), ...labels].flatMap(
          (name) => normalizeLabel(name) ?? [],
        ),
      );
      const optimistic: LocalMessage = {
        _id: pendingId(),
        _creationTime: Date.now(),
        ...(trimmed ? { text: trimmed } : {}),
        attachments: attachments.map((attachment) => ({
          ...attachment,
          mimeType: attachment.mimeType ?? "application/octet-stream",
          sizeBytes: 0,
        })),
        labels: [...labelNames].sort().map((name) => ({
          name,
          source: "user" as const,
        })),
        localStatus: "sending",
      };
      setPending((current) => [...current, optimistic]);
      try {
        await sendMutation({
          ...(trimmed ? { text: trimmed } : {}),
          ...(attachments.length > 0
            ? {
                attachments: attachments.map((attachment) => ({
                  ...attachment,
                  storageId: attachment.storageId as Id<"_storage">,
                })),
              }
            : {}),
          ...(labels.length > 0 ? { labels } : {}),
        });
        setPending((current) =>
          current.filter((message) => message._id !== optimistic._id),
        );
      } catch (error) {
        setPending((current) =>
          current.map((message) =>
            message._id === optimistic._id
              ? { ...message, localStatus: "failed" }
              : message,
          ),
        );
        throw error;
      }
    },
    [sendMutation],
  );

  const sendText = useCallback(
    async (body: string) => {
      await sendMessage(body, []);
    },
    [sendMessage],
  );

  const sendAttachment = useCallback(
    async (attachment: SendAttachmentInput) => {
      await sendMessage("", [attachment]);
    },
    [sendMessage],
  );

  const uploadFile = useCallback(
    async (
      file: File,
      onProgress: (progress: number) => void,
    ): Promise<UploadResult> => {
      const uploadUrl = await generateUploadUrl({});
      const payload = await new Promise<UploadResult>((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open("POST", uploadUrl);
        request.setRequestHeader(
          "Content-Type",
          file.type || "application/octet-stream",
        );
        request.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable)
            onProgress(Math.round((event.loaded / event.total) * 100));
        });
        request.addEventListener("error", () =>
          reject(
            new Error("Upload interrupted. Check your connection and retry."),
          ),
        );
        request.addEventListener("abort", () =>
          reject(new Error("Upload was cancelled.")),
        );
        request.addEventListener("load", () => {
          if (request.status < 200 || request.status >= 300) {
            reject(new Error(`Upload failed (${request.status}).`));
            return;
          }
          try {
            const raw: { storageId?: string } = JSON.parse(
              request.responseText,
            );
            const storageId = raw.storageId;
            if (storageId === undefined || storageId.length === 0) {
              reject(new Error("The upload completed without a storage id."));
              return;
            }
            resolve({ storageId });
          } catch {
            reject(new Error("The upload response was not readable."));
          }
        });
        request.send(file);
      });
      onProgress(100);
      return payload;
    },
    [generateUploadUrl],
  );

  const deleteMessage = useCallback(
    async (messageId: string) => {
      await deleteMutation({ messageId: messageId as Id<"messages"> });
      setHiddenIds((current) => new Set(current).add(messageId));
    },
    [deleteMutation],
  );

  const setLabel = useCallback(
    async (messageIds: string[], name: string, applied: boolean) => {
      await setLabelMutation({
        messageIds: messageIds as Id<"messages">[],
        name,
        applied,
      });
    },
    [setLabelMutation],
  );

  return {
    messages,
    isLoading: page.isLoading,
    paginationStatus: page.status,
    loadMore: page.loadMore,
    sendText,
    sendAttachment,
    sendMessage,
    uploadFile,
    deleteMessage,
    setLabel,
  };
}
