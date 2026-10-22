"use client";

import { useEffect, useId, useRef } from "react";

export default function Modal({
  open,
  title,
  description,
  onClose,
  pending = false,
  children,
  size = "max-w-3xl",
}) {
  const dialogRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();

    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);

  function requestClose() {
    if (!pending) onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none overflow-y-auto bg-transparent p-0 backdrop:bg-ink/60"
    >
      <div className="flex min-h-full items-center justify-center sm:p-6">
        <section
          className={`relative flex min-h-dvh max-h-dvh w-full ${size} flex-col overflow-hidden border border-slate-200 bg-white shadow-xl sm:min-h-0 sm:max-h-[calc(100dvh-3rem)] sm:rounded-xl`}
        >
          <header className="flex shrink-0 items-start justify-between gap-5 border-b border-slate-200 px-4 py-4 sm:px-7">
            <div>
              <h2 id={titleId} className="text-lg font-semibold text-slate-900">
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="mt-1 text-sm text-slate-500">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              aria-label="Close dialog"
              disabled={pending}
              onClick={requestClose}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-xl leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span aria-hidden="true">×</span>
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-7">
            {children}
          </div>
        </section>
      </div>
    </dialog>
  );
}
