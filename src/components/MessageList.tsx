import type { RefObject, UIEvent } from "react";
import { BrandMark } from "./BrandMark";
import { MessageBubble } from "./MessageBubble";
import { formatDate, isSameDate, matchesSearch } from "../lib/utils";
import type { LocalMessage } from "../hooks/useChat";

interface MessageListProps {
  messages: LocalMessage[];
  isLoading: boolean;
  isSelectionMode: boolean;
  selectedMessageIds: ReadonlySet<string>;
  searchQuery: string;
  paginationStatus:
    "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";
  onLoadMore: () => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  scrollerRef: RefObject<HTMLDivElement | null>;
  onStartSelection: (messageId: string) => void;
  onToggleSelect: (messageId: string) => void;
  onRequestDelete: (message: LocalMessage) => void;
}

function LoadingMessages() {
  return (
    <div className="loading-messages" aria-label="Loading messages">
      <span className="message-skeleton message-skeleton--short" />
      <span className="message-skeleton message-skeleton--long" />
      <span className="message-skeleton message-skeleton--medium" />
    </div>
  );
}

function EmptyMessages({ hasSearch }: { hasSearch: boolean }) {
  if (hasSearch) {
    return (
      <div className="empty-messages">
        <h2>No matches</h2>
        <p>Try another word or part of a file name.</p>
      </div>
    );
  }
  return (
    <div className="empty-messages">
      <BrandMark size={40} className="empty-mark" />
      <h2>Nothing here yet</h2>
      <p>
        Type a note, paste a link or drop a file below. It shows up on every
        device you sign in to.
      </p>
    </div>
  );
}

export function MessageList({
  messages,
  isLoading,
  isSelectionMode,
  selectedMessageIds,
  searchQuery,
  paginationStatus,
  onLoadMore,
  onScroll,
  scrollerRef,
  onStartSelection,
  onToggleSelect,
  onRequestDelete,
}: MessageListProps) {
  const filtered = messages.filter((message) =>
    matchesSearch(message, searchQuery),
  );
  const hasSearch = Boolean(searchQuery.trim());

  return (
    <div
      className="message-scroller"
      ref={scrollerRef}
      onScroll={onScroll}
      role="log"
      aria-label="Saved messages"
      aria-live="polite"
    >
      <div className="message-column">
        {paginationStatus === "CanLoadMore" ||
        paginationStatus === "LoadingMore" ? (
          <button
            className="load-earlier"
            type="button"
            onClick={onLoadMore}
            disabled={paginationStatus === "LoadingMore"}
          >
            {paginationStatus === "LoadingMore"
              ? "Loading earlier…"
              : "Show earlier messages"}
          </button>
        ) : null}
        {isLoading && messages.length === 0 ? <LoadingMessages /> : null}
        {!isLoading && filtered.length === 0 ? (
          <EmptyMessages hasSearch={hasSearch} />
        ) : null}
        {filtered.map((message, index) => {
          const previous = filtered[index - 1];
          const showDate =
            !previous ||
            !isSameDate(previous._creationTime, message._creationTime);
          return (
            <div key={message._id} className="message-group">
              {showDate ? (
                <h3 className="date-divider">
                  {formatDate(message._creationTime)}
                </h3>
              ) : null}
              <MessageBubble
                message={message}
                isSelectionMode={isSelectionMode}
                isSelected={selectedMessageIds.has(message._id)}
                onStartSelection={onStartSelection}
                onToggleSelect={onToggleSelect}
                onRequestDelete={onRequestDelete}
              />
            </div>
          );
        })}
        <div className="message-bottom-anchor" aria-hidden="true" />
      </div>
    </div>
  );
}
