import { useEffect, useRef } from "react";
import { TrashIcon, XIcon } from "../lib/icons";
import { messageText } from "../lib/utils";
import type { LocalMessage } from "../hooks/useChat";

interface DeleteDialogProps {
  message: LocalMessage;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

export function DeleteDialog({
  message,
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

  const preview =
    messageText(message) || message.attachments[0]?.fileName || "this message";

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isDeleting) onCancel();
      }}
    >
      <section
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        aria-describedby="delete-description"
      >
        <button
          type="button"
          className="icon-button dialog-close"
          onClick={onCancel}
          disabled={isDeleting}
          aria-label="Close dialog"
        >
          <XIcon size={18} />
        </button>
        <span className="dialog-icon">
          <TrashIcon size={20} />
        </span>
        <p className="kicker">Remove from relay</p>
        <h2 id="delete-title">Delete this message?</h2>
        <p id="delete-description" className="dialog-description">
          “{preview.length > 96 ? `${preview.slice(0, 96)}…` : preview}” will
          disappear from every signed-in device.
        </p>
        <div className="dialog-actions">
          <button
            ref={cancelRef}
            type="button"
            className="secondary-button"
            onClick={onCancel}
            disabled={isDeleting}
          >
            Keep it
          </button>
          <button
            type="button"
            className="danger-button"
            onClick={() => void onConfirm()}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting…" : "Delete message"}
          </button>
        </div>
      </section>
    </div>
  );
}
