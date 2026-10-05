import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import { mutation, query } from "./_generated/server.js";
import type { MutationCtx, QueryCtx } from "./_generated/server.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { requireUserId } from "./lib/authorization.js";
import {
  deleteMessageFacets,
  indexMessage,
  labelNameFromFacet,
  messageFacetRows,
} from "./lib/facetStore.js";

const MAX_TEXT_LENGTH = 20_000;
const MAX_ATTACHMENTS_PER_MESSAGE = 10;
const MAX_ATTACHMENT_SIZE_BYTES = 512 * 1024 * 1024;
const MAX_MESSAGE_SIZE_BYTES = 1 * 1024 * 1024 * 1024;
const MAX_FILE_NAME_LENGTH = 255;
const MAX_MIME_TYPE_LENGTH = 127;
const MAX_MEDIA_DIMENSION = 65_535;
const MAX_VIDEO_DURATION_MS = 24 * 60 * 60 * 1000;

const messageKindValidator = v.union(
  v.literal("file"),
  v.literal("image"),
  v.literal("video"),
);

const attachmentInputValidator = v.object({
  storageId: v.id("_storage"),
  kind: messageKindValidator,
  fileName: v.string(),
  mimeType: v.optional(v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  durationMs: v.optional(v.number()),
});

const attachmentValidator = v.object({
  storageId: v.id("_storage"),
  kind: messageKindValidator,
  fileName: v.string(),
  mimeType: v.string(),
  sizeBytes: v.number(),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  durationMs: v.optional(v.number()),
  url: v.union(v.string(), v.null()),
});

const messageLabelValidator = v.object({
  name: v.string(),
  source: v.union(v.literal("system"), v.literal("user"), v.literal("ai")),
});

const messageValidator = v.object({
  _id: v.id("messages"),
  _creationTime: v.number(),
  userId: v.id("users"),
  text: v.optional(v.string()),
  attachments: v.array(attachmentValidator),
  labels: v.array(messageLabelValidator),
});

const emptyAttachmentsValidator = v.optional(v.array(attachmentInputValidator));

type AttachmentInput = {
  storageId: Id<"_storage">;
  kind: "file" | "image" | "video";
  fileName: string;
  mimeType?: string;
  width?: number;
  height?: number;
  durationMs?: number;
};

type PreparedAttachment = {
  storageId: Id<"_storage">;
  kind: AttachmentInput["kind"];
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  durationMs?: number;
};

function invalidAttachment(message: string): never {
  throw new Error(`Invalid attachment: ${message}`);
}

function normalizeFileName(fileName: string): string {
  const normalized = fileName
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .split(/[\\/]/u)
    .at(-1)
    ?.trim();

  if (
    normalized === undefined ||
    normalized.length === 0 ||
    normalized === "." ||
    normalized === ".." ||
    normalized.length > MAX_FILE_NAME_LENGTH
  ) {
    invalidAttachment("file name");
  }

  return normalized;
}

function normalizeMimeType(mimeType: string | undefined): string {
  const normalized = (mimeType ?? "application/octet-stream")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();

  if (
    normalized.length === 0 ||
    normalized.length > MAX_MIME_TYPE_LENGTH ||
    !/^[a-z0-9][a-z0-9!#$&^_.+-]{0,62}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}$/u.test(
      normalized,
    )
  ) {
    invalidAttachment("MIME type");
  }

  return normalized;
}

function validateMediaMetadata(input: AttachmentInput): void {
  const hasWidth = input.width !== undefined;
  const hasHeight = input.height !== undefined;

  if (hasWidth !== hasHeight) {
    invalidAttachment("width and height must be provided together");
  }

  if (hasWidth && hasHeight) {
    const width = input.width;
    const height = input.height;
    if (
      input.kind === "file" ||
      width === undefined ||
      height === undefined ||
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > MAX_MEDIA_DIMENSION ||
      height > MAX_MEDIA_DIMENSION
    ) {
      invalidAttachment("media dimensions");
    }
  }

  if (input.durationMs !== undefined) {
    if (
      input.kind !== "video" ||
      !Number.isInteger(input.durationMs) ||
      input.durationMs < 0 ||
      input.durationMs > MAX_VIDEO_DURATION_MS
    ) {
      invalidAttachment("video duration");
    }
  }
}

async function prepareAttachment(
  ctx: MutationCtx,
  input: AttachmentInput,
): Promise<PreparedAttachment> {
  validateMediaMetadata(input);

  const fileName = normalizeFileName(input.fileName);
  const storageMetadata = await ctx.db.system.get("_storage", input.storageId);

  if (storageMetadata === null) {
    invalidAttachment("file is not present in storage");
  }

  if (
    !Number.isSafeInteger(storageMetadata.size) ||
    storageMetadata.size < 0 ||
    storageMetadata.size > MAX_ATTACHMENT_SIZE_BYTES
  ) {
    invalidAttachment("file size");
  }

  const mimeType = normalizeMimeType(
    storageMetadata.contentType ?? input.mimeType,
  );

  if (
    (input.kind === "image" && !mimeType.startsWith("image/")) ||
    (input.kind === "video" && !mimeType.startsWith("video/"))
  ) {
    invalidAttachment(`MIME type does not match ${input.kind} attachment`);
  }

  const existingAttachment = await ctx.db
    .query("messageAttachments")
    .withIndex("by_storage", (q) => q.eq("storageId", input.storageId))
    .first();

  if (existingAttachment !== null) {
    invalidAttachment("file has already been attached");
  }

  return {
    storageId: input.storageId,
    kind: input.kind,
    fileName,
    mimeType,
    sizeBytes: storageMetadata.size,
    ...(input.width !== undefined ? { width: input.width } : {}),
    ...(input.height !== undefined ? { height: input.height } : {}),
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
  };
}

async function withDetails(ctx: QueryCtx, message: Doc<"messages">) {
  const [attachments, facets] = await Promise.all([
    ctx.db
      .query("messageAttachments")
      .withIndex("by_message", (q) => q.eq("messageId", message._id))
      .order("asc")
      .collect(),
    messageFacetRows(ctx, message._id),
  ]);

  return {
    ...message,
    attachments: await Promise.all(
      attachments.map(async (attachment) => ({
        storageId: attachment.storageId,
        kind: attachment.kind,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        ...(attachment.width !== undefined ? { width: attachment.width } : {}),
        ...(attachment.height !== undefined
          ? { height: attachment.height }
          : {}),
        ...(attachment.durationMs !== undefined
          ? { durationMs: attachment.durationMs }
          : {}),
        url: await ctx.storage.getUrl(attachment.storageId),
      })),
    ),
    labels: facets
      .flatMap((facet) => {
        const name = labelNameFromFacet(facet.facet);
        return name === undefined ? [] : [{ name, source: facet.source }];
      })
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

/**
 * Return the active account's messages newest first for realtime pagination,
 * optionally only those carrying one facet ("type:pdf", "label:todo").
 */
export const listMessages = query({
  args: {
    paginationOpts: paginationOptsValidator,
    facet: v.optional(v.string()),
  },
  returns: paginationResultValidator(messageValidator),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const facet = args.facet;

    if (facet === undefined) {
      const page = await ctx.db
        .query("messages")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .order("desc")
        .paginate(args.paginationOpts);
      return {
        ...page,
        page: await Promise.all(
          page.page.map((message) => withDetails(ctx, message)),
        ),
      };
    }

    const page = await ctx.db
      .query("messageFacets")
      .withIndex("by_user_facet_time", (q) =>
        q.eq("userId", userId).eq("facet", facet),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    const messages = await Promise.all(
      page.page.map(async (row) => {
        const message = await ctx.db.get(row.messageId);
        return message === null ? null : await withDetails(ctx, message);
      }),
    );
    return {
      ...page,
      page: messages.filter((message) => message !== null),
    };
  },
});

/** Create a short-lived Convex Storage upload URL for an authenticated user. */
export const createUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireUserId(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Create one text message, one attachment message, or a message containing
 * both. Uploaded files are checked against Convex's authoritative metadata
 * before their IDs are persisted.
 */
export const sendMessage = mutation({
  args: {
    text: v.optional(v.string()),
    attachments: emptyAttachmentsValidator,
    labels: v.optional(v.array(v.string())),
  },
  returns: v.id("messages"),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const text = args.text?.trim();
    const attachments = args.attachments ?? [];

    if ((text === undefined || text.length === 0) && attachments.length === 0) {
      throw new Error("A message needs text or an attachment");
    }

    if (text !== undefined && text.length > MAX_TEXT_LENGTH) {
      throw new Error("Message text is too long");
    }

    if (attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      throw new Error("Too many attachments");
    }

    const seenStorageIds = new Set<string>();
    const preparedAttachments: PreparedAttachment[] = [];
    let totalSizeBytes = 0;

    for (const attachment of attachments) {
      if (seenStorageIds.has(attachment.storageId)) {
        invalidAttachment("duplicate file");
      }
      seenStorageIds.add(attachment.storageId);

      const prepared = await prepareAttachment(ctx, attachment);
      totalSizeBytes += prepared.sizeBytes;

      if (totalSizeBytes > MAX_MESSAGE_SIZE_BYTES) {
        throw new Error("Combined attachment size is too large");
      }

      preparedAttachments.push(prepared);
    }

    const messageId = await ctx.db.insert("messages", {
      userId,
      ...(text !== undefined && text.length > 0 ? { text } : {}),
    });

    for (const attachment of preparedAttachments) {
      await ctx.db.insert("messageAttachments", {
        userId,
        messageId,
        ...attachment,
      });
    }

    const message = await ctx.db.get(messageId);
    if (message !== null) {
      await indexMessage(ctx, message, preparedAttachments, args.labels);
    }

    return messageId;
  },
});

/** Delete an account-owned message and the files attached to it. */
export const deleteMessage = mutation({
  args: {
    messageId: v.id("messages"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const message = await ctx.db.get(args.messageId);

    if (message === null || message.userId !== userId) {
      throw new Error("Message not found");
    }

    const attachments = await ctx.db
      .query("messageAttachments")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .collect();

    for (const attachment of attachments) {
      await ctx.storage.delete(attachment.storageId);
      await ctx.db.delete(attachment._id);
    }

    await deleteMessageFacets(ctx, message);
    await ctx.db.delete(args.messageId);
    return null;
  },
});
