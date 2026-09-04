import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const messageKindValidator = v.union(
  v.literal("file"),
  v.literal("image"),
  v.literal("video"),
);

/**
 * Attachments are separate documents so storage ownership and cleanup can be
 * indexed without scanning every message in an account.
 */
const schema = defineSchema({
  ...authTables,
  messages: defineTable({
    userId: v.id("users"),
    text: v.optional(v.string()),
  }).index("by_user", ["userId"]),
  messageAttachments: defineTable({
    userId: v.id("users"),
    messageId: v.id("messages"),
    storageId: v.id("_storage"),
    kind: messageKindValidator,
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    durationMs: v.optional(v.number()),
  })
    .index("by_message", ["messageId"])
    .index("by_storage", ["storageId"])
    .index("by_user", ["userId"]),
});

export default schema;
