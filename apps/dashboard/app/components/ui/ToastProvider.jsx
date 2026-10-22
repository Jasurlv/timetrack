"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

const ToastContext = createContext(null);
let nextToastId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (message, type = "success") => {
      const id = ++nextToastId;
      setToasts((current) => [...current, { id, message, type }]);
      timers.current.set(id, setTimeout(() => dismiss(id), 5000));
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div
        role="region"
        aria-label="Notifications"
        className="fixed right-4 top-4 z-[1000] grid w-[min(24rem,calc(100vw-2rem))] gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.type === "error" ? "alert" : "status"}
            className={`flex items-start justify-between gap-4 rounded-md border border-slate-200 border-l-4 bg-white px-4 py-3 text-sm text-slate-800 shadow-lg ${
              toast.type === "error"
                ? "border-l-red-600"
                : "border-l-green-600"
            }`}
          >
            <p>{toast.message}</p>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => dismiss(toast.id)}
              className="shrink-0 text-lg leading-4 text-ink/60 hover:text-ink"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const notify = useContext(ToastContext);
  if (!notify) throw new Error("useToast must be used within ToastProvider");
  return notify;
}
