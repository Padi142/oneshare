import { useEffect, useRef } from "react";
import { GridIcon } from "../lib/icons";
import {
  isSameFilter,
  labelHue,
  TYPE_FILTERS,
  type Filter,
} from "../lib/facets";
import type { TypeFacet } from "../../convex/lib/facets";

interface FilterBarProps {
  filter: Filter;
  types: TypeFacet[];
  labels: string[];
  onChange: (filter: Filter) => void;
}

export function FilterBar({ filter, types, labels, onChange }: FilterBarProps) {
  const barRef = useRef<HTMLDivElement>(null);

  // Keep the active label visible even after its last message loses it.
  const labelNames =
    filter.kind === "label" && !labels.includes(filter.name)
      ? [...labels, filter.name]
      : labels;
  const typeNames =
    filter.kind === "type" && !types.includes(filter.type)
      ? [...types, filter.type]
      : types;

  useEffect(() => {
    barRef.current
      ?.querySelector<HTMLElement>("[aria-pressed='true']")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [filter]);

  function chip(
    target: Filter,
    key: string,
    content: React.ReactNode,
    extraClass = "",
    style?: React.CSSProperties,
  ) {
    const active = isSameFilter(filter, target);
    return (
      <button
        key={key}
        type="button"
        className={`filter-chip ${extraClass}`}
        aria-pressed={active}
        style={style}
        onClick={() => onChange(active ? { kind: "all" } : target)}
      >
        {content}
      </button>
    );
  }

  return (
    <nav className="filter-bar" aria-label="Filter messages">
      <div className="filter-bar-inner" ref={barRef}>
        {chip(
          { kind: "all" },
          "all",
          <>
            <GridIcon size={15} />
            <span>All</span>
          </>,
        )}
        {typeNames.map((type) => {
          const { title, Icon } = TYPE_FILTERS[type];
          return chip(
            { kind: "type", type },
            `type:${type}`,
            <>
              <Icon size={15} />
              <span>{title}</span>
            </>,
          );
        })}
        {labelNames.length > 0 ? (
          <span className="filter-divider" aria-hidden="true" />
        ) : null}
        {labelNames.map((name) =>
          chip(
            { kind: "label", name },
            `label:${name}`,
            <>
              <span className="label-dot" aria-hidden="true" />
              <span>{name}</span>
            </>,
            "filter-chip--label",
            { "--label-hue": labelHue(name) } as React.CSSProperties,
          ),
        )}
      </div>
    </nav>
  );
}
