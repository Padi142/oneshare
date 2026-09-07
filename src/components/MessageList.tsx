import type { RefObject, UIEvent } from "react";
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
  return (
    <div className="empty-messages">
      <span className="empty-ornament" aria-hidden="true">
        os
      </span>
      <p className="kicker">{hasSearch ? "Nothing found" : "A clean slate"}</p>
      <h2>{hasSearch ? "No messages match." : "Send something useful."}</h2>
      <p>
        {hasSearch
          ? "Try a different word or file name."
          : "Links, notes, photos — keep the little things moving."}
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
              : "Load earlier messages"}
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
                <div className="date-divider">
                  <span>{formatDate(message._creationTime)}</span>
                </div>
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
