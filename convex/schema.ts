import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const messageKindValidator = v.union(
  v.literal("file"),
  v.literal("image"),
  v.literal("video"),
);

const facetSourceValidator = v.union(
  v.literal("system"),
  v.literal("user"),
  v.literal("ai"),
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
  /** Labels exist while at least one message uses them. */
  labels: defineTable({
    userId: v.id("users"),
    name: v.string(),
    // Explains the label to a future automatic classifier.
    description: v.optional(v.string()),
  }).index("by_user_name", ["userId", "name"]),
  /**
   * One row per filterable property of a message ("type:pdf", "label:todo"),
   * so every filter paginates straight off an index. The message's creation
   * time is copied in so a filtered list sorts by message, not tagging, time.
   */
  messageFacets: defineTable({
    userId: v.id("users"),
    messageId: v.id("messages"),
    facet: v.string(),
    messageCreationTime: v.number(),
    source: facetSourceValidator,
    confidence: v.optional(v.number()),
  })
    .index("by_user_facet_time", ["userId", "facet", "messageCreationTime"])
    .index("by_message", ["messageId"]),
});

export default schema;
