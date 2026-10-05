import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { ChatHeader } from "./ChatHeader";
import { Composer } from "./Composer";
import { DeleteDialog } from "./DeleteDialog";
import { FilterBar } from "./FilterBar";
import type { LabelState } from "./LabelPicker";
import { MessageList } from "./MessageList";
import { ArrowDownIcon, XIcon } from "../lib/icons";
import { useChat, type LocalMessage } from "../hooks/useChat";
import { downloadFiles, type DownloadFile } from "../lib/download";
import {
  facetForFilter,
  TYPE_FILTERS,
  viewForFilter,
  type Filter,
} from "../lib/facets";

function emptyStateFor(filter: Filter) {
  if (filter.kind === "type") {
    return {
      title: TYPE_FILTERS[filter.type].empty,
      body: "They show up here as soon as you send one.",
    };
  }
  if (filter.kind === "label") {
    return {
      title: `Nothing labelled #${filter.name}`,
      body: `Write #${filter.name} in a message, or use the tag button on any message.`,
    };
  }
  return undefined;
}

function Toast({
  tone,
  message,
  onDismiss,
}: {
  tone: "notice" | "error";
  message: string;
  onDismiss: () => void;
}) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (tone !== "notice") return;
    const timeout = window.setTimeout(() => dismissRef.current(), 4000);
    return () => window.clearTimeout(timeout);
  }, [tone, message]);

  return (
    <div
      className={`toast toast--${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <span>{message}</span>
      <button
        type="button"
        className="icon-button"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        <XIcon size={16} />
      </button>
    </div>
  );
}

export function OneShareApp() {
  const { signOut } = useAuthActions();
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const facet = facetForFilter(filter);
  const chat = useChat(facet);
  const facets = useQuery(api.facets.listFacets);
  const allLabels = useMemo(
    () => facets?.labels.map((label) => label.name) ?? [],
    [facets],
  );
  const view = useMemo(() => viewForFilter(filter), [filter]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const hasInitialScroll = useRef(false);
  const previousMessageCount = useRef(0);
  const shouldStickToBottom = useRef(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [showJumpButton, setShowJumpButton] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [deleteTargets, setDeleteTargets] = useState<LocalMessage[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadNotice, setDownloadNotice] = useState<string>();
  const [downloadError, setDownloadError] = useState<string>();
  const [labelError, setLabelError] = useState<string>();

  const selectedMessages = useMemo(
    () =>
      chat.messages.filter((message) => selectedMessageIds.has(message._id)),
    [chat.messages, selectedMessageIds],
  );

  const selectedDownloadFiles = useMemo<DownloadFile[]>(
    () =>
      selectedMessages.flatMap((message) =>
        message.attachments.flatMap((attachment) =>
          attachment.url
            ? [
                {
                  fileName: attachment.fileName,
                  mimeType: attachment.mimeType,
                  url: attachment.url,
                },
              ]
            : [],
        ),
      ),
    [selectedMessages],
  );

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
    shouldStickToBottom.current = true;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior });
    setShowJumpButton(false);
    setNewMessageCount(0);
  }, []);

  useEffect(() => {
    if (chat.isLoading || chat.messages.length === 0) return;
    const messageCount = chat.messages.length;
    let frameId: number | undefined;

    if (!hasInitialScroll.current) {
      hasInitialScroll.current = true;
      previousMessageCount.current = messageCount;
      frameId = requestAnimationFrame(() => scrollToBottom("auto"));
    } else if (messageCount > previousMessageCount.current) {
      if (isAtBottom()) {
        frameId = requestAnimationFrame(() => scrollToBottom("smooth"));
      } else {
        setShowJumpButton(true);
        setNewMessageCount(
          (count) => count + (messageCount - previousMessageCount.current),
        );
      }
    }
    previousMessageCount.current = messageCount;

    const messageColumn =
      scrollerRef.current?.querySelector<HTMLElement>(".message-column");
    const resizeObserver =
      messageColumn && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            if (shouldStickToBottom.current) scrollToBottom("auto");
          })
        : undefined;
    if (resizeObserver && messageColumn) resizeObserver.observe(messageColumn);

    return () => {
      if (frameId !== undefined) cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
    };
  }, [chat.isLoading, chat.messages.length, isAtBottom, scrollToBottom]);

  function handleScroll() {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    if (scroller.scrollTop < 96 && chat.paginationStatus === "CanLoadMore")
      chat.loadMore(32);
    const atBottom = isAtBottom();
    shouldStickToBottom.current = atBottom;
    if (atBottom) {
      setShowJumpButton(false);
      setNewMessageCount(0);
    }
  }

  const startSelection = useCallback((messageId?: string) => {
    setIsSelectionMode(true);
    if (!messageId) return;
    setSelectedMessageIds((current) => {
      if (current.has(messageId)) return current;
      return new Set(current).add(messageId);
    });
  }, []);

  const toggleSelect = useCallback((messageId: string) => {
    setSelectedMessageIds((current) => {
      const next = new Set(current);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }, []);

  const cancelSelection = useCallback(() => {
    setIsSelectionMode(false);
    setSelectedMessageIds(new Set());
  }, []);

  const changeFilter = useCallback(
    (next: Filter) => {
      setFilter(next);
      cancelSelection();
      hasInitialScroll.current = false;
      previousMessageCount.current = 0;
      setShowJumpButton(false);
      setNewMessageCount(0);
    },
    [cancelSelection],
  );

  const selectLabel = useCallback(
    (name: string) => changeFilter({ kind: "label", name }),
    [changeFilter],
  );

  const setLabel = useCallback(
    (messageIds: string[], name: string, applied: boolean) => {
      setLabelError(undefined);
      chat.setLabel(messageIds, name, applied).catch((error: unknown) => {
        setLabelError(
          error instanceof Error
            ? error.message
            : "Couldn't change that label.",
        );
      });
    },
    [chat.setLabel],
  );

  const selectedLabelState = useCallback(
    (name: string): LabelState => {
      const count = selectedMessages.filter((message) =>
        message.labels?.some((label) => label.name === name),
      ).length;
      if (count === 0) return "none";
      return count === selectedMessages.length ? "all" : "some";
    },
    [selectedMessages],
  );

  const requestDelete = useCallback((message: LocalMessage) => {
    setDeleteTargets([message]);
  }, []);

  const requestDeleteSelected = useCallback(() => {
    if (selectedMessages.length > 0) setDeleteTargets(selectedMessages);
  }, [selectedMessages]);

  async function downloadSelected() {
    if (isDownloading || selectedDownloadFiles.length === 0) return;
    setIsDownloading(true);
    setDownloadNotice(undefined);
    setDownloadError(undefined);

    try {
      const result = await downloadFiles(selectedDownloadFiles);
      if (result.saved > 0) {
        setDownloadNotice(
          result.destination === "downloads"
            ? `Saved ${result.saved} file${result.saved === 1 ? "" : "s"} to Downloads.`
            : result.destination === "queued"
              ? `Started ${result.saved} download${result.saved === 1 ? "" : "s"} in Downloads.`
              : `Started ${result.saved} download${result.saved === 1 ? "" : "s"}.`,
        );
      }
      if (result.failed.length > 0) {
        setDownloadError(
          `Couldn't download ${result.failed.length} file${result.failed.length === 1 ? "" : "s"}: ${result.failed.map((file) => file.fileName).join(", ")}`,
        );
      }
    } catch (error) {
      setDownloadError(
        error instanceof Error
          ? error.message
          : "Couldn't download those files.",
      );
    } finally {
      setIsDownloading(false);
    }
  }

  async function confirmDelete() {
    if (deleteTargets.length === 0) return;
    setIsDeleting(true);
    setDeleteError(undefined);
    try {
      await Promise.all(
        deleteTargets.map((message) => chat.deleteMessage(message._id)),
      );
      setDeleteTargets([]);
      cancelSelection();
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
        isSelectionMode={isSelectionMode}
        selectedMessageCount={selectedMessageIds.size}
        selectedAttachmentCount={selectedDownloadFiles.length}
        isDownloading={isDownloading}
        searchQuery={searchQuery}
        allLabels={allLabels}
        selectedLabelState={selectedLabelState}
        onToggleSelectedLabel={(name, applied) =>
          setLabel(
            selectedMessages.map((message) => message._id),
            name,
            applied,
          )
        }
        onSearchChange={setSearchQuery}
        onStartSelection={() => startSelection()}
        onCancelSelection={cancelSelection}
        onDownloadSelected={() => void downloadSelected()}
        onDeleteSelected={requestDeleteSelected}
        onSignOut={signOut}
      />
      {facets &&
      (facets.types.length > 0 ||
        facets.labels.length > 0 ||
        filter.kind !== "all") ? (
        <FilterBar
          filter={filter}
          types={facets.types}
          labels={allLabels}
          onChange={changeFilter}
        />
      ) : null}
      <main className="chat-main">
        <MessageList
          messages={chat.messages}
          isLoading={chat.isLoading}
          isSelectionMode={isSelectionMode}
          selectedMessageIds={selectedMessageIds}
          searchQuery={searchQuery}
          view={view}
          emptyState={emptyStateFor(filter)}
          allLabels={allLabels}
          paginationStatus={chat.paginationStatus}
          onLoadMore={() => chat.loadMore(32)}
          onScroll={handleScroll}
          scrollerRef={scrollerRef}
          onStartSelection={startSelection}
          onToggleSelect={toggleSelect}
          onRequestDelete={requestDelete}
          onSetLabel={setLabel}
          onSelectLabel={selectLabel}
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
          activeLabel={filter.kind === "label" ? filter.name : undefined}
          onSendMessage={chat.sendMessage}
          onUploadFile={chat.uploadFile}
        />
      </main>
      {deleteTargets.length > 0 ? (
        <DeleteDialog
          messages={deleteTargets}
          isDeleting={isDeleting}
          onCancel={() => {
            if (!isDeleting) setDeleteTargets([]);
          }}
          onConfirm={confirmDelete}
        />
      ) : null}
      <div className="toasts">
        {downloadNotice ? (
          <Toast
            tone="notice"
            message={downloadNotice}
            onDismiss={() => setDownloadNotice(undefined)}
          />
        ) : null}
        {deleteError ? (
          <Toast
            tone="error"
            message={deleteError}
            onDismiss={() => setDeleteError(undefined)}
          />
        ) : null}
        {labelError ? (
          <Toast
            tone="error"
            message={labelError}
            onDismiss={() => setLabelError(undefined)}
          />
        ) : null}
        {downloadError ? (
          <Toast
            tone="error"
            message={downloadError}
            onDismiss={() => setDownloadError(undefined)}
          />
        ) : null}
      </div>
    </div>
  );
}
