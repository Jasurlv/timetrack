"use client";

import Modal from "./Modal";

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Delete",
  pending = false,
  onCancel,
  onConfirm,
}) {
  return (
    <Modal
      open={open}
      title={title}
      description={description}
      onClose={onCancel}
      pending={pending}
      size="max-w-lg"
    >
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          disabled={pending}
          onClick={onCancel}
          className="ui-button-secondary"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onConfirm}
          className="ui-button-danger"
        >
          {pending ? "Deleting..." : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
