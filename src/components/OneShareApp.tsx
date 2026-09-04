import { useAuthActions } from "@convex-dev/auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatHeader } from "./ChatHeader";
import { Composer } from "./Composer";
import { DeleteDialog } from "./DeleteDialog";
import { MessageList } from "./MessageList";
import { ArrowDownIcon } from "../lib/icons";
import { useChat, type LocalMessage } from "../hooks/useChat";

export function OneShareApp() {
  const { signOut } = useAuthActions();
  const chat = useChat();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const hasInitialScroll = useRef(false);
  const previousMessageCount = useRef(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [showJumpButton, setShowJumpButton] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<LocalMessage>();
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();

  useEffect(
    () =>
      window.desktopBridge?.onMenuAction((action) => {
        if (action === "new-message") {
          document
            .querySelector<HTMLTextAreaElement>(".composer-textarea")
            ?.focus();
        }
      }),
    [],
  );

  const isAtBottom = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return true;
    return (
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 84
    );
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior });
    setShowJumpButton(false);
    setNewMessageCount(0);
  }, []);

  useEffect(() => {
    if (chat.messages.length === 0) return;
    if (!hasInitialScroll.current) {
      hasInitialScroll.current = true;
      requestAnimationFrame(() => scrollToBottom("auto"));
      previousMessageCount.current = chat.messages.length;
      return;
    }
    if (chat.messages.length > previousMessageCount.current) {
      if (isAtBottom()) requestAnimationFrame(() => scrollToBottom("smooth"));
      else {
        setShowJumpButton(true);
        setNewMessageCount(
          (count) =>
            count + (chat.messages.length - previousMessageCount.current),
        );
      }
    }
    previousMessageCount.current = chat.messages.length;
  }, [chat.messages.length, isAtBottom, scrollToBottom]);

  function handleScroll() {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    if (scroller.scrollTop < 96 && chat.paginationStatus === "CanLoadMore")
      chat.loadMore(32);
    if (isAtBottom()) {
      setShowJumpButton(false);
      setNewMessageCount(0);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError(undefined);
    try {
      await chat.deleteMessage(deleteTarget._id);
      setDeleteTarget(undefined);
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : "Couldn't delete that message.",
      );
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="app-shell">
      <ChatHeader
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onSignOut={signOut}
      />
      <main className="chat-main">
        <div className="chat-context" aria-hidden="true">
          <span>
            <i className="status-dot" /> Live relay
          </span>
          <span>Everything here belongs to you</span>
        </div>
        <MessageList
          messages={chat.messages}
          isLoading={chat.isLoading}
          searchQuery={searchQuery}
          paginationStatus={chat.paginationStatus}
          onLoadMore={() => chat.loadMore(32)}
          onScroll={handleScroll}
          scrollerRef={scrollerRef}
          onRequestDelete={setDeleteTarget}
        />
        {showJumpButton ? (
          <button
            className="jump-button"
            type="button"
            onClick={() => scrollToBottom()}
            aria-label={`Jump to latest${newMessageCount ? `, ${newMessageCount} new messages` : ""}`}
          >
            <ArrowDownIcon size={16} />
            <span>
              {newMessageCount > 0 ? `${newMessageCount} new` : "Latest"}
            </span>
          </button>
        ) : null}
        <Composer
          onSendMessage={chat.sendMessage}
          onUploadFile={chat.uploadFile}
        />
      </main>
      {deleteTarget ? (
        <DeleteDialog
          message={deleteTarget}
          isDeleting={isDeleting}
          onCancel={() => {
            if (!isDeleting) setDeleteTarget(undefined);
          }}
          onConfirm={confirmDelete}
        />
      ) : null}
      {deleteError ? (
        <div className="toast-error" role="alert">
          {deleteError}
          <button
            type="button"
            className="icon-button"
            onClick={() => setDeleteError(undefined)}
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}
