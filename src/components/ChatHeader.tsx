import { useEffect, useRef, useState } from "react";
import {
  ChevronDownIcon,
  MoreIcon,
  SearchIcon,
  SelectIcon,
  TrashIcon,
  UserIcon,
  XIcon,
} from "../lib/icons";

interface ChatHeaderProps {
  isSelectionMode: boolean;
  selectedMessageCount: number;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onStartSelection: () => void;
  onCancelSelection: () => void;
  onDeleteSelected: () => void;
  onSignOut: () => Promise<void>;
}

export function ChatHeader({
  isSelectionMode,
  selectedMessageCount,
  searchQuery,
  onSearchChange,
  onStartSelection,
  onCancelSelection,
  onDeleteSelected,
  onSignOut,
}: ChatHeaderProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isSearchOpen) searchRef.current?.focus();
  }, [isSearchOpen]);

  useEffect(() => {
    if (isSelectionMode) setIsExpanded(true);
  }, [isSelectionMode]);

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
        return;
      }
      if (event.key === "Escape") {
        setIsAccountOpen(false);
        setIsSearchOpen(false);
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

  async function handleSignOut() {
    setIsAccountOpen(false);
    await onSignOut();
  }

  function toggleHeader() {
    const nextExpanded = !isExpanded;
    setIsExpanded(nextExpanded);
    if (!nextExpanded) {
      setIsAccountOpen(false);
      setIsSearchOpen(false);
    }
  }

  return (
    <header
      className={`chat-header ${isExpanded ? "chat-header--expanded" : "chat-header--collapsed"} ${isSelectionMode ? "chat-header--selection" : ""}`}
    >
      <div className="chat-header-inner">
        <div className="chat-heading">
          <span className="brand-mark" aria-hidden="true">
            os
          </span>
          <div>
            <p className="eyebrow">ONE / SHARE</p>
            <h1>Saved messages</h1>
          </div>
        </div>
        <div className="chat-header-actions">
          {isSelectionMode ? (
            <div className="selection-toolbar">
              <span className="selection-count" aria-live="polite">
                {selectedMessageCount} selected
              </span>
              <button
                type="button"
                className="icon-button"
                onClick={onCancelSelection}
                aria-label="Cancel message selection"
                title="Cancel selection"
              >
                <XIcon size={18} />
              </button>
              <button
                type="button"
                className="selection-delete-button"
                onClick={onDeleteSelected}
                disabled={selectedMessageCount === 0}
              >
                <TrashIcon size={16} />
                <span>Delete</span>
              </button>
            </div>
          ) : isExpanded ? (
            <>
              <button
                type="button"
                className="header-action"
                onClick={onStartSelection}
                aria-label="Select messages"
                title="Select messages"
              >
                <SelectIcon size={17} />
                <span className="header-action-label">Select</span>
              </button>
              {isSearchOpen ? (
                <label className="search-field">
                  <SearchIcon size={17} />
                  <span className="sr-only">Search messages</span>
                  <input
                    ref={searchRef}
                    value={searchQuery}
                    onChange={(event) => onSearchChange(event.target.value)}
                    placeholder="Search messages"
                  />
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => {
                      onSearchChange("");
                      setIsSearchOpen(false);
                    }}
                    aria-label="Close search"
                  >
                    <XIcon size={16} />
                  </button>
                </label>
              ) : (
                <button
                  type="button"
                  className="icon-button header-icon"
                  onClick={() => setIsSearchOpen(true)}
                  aria-label="Search messages"
                  title="Search messages"
                >
                  <SearchIcon size={20} />
                </button>
              )}
              <div className="account-wrap" ref={accountRef}>
                <button
                  type="button"
                  className={`account-button ${isAccountOpen ? "account-button--active" : ""}`}
                  onClick={() => setIsAccountOpen((open) => !open)}
                  aria-expanded={isAccountOpen}
                  aria-haspopup="menu"
                  aria-label="Open account menu"
                >
                  <span className="account-avatar">
                    <UserIcon size={17} />
                  </span>
                  <span className="account-label">Account</span>
                  <MoreIcon size={17} />
                </button>
                {isAccountOpen ? (
                  <div className="account-menu" role="menu">
                    <div className="account-menu-head">
                      <span className="status-dot" />
                      <span>Private relay</span>
                    </div>
                    <p>Messages sync whenever this account is signed in.</p>
                    <button
                      type="button"
                      className="menu-action"
                      role="menuitem"
                      onClick={() => void handleSignOut()}
                    >
                      Sign out
                    </button>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
          <button
            type="button"
            className="icon-button header-toggle"
            onClick={toggleHeader}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? "Collapse header" : "Expand header"}
            title={isExpanded ? "Collapse header" : "Expand header"}
          >
            <ChevronDownIcon size={18} />
          </button>
        </div>
      </div>
    </header>
  );
}
