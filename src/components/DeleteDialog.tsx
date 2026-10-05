import { useEffect, useRef } from "react";
import { messageText } from "../lib/utils";
import type { LocalMessage } from "../hooks/useChat";

interface DeleteDialogProps {
  messages: LocalMessage[];
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

export function DeleteDialog({
  messages,
  isDeleting,
  onCancel,
  onConfirm,
}: DeleteDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isDeleting) onCancel();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isDeleting, onCancel]);

  const isBulkDelete = messages.length > 1;
  const message = messages[0];
  const preview = message
    ? messageText(message) || message.attachments[0]?.fileName || "this message"
    : "these messages";

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isDeleting) onCancel();
      }}
    >
      <section
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        aria-describedby="delete-description"
      >
        <h2 id="delete-title">
          {isBulkDelete
            ? `Delete ${messages.length} messages?`
            : "Delete message?"}
        </h2>
        <p id="delete-description" className="dialog-description">
          {isBulkDelete ? (
            "They will be removed from all your devices, including any attached files."
          ) : (
            <>
              <span className="dialog-quote">
                {preview.length > 96 ? `${preview.slice(0, 96)}…` : preview}
              </span>{" "}
              will be removed from all your devices.
            </>
          )}
        </p>
        <div className="dialog-actions">
          <button
            ref={cancelRef}
            type="button"
            className="secondary-button"
            onClick={onCancel}
            disabled={isDeleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="danger-button"
            onClick={() => void onConfirm()}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </section>
    </div>
  );
}
