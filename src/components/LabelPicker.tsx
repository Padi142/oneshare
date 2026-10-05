import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, PlusIcon } from "../lib/icons";
import { labelHue, normalizeLabel } from "../lib/facets";

export type LabelState = "all" | "some" | "none";

interface LabelPickerProps {
  anchorRef: RefObject<HTMLElement | null>;
  labels: string[];
  stateOf: (name: string) => LabelState;
  onToggle: (name: string, applied: boolean) => void;
  onClose: () => void;
}

const PICKER_WIDTH = 240;
const PICKER_MAX_HEIGHT = 320;
const GAP = 6;

/**
 * Checklist of labels with an inline "create" row. It is portalled with fixed
 * positioning so it escapes the hover-only action bar and the scroller.
 */
export function LabelPicker({
  anchorRef,
  labels,
  stateOf,
  onToggle,
  onClose,
}: LabelPickerProps) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<{ top: number; left: number }>();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const opensUp =
      window.innerHeight - rect.bottom < PICKER_MAX_HEIGHT + GAP &&
      rect.top > window.innerHeight - rect.bottom;
    const panelHeight = panelRef.current?.offsetHeight ?? PICKER_MAX_HEIGHT;
    setPosition({
      top: opensUp ? rect.top - GAP - panelHeight : rect.bottom + GAP,
      left: Math.min(
        Math.max(8, rect.right - PICKER_WIDTH),
        window.innerWidth - PICKER_WIDTH - 8,
      ),
    });
  }, [anchorRef, labels.length]);

  useLayoutEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (
        !panelRef.current?.contains(target) &&
        !anchorRef.current?.contains(target)
      )
        onCloseRef.current();
    }
    function handleScroll(event: Event) {
      if (!panelRef.current?.contains(event.target as Node))
        onCloseRef.current();
    }
    function handleResize() {
      onCloseRef.current();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
    };
  }, [anchorRef]);

  const typed = query.trim().toLocaleLowerCase().replace(/^#/u, "");
  const newLabel = normalizeLabel(typed);
  const visible = labels.filter((name) => name.includes(typed));
  const canCreate = newLabel !== undefined && !labels.includes(newLabel);

  function submit() {
    if (newLabel === undefined) return;
    onToggle(newLabel, stateOf(newLabel) !== "all");
    setQuery("");
  }

  return createPortal(
    <div
      ref={panelRef}
      className="label-picker"
      role="dialog"
      aria-label="Labels"
      style={{
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        width: PICKER_WIDTH,
        maxHeight: PICKER_MAX_HEIGHT,
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <input
        className="label-picker-input"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
        placeholder="Find or create a label"
        aria-label="Find or create a label"
        autoFocus
      />
      <ul className="label-picker-list">
        {visible.map((name) => {
          const state = stateOf(name);
          return (
            <li key={name}>
              <button
                type="button"
                className="label-picker-item"
                aria-pressed={
                  state === "all" ? true : state === "some" ? "mixed" : false
                }
                onClick={() => onToggle(name, state !== "all")}
              >
                <span
                  className={`label-picker-check label-picker-check--${state}`}
                  aria-hidden="true"
                >
                  {state === "all" ? (
                    <CheckIcon size={12} strokeWidth={2.8} />
                  ) : state === "some" ? (
                    <span className="label-picker-dash" />
                  ) : null}
                </span>
                <span
                  className="label-dot"
                  style={
                    { "--label-hue": labelHue(name) } as React.CSSProperties
                  }
                  aria-hidden="true"
                />
                <span className="label-picker-name">{name}</span>
              </button>
            </li>
          );
        })}
        {canCreate ? (
          <li>
            <button
              type="button"
              className="label-picker-item label-picker-create"
              onClick={submit}
            >
              <PlusIcon size={14} />
              <span className="label-picker-name">
                Create <strong>#{newLabel}</strong>
              </span>
            </button>
          </li>
        ) : null}
        {visible.length === 0 && !canCreate ? (
          <li className="label-picker-empty">
            {typed
              ? "Use letters, numbers, - or _"
              : "Type a name to create your first label"}
          </li>
        ) : null}
      </ul>
    </div>,
    document.body,
  );
}
