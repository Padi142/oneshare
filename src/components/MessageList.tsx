import type { ReactNode, RefObject, UIEvent } from "react";
import { BrandMark } from "./BrandMark";
import { LabelPills } from "./LabelPills";
import {
  AttachmentDownloadButton,
  AttachmentVisual,
  FileStatusIcon,
  fileDetail,
  MessageBubble,
} from "./MessageBubble";
import { CheckIcon } from "../lib/icons";
import type { MessageView } from "../lib/facets";
import {
  formatDate,
  formatTime,
  isSameDate,
  matchesSearch,
} from "../lib/utils";
import type { LocalMessage } from "../hooks/useChat";
import { useLocalFile } from "../hooks/useLocalFile";
import type { MessageAttachment } from "../types";

interface MessageListProps {
  messages: LocalMessage[];
  isLoading: boolean;
  isSelectionMode: boolean;
  selectedMessageIds: ReadonlySet<string>;
  searchQuery: string;
  view: MessageView;
  emptyState?: { title: string; body: string };
  allLabels: string[];
  paginationStatus:
    "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";
  onLoadMore: () => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  scrollerRef: RefObject<HTMLDivElement | null>;
  onStartSelection: (messageId: string) => void;
  onToggleSelect: (messageId: string) => void;
  onRequestDelete: (message: LocalMessage) => void;
  onSetLabel: (messageIds: string[], name: string, applied: boolean) => void;
  onSelectLabel: (name: string) => void;
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

function EmptyMessages({
  hasSearch,
  emptyState,
}: {
  hasSearch: boolean;
  emptyState?: { title: string; body: string };
}) {
  if (hasSearch) {
    return (
      <div className="empty-messages">
        <h2>No matches</h2>
        <p>Try another word or part of a file name.</p>
      </div>
    );
  }
  if (emptyState) {
    return (
      <div className="empty-messages">
        <h2>{emptyState.title}</h2>
        <p>{emptyState.body}</p>
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

interface ViewItemProps {
  message: LocalMessage;
  attachment: MessageAttachment;
  isSelectionMode: boolean;
  isSelected: boolean;
  onToggleSelect: (messageId: string) => void;
}

function SelectOverlay({
  messageId,
  isSelected,
  onToggleSelect,
}: {
  messageId: string;
  isSelected: boolean;
  onToggleSelect: (messageId: string) => void;
}) {
  return (
    <button
      type="button"
      className="message-select"
      onClick={() => onToggleSelect(messageId)}
      aria-pressed={isSelected}
      aria-label={isSelected ? "Deselect message" : "Select message"}
    >
      <span className="message-check" aria-hidden="true">
        {isSelected ? <CheckIcon size={14} strokeWidth={2.6} /> : null}
      </span>
    </button>
  );
}

function GridTile({
  message,
  attachment,
  isSelectionMode,
  isSelected,
  onToggleSelect,
}: ViewItemProps) {
  return (
    <div
      className={`grid-tile ${isSelected ? "grid-tile--selected" : ""}`}
      title={message.text}
    >
      <AttachmentVisual attachment={attachment} />
      {isSelectionMode ? (
        <SelectOverlay
          messageId={message._id}
          isSelected={isSelected}
          onToggleSelect={onToggleSelect}
        />
      ) : null}
    </div>
  );
}

function FileRow({
  message,
  attachment,
  isSelectionMode,
  isSelected,
  onToggleSelect,
  onSelectLabel,
}: ViewItemProps & { onSelectLabel: (name: string) => void }) {
  const localFile = useLocalFile(attachment);
  return (
    <div
      className={[
        "file-row",
        isSelectionMode ? "file-row--selecting" : "",
        isSelected ? "file-row--selected" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {isSelectionMode ? (
        <SelectOverlay
          messageId={message._id}
          isSelected={isSelected}
          onToggleSelect={onToggleSelect}
        />
      ) : null}
      <button
        type="button"
        className="file-row-open"
        onClick={localFile.open}
        disabled={!localFile.file}
        title={`Open ${attachment.fileName}`}
      >
        <FileStatusIcon attachment={attachment} state={localFile.state} />
        <span className="file-row-copy">
          <strong title={attachment.fileName}>{attachment.fileName}</strong>
          <small className={localFile.error ? "file-detail-error" : undefined}>
            {fileDetail(attachment, localFile)} ·{" "}
            {formatTime(message._creationTime)}
            {message.text ? (
              <span title={message.text}> · {message.text}</span>
            ) : null}
          </small>
        </span>
      </button>
      <LabelPills labels={message.labels ?? []} onSelect={onSelectLabel} />
      <AttachmentDownloadButton
        localFile={localFile}
        fileName={attachment.fileName}
        className="file-download"
      />
    </div>
  );
}

export function MessageList({
  messages,
  isLoading,
  isSelectionMode,
  selectedMessageIds,
  searchQuery,
  view,
  emptyState,
  allLabels,
  paginationStatus,
  onLoadMore,
  onScroll,
  scrollerRef,
  onStartSelection,
  onToggleSelect,
  onRequestDelete,
  onSetLabel,
  onSelectLabel,
}: MessageListProps) {
  const filtered = messages.filter((message) =>
    matchesSearch(message, searchQuery),
  );
  const hasSearch = Boolean(searchQuery.trim());

  // Group by day: chat rows are messages, gallery and file rows attachments.
  const groups: { day: number; items: ReactNode[] }[] = [];
  for (const message of filtered) {
    const items: ReactNode[] = [];
    if (view.kind === "chat") {
      items.push(
        <MessageBubble
          key={message._id}
          message={message}
          isSelectionMode={isSelectionMode}
          isSelected={selectedMessageIds.has(message._id)}
          allLabels={allLabels}
          onStartSelection={onStartSelection}
          onToggleSelect={onToggleSelect}
          onRequestDelete={onRequestDelete}
          onSetLabel={onSetLabel}
          onSelectLabel={onSelectLabel}
        />,
      );
    } else {
      message.attachments.forEach((attachment, index) => {
        if (!view.matches(attachment)) return;
        const props: ViewItemProps = {
          message,
          attachment,
          isSelectionMode,
          isSelected: selectedMessageIds.has(message._id),
          onToggleSelect,
        };
        const key = `${message._id}-${attachment.storageId ?? index}`;
        items.push(
          view.kind === "grid" ? (
            <GridTile key={key} {...props} />
          ) : (
            <FileRow key={key} {...props} onSelectLabel={onSelectLabel} />
          ),
        );
      });
    }
    if (items.length === 0) continue;
    const last = groups.at(-1);
    if (last && isSameDate(last.day, message._creationTime)) {
      last.items.push(...items);
    } else {
      groups.push({ day: message._creationTime, items });
    }
  }

  return (
    <div
      className="message-scroller"
      ref={scrollerRef}
      onScroll={onScroll}
      role="log"
      aria-label="Saved messages"
      aria-live="polite"
    >
      <div className={`message-column message-column--${view.kind}`}>
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
        {!isLoading && groups.length === 0 ? (
          <EmptyMessages hasSearch={hasSearch} emptyState={emptyState} />
        ) : null}
        {groups.map((group) => (
          <section key={group.day} className="message-group">
            <h3 className="date-divider">{formatDate(group.day)}</h3>
            {view.kind === "chat" ? (
              group.items
            ) : (
              <div
                className={view.kind === "grid" ? "media-grid" : "file-list"}
              >
                {group.items}
              </div>
            )}
          </section>
        ))}
        <div className="message-bottom-anchor" aria-hidden="true" />
      </div>
    </div>
  );
}
