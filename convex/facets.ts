import { v } from "convex/values";

import { internal } from "./_generated/api.js";
import { internalMutation, mutation, query } from "./_generated/server.js";
import { requireUserId } from "./lib/authorization.js";
import { addLabels, indexMessage, removeLabel } from "./lib/facetStore.js";
import { normalizeLabel, TYPE_FACETS, typeFacet } from "./lib/facets.js";

const MAX_MESSAGES_PER_LABEL_CHANGE = 200;
const BACKFILL_BATCH_SIZE = 50;

/** List the filters worth offering: content types present, then labels. */
export const listFacets = query({
  args: {},
  returns: v.object({
    types: v.array(v.union(...TYPE_FACETS.map((type) => v.literal(type)))),
    labels: v.array(v.object({ name: v.string() })),
  }),
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const present = await Promise.all(
      TYPE_FACETS.map(async (type) => {
        const row = await ctx.db
          .query("messageFacets")
          .withIndex("by_user_facet_time", (q) =>
            q.eq("userId", userId).eq("facet", typeFacet(type)),
          )
          .first();
        return row === null ? [] : [type];
      }),
    );
    const labels = await ctx.db
      .query("labels")
      .withIndex("by_user_name", (q) => q.eq("userId", userId))
      .collect();

    return {
      types: present.flat(),
      labels: labels.map((label) => ({ name: label.name })),
    };
  },
});

/** Add or remove one label on one or more account-owned messages. */
export const setLabel = mutation({
  args: {
    messageIds: v.array(v.id("messages")),
    name: v.string(),
    applied: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const name = normalizeLabel(args.name);

    if (name === undefined) {
      throw new Error(
        "Labels can use letters, numbers, - and _, up to 32 characters",
      );
    }
    if (args.messageIds.length > MAX_MESSAGES_PER_LABEL_CHANGE) {
      throw new Error("Too many messages selected");
    }

    for (const messageId of args.messageIds) {
      const message = await ctx.db.get(messageId);
      if (message === null || message.userId !== userId) {
        throw new Error("Message not found");
      }
      if (args.applied) await addLabels(ctx, message, [name], "user");
      else await removeLabel(ctx, message, name);
    }
    return null;
  },
});

/**
 * Index messages sent before facets existed. Safe to run repeatedly:
 * `npx convex run facets:backfill`
 */
export const backfill = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("messages")
      .paginate({ cursor: args.cursor ?? null, numItems: BACKFILL_BATCH_SIZE });

    for (const message of page.page) {
      const attachments = await ctx.db
        .query("messageAttachments")
        .withIndex("by_message", (q) => q.eq("messageId", message._id))
        .collect();
      await indexMessage(ctx, message, attachments);
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.facets.backfill, {
        cursor: page.continueCursor,
      });
    }
    return null;
  },
});
