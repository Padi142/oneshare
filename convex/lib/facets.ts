/**
 * A facet is one filterable property of a message. Type facets are derived
 * from the content when a message is sent; label facets come from #hashtags,
 * manual tagging and (later) automatic classification.
 *
 * This module has no Convex imports so the renderer can share it.
 */

export const TYPE_FACETS = [
  "image",
  "video",
  "file",
  "pdf",
  "apk",
  "link",
] as const;

export type TypeFacet = (typeof TYPE_FACETS)[number];

export const MAX_LABEL_LENGTH = 32;
export const MAX_LABELS_PER_MESSAGE = 20;

const LABEL_CHARACTERS = "\\p{L}\\p{N}_-";
const LABEL_PATTERN = new RegExp(
  `^[${LABEL_CHARACTERS}]{1,${MAX_LABEL_LENGTH}}$`,
  "u",
);

/**
 * Matches `#tag` at the start of the text or after whitespace or an opening
 * bracket, so URL fragments like `page#section` are not treated as tags.
 */
export const HASHTAG_PATTERN = new RegExp(
  `(^|[\\s([{])#([${LABEL_CHARACTERS}]{1,${MAX_LABEL_LENGTH}})(?![${LABEL_CHARACTERS}])`,
  "gu",
);

export function typeFacet(type: TypeFacet): string {
  return `type:${type}`;
}

export function labelFacet(name: string): string {
  return `label:${name}`;
}

/** Lowercase and validate a label name, or return undefined if it can't be one. */
export function normalizeLabel(name: string): string | undefined {
  const normalized = name.normalize("NFKC").trim().replace(/^#/u, "");
  const lower = normalized.toLocaleLowerCase();
  return LABEL_PATTERN.test(lower) ? lower : undefined;
}

export function hashtagsIn(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(HASHTAG_PATTERN)) {
    const name = normalizeLabel(match[2]);
    if (name !== undefined) names.add(name);
  }
  return [...names];
}

const URL_PATTERN = /https?:\/\/[^\s<>"']+/u;

type FacetAttachment = {
  kind: "file" | "image" | "video";
  fileName: string;
  mimeType: string;
};

export function typeFacetsFor(
  text: string | undefined,
  attachments: FacetAttachment[],
): TypeFacet[] {
  const types = new Set<TypeFacet>();
  for (const attachment of attachments) {
    types.add(attachment.kind);
    if (attachment.kind !== "file") continue;
    const name = attachment.fileName.toLowerCase();
    if (attachment.mimeType === "application/pdf" || name.endsWith(".pdf")) {
      types.add("pdf");
    }
    if (
      attachment.mimeType === "application/vnd.android.package-archive" ||
      name.endsWith(".apk")
    ) {
      types.add("apk");
    }
  }
  if (text !== undefined && URL_PATTERN.test(text)) types.add("link");
  return TYPE_FACETS.filter((type) => types.has(type));
}
