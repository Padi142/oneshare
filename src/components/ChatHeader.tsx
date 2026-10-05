import { useEffect, useRef, useState } from "react";
import {
  DownloadIcon,
  SearchIcon,
  SelectIcon,
  TagIcon,
  TrashIcon,
  UserIcon,
  XIcon,
} from "../lib/icons";
import { BrandMark } from "./BrandMark";
import { LabelPicker, type LabelState } from "./LabelPicker";

interface ChatHeaderProps {
  isSelectionMode: boolean;
  selectedMessageCount: number;
  selectedAttachmentCount: number;
  isDownloading: boolean;
  searchQuery: string;
  allLabels: string[];
  selectedLabelState: (name: string) => LabelState;
  onToggleSelectedLabel: (name: string, applied: boolean) => void;
  onSearchChange: (value: string) => void;
  onStartSelection: () => void;
  onCancelSelection: () => void;
  onDownloadSelected: () => void;
  onDeleteSelected: () => void;
  onSignOut: () => Promise<void>;
}

export function ChatHeader({
  isSelectionMode,
  selectedMessageCount,
  selectedAttachmentCount,
  isDownloading,
  searchQuery,
  allLabels,
  selectedLabelState,
  onToggleSelectedLabel,
  onSearchChange,
  onStartSelection,
  onCancelSelection,
  onDownloadSelected,
  onDeleteSelected,
  onSignOut,
}: ChatHeaderProps) {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const labelButtonRef = useRef<HTMLButtonElement>(null);
  const [isLabelPickerOpen, setIsLabelPickerOpen] = useState(false);

  useEffect(() => {
    if (!isSelectionMode || selectedMessageCount === 0)
      setIsLabelPickerOpen(false);
  }, [isSelectionMode, selectedMessageCount]);

  useEffect(() => {
    if (isSearchOpen) searchRef.current?.focus();
  }, [isSearchOpen]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (
        accountRef.current &&
        !accountRef.current.contains(event.target as Node)
      )
        setIsAccountOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsSearchOpen(true);
        searchRef.current?.focus();
        return;
      }
      if (event.key === "Escape") {
        setIsAccountOpen(false);
        if (isSelectionMode) onCancelSelection();
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    const removeMenuListener = window.desktopBridge?.onMenuAction((action) => {
      if (action === "focus-search") setIsSearchOpen(true);
    });
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      removeMenuListener?.();
    };
  }, [isSelectionMode, onCancelSelection]);

  function closeSearch() {
    onSearchChange("");
    setIsSearchOpen(false);
  }

  async function handleSignOut() {
    setIsAccountOpen(false);
    await onSignOut();
  }

  if (isSelectionMode) {
    return (
      <header className="chat-header chat-header--selection">
        <div className="chat-header-inner">
          <div className="header-start">
            <button
              type="button"
              className="icon-button"
              onClick={onCancelSelection}
              aria-label="Cancel selection"
              title="Cancel selection (Esc)"
            >
              <XIcon size={20} />
            </button>
            <span className="selection-count" aria-live="polite">
              {selectedMessageCount === 0
                ? "Select messages"
                : `${selectedMessageCount} selected`}
            </span>
          </div>
          <div className="header-actions">
            <button
              ref={labelButtonRef}
              type="button"
              className="header-button"
              onClick={() => setIsLabelPickerOpen((open) => !open)}
              disabled={selectedMessageCount === 0}
              aria-expanded={isLabelPickerOpen}
            >
              <TagIcon size={17} />
              <span className="header-button-label">Label</span>
            </button>
            {isLabelPickerOpen ? (
              <LabelPicker
                anchorRef={labelButtonRef}
                labels={allLabels}
                stateOf={selectedLabelState}
                onToggle={onToggleSelectedLabel}
                onClose={() => setIsLabelPickerOpen(false)}
              />
            ) : null}
            <button
              type="button"
              className="header-button"
              onClick={onDownloadSelected}
              disabled={selectedAttachmentCount === 0 || isDownloading}
              title={
                selectedAttachmentCount === 0
                  ? "Select a message with files to download"
                  : `Download ${selectedAttachmentCount} file${selectedAttachmentCount === 1 ? "" : "s"}`
              }
            >
              <DownloadIcon size={17} />
              <span className="header-button-label">
                {isDownloading ? "Downloading…" : "Download"}
              </span>
            </button>
            <button
              type="button"
              className="header-button header-button--danger"
              onClick={onDeleteSelected}
              disabled={selectedMessageCount === 0 || isDownloading}
            >
              <TrashIcon size={17} />
              <span className="header-button-label">Delete</span>
            </button>
          </div>
        </div>
      </header>
    );
  }

  if (isSearchOpen) {
    return (
      <header className="chat-header chat-header--search">
        <div className="chat-header-inner">
          <label className="search-field">
            <SearchIcon size={18} />
            <span className="sr-only">Search messages</span>
            <input
              ref={searchRef}
              value={searchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") closeSearch();
              }}
              placeholder="Search messages and file names"
              type="search"
            />
          </label>
          <button type="button" className="text-button" onClick={closeSearch}>
            Cancel
          </button>
        </div>
      </header>
    );
  }

  return (
    <header className="chat-header">
      <div className="chat-header-inner">
        <div className="header-start">
          <BrandMark size={24} />
          <h1 className="header-title">OneShare</h1>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="icon-button"
            onClick={() => setIsSearchOpen(true)}
            aria-label="Search messages"
            title="Search (Ctrl+K)"
          >
            <SearchIcon size={19} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={onStartSelection}
            aria-label="Select messages"
            title="Select messages"
          >
            <SelectIcon size={19} />
          </button>
          <div className="account-wrap" ref={accountRef}>
            <button
              type="button"
              className="icon-button"
              onClick={() => setIsAccountOpen((open) => !open)}
              aria-expanded={isAccountOpen}
              aria-haspopup="menu"
              aria-label="Account"
              title="Account"
            >
              <UserIcon size={19} />
            </button>
            {isAccountOpen ? (
              <div className="menu" role="menu">
                <p className="menu-note">
                  Messages sync to every device signed in to this account.
                </p>
                <button
                  type="button"
                  className="menu-item"
                  role="menuitem"
                  onClick={() => void handleSignOut()}
                >
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
