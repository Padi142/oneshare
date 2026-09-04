import { useEffect, useRef, useState } from "react";
import { MoreIcon, SearchIcon, UserIcon, XIcon } from "../lib/icons";

interface ChatHeaderProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onSignOut: () => Promise<void>;
}

export function ChatHeader({
  searchQuery,
  onSearchChange,
  onSignOut,
}: ChatHeaderProps) {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

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
        return;
      }
      if (event.key === "Escape") {
        setIsAccountOpen(false);
        setIsSearchOpen(false);
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
  }, []);

  async function handleSignOut() {
    setIsAccountOpen(false);
    await onSignOut();
  }

  return (
    <header className="chat-header">
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
        </div>
      </div>
    </header>
  );
}
