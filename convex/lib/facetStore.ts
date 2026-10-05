import type { MutationCtx, QueryCtx } from "../_generated/server.js";
import type { Doc, Id } from "../_generated/dataModel.js";
import {
  hashtagsIn,
  labelFacet,
  MAX_LABELS_PER_MESSAGE,
  normalizeLabel,
  typeFacet,
  typeFacetsFor,
} from "./facets.js";

type FacetSource = Doc<"messageFacets">["source"];

const LABEL_PREFIX = "label:";

export function labelNameFromFacet(facet: string): string | undefined {
  return facet.startsWith(LABEL_PREFIX)
    ? facet.slice(LABEL_PREFIX.length)
    : undefined;
}

/** Normalize label names, dropping invalid ones and duplicates. */
export function normalizeLabels(names: string[]): string[] {
  const normalized = new Set<string>();
  for (const name of names) {
    const label = normalizeLabel(name);
    if (label !== undefined) normalized.add(label);
  }
  return [...normalized];
}

export async function messageFacetRows(
  ctx: QueryCtx,
  messageId: Id<"messages">,
): Promise<Doc<"messageFacets">[]> {
  return await ctx.db
    .query("messageFacets")
    .withIndex("by_message", (q) => q.eq("messageId", messageId))
    .collect();
}

export async function ensureLabel(
  ctx: MutationCtx,
  userId: Id<"users">,
  name: string,
): Promise<void> {
  const existing = await ctx.db
    .query("labels")
    .withIndex("by_user_name", (q) => q.eq("userId", userId).eq("name", name))
    .first();
  if (existing === null) await ctx.db.insert("labels", { userId, name });
}

/** Delete a label once no message carries it, so filter chips never go stale. */
export async function removeLabelIfUnused(
  ctx: MutationCtx,
  userId: Id<"users">,
  name: string,
): Promise<void> {
  const stillUsed = await ctx.db
    .query("messageFacets")
    .withIndex("by_user_facet_time", (q) =>
      q.eq("userId", userId).eq("facet", labelFacet(name)),
    )
    .first();
  if (stillUsed !== null) return;

  const label = await ctx.db
    .query("labels")
    .withIndex("by_user_name", (q) => q.eq("userId", userId).eq("name", name))
    .first();
  if (label !== null) await ctx.db.delete(label._id);
}

/** Add labels to a message, skipping ones it already has. */
export async function addLabels(
  ctx: MutationCtx,
  message: Doc<"messages">,
  names: string[],
  source: FacetSource,
): Promise<void> {
  const existing = new Set(
    (await messageFacetRows(ctx, message._id)).map((row) => row.facet),
  );
  let labelCount = [...existing].filter((facet) =>
    facet.startsWith(LABEL_PREFIX),
  ).length;

  for (const name of names) {
    const facet = labelFacet(name);
    if (existing.has(facet)) continue;
    if (labelCount >= MAX_LABELS_PER_MESSAGE) {
      throw new Error("Too many labels on one message");
    }
    await ensureLabel(ctx, message.userId, name);
    await ctx.db.insert("messageFacets", {
      userId: message.userId,
      messageId: message._id,
      facet,
      messageCreationTime: message._creationTime,
      source,
    });
    existing.add(facet);
    labelCount += 1;
  }
}

export async function removeLabel(
  ctx: MutationCtx,
  message: Doc<"messages">,
  name: string,
): Promise<void> {
  const facet = labelFacet(name);
  for (const row of await messageFacetRows(ctx, message._id)) {
    if (row.facet === facet) await ctx.db.delete(row._id);
  }
  await removeLabelIfUnused(ctx, message.userId, name);
}

/**
 * Record a new (or backfilled) message's type facets and #hashtag labels,
 * plus any labels the sender asked for explicitly.
 */
export async function indexMessage(
  ctx: MutationCtx,
  message: Doc<"messages">,
  attachments: {
    kind: "file" | "image" | "video";
    fileName: string;
    mimeType: string;
  }[],
  extraLabels: string[] = [],
): Promise<void> {
  const existing = new Set(
    (await messageFacetRows(ctx, message._id)).map((row) => row.facet),
  );
  for (const type of typeFacetsFor(message.text, attachments)) {
    const facet = typeFacet(type);
    if (existing.has(facet)) continue;
    await ctx.db.insert("messageFacets", {
      userId: message.userId,
      messageId: message._id,
      facet,
      messageCreationTime: message._creationTime,
      source: "system",
    });
  }

  const labels = normalizeLabels([
    ...hashtagsIn(message.text ?? ""),
    ...extraLabels,
  ]);
  if (labels.length > 0) await addLabels(ctx, message, labels, "user");
}

/** Remove every facet of a message that is about to be deleted. */
export async function deleteMessageFacets(
  ctx: MutationCtx,
  message: Doc<"messages">,
): Promise<void> {
  const labelNames: string[] = [];
  for (const row of await messageFacetRows(ctx, message._id)) {
    const name = labelNameFromFacet(row.facet);
    if (name !== undefined) labelNames.push(name);
    await ctx.db.delete(row._id);
  }
  for (const name of labelNames) {
    await removeLabelIfUnused(ctx, message.userId, name);
  }
}
