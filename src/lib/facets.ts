import type { ComponentType } from "react";
import {
  FileIcon,
  ImageIcon,
  LinkIcon,
  PackageIcon,
  PdfIcon,
  VideoIcon,
} from "./icons";
import {
  labelFacet,
  typeFacetsFor,
  type TypeFacet,
} from "../../convex/lib/facets";
import type { MessageAttachment } from "../types";

export {
  hashtagsIn,
  HASHTAG_PATTERN,
  labelFacet,
  normalizeLabel,
  typeFacet,
} from "../../convex/lib/facets";

type IconComponent = ComponentType<{ size?: number }>;

export const TYPE_FILTERS: Record<
  TypeFacet,
  { title: string; empty: string; Icon: IconComponent }
> = {
  image: { title: "Images", empty: "No images yet", Icon: ImageIcon },
  video: { title: "Videos", empty: "No videos yet", Icon: VideoIcon },
  file: { title: "Files", empty: "No files yet", Icon: FileIcon },
  pdf: { title: "PDFs", empty: "No PDFs yet", Icon: PdfIcon },
  apk: { title: "APKs", empty: "No APKs yet", Icon: PackageIcon },
  link: { title: "Links", empty: "No links yet", Icon: LinkIcon },
};

/** The active filter: everything, one content type, or one label. */
export type Filter =
  | { kind: "all" }
  | { kind: "type"; type: TypeFacet }
  | { kind: "label"; name: string };

export function facetForFilter(filter: Filter): string | undefined {
  if (filter.kind === "type") return `type:${filter.type}`;
  if (filter.kind === "label") return labelFacet(filter.name);
  return undefined;
}

export function isSameFilter(left: Filter, right: Filter): boolean {
  return facetForFilter(left) === facetForFilter(right);
}

export type MessageView =
  | { kind: "chat" }
  | { kind: "grid"; matches: (attachment: MessageAttachment) => boolean }
  | { kind: "files"; matches: (attachment: MessageAttachment) => boolean };

/** Media filters read best as a gallery and file filters as a list. */
export function viewForFilter(filter: Filter): MessageView {
  if (filter.kind !== "type" || filter.type === "link") return { kind: "chat" };
  const type = filter.type;
  const matches = (attachment: MessageAttachment) =>
    typeFacetsFor(undefined, [attachment]).includes(type);
  return type === "image" || type === "video"
    ? { kind: "grid", matches }
    : { kind: "files", matches };
}

/** A stable hue per label name so a label keeps its color on every device. */
export function labelHue(name: string): number {
  // FNV-1a spreads similar names apart; the golden angle spreads the hues.
  let hash = 0x811c9dc5;
  for (const character of name) {
    hash = Math.imul(hash ^ character.codePointAt(0)!, 0x01000193);
  }
  return Math.round(((hash >>> 0) % 64) * 137.508) % 360;
}

/** File-card icon: specific for PDFs and APKs, generic otherwise. */
export function fileIconFor(attachment: MessageAttachment): IconComponent {
  const types = typeFacetsFor(undefined, [attachment]);
  if (types.includes("pdf")) return PdfIcon;
  if (types.includes("apk")) return PackageIcon;
  return FileIcon;
}
