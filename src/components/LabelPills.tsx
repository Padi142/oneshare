import { SparkIcon } from "../lib/icons";
import { labelHue } from "../lib/facets";
import type { MessageLabel } from "../types";

interface LabelPillsProps {
  labels: MessageLabel[];
  onSelect: (name: string) => void;
}

/** Clickable labels on a message; automatic ones are marked with a spark. */
export function LabelPills({ labels, onSelect }: LabelPillsProps) {
  if (labels.length === 0) return null;
  return (
    <span className="label-pills">
      {labels.map((label) => (
        <button
          key={label.name}
          type="button"
          className={`label-pill ${label.source === "ai" ? "label-pill--ai" : ""}`}
          style={{ "--label-hue": labelHue(label.name) } as React.CSSProperties}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(label.name);
          }}
          title={
            label.source === "ai"
              ? `Suggested label: ${label.name}. Show all`
              : `Show all #${label.name}`
          }
        >
          {label.source === "ai" ? (
            <SparkIcon size={10} />
          ) : (
            <span className="label-dot" aria-hidden="true" />
          )}
          {label.name}
        </button>
      ))}
    </span>
  );
}
