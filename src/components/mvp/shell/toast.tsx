"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";

export interface ToastInput {
  message: string;
  tone?: "default" | "success" | "error";
  /** e.g. { label: "Undo", onClick } */
  action?: { label: string; onClick: () => void };
  /** ms; default 5 s, 8 s with an action. */
  duration?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

interface ToastApi {
  show: (toast: ToastInput) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => 0, dismiss: () => undefined });

/** Toasts (bottom of the screen) with an optional action such as Undo (docs/mvp/13 §2). */
export function useToast(): ToastApi {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const show = useCallback(
    (toast: ToastInput) => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-3), { ...toast, id }]);
      const duration = toast.duration ?? (toast.action ? 8000 : 5000);
      timers.current.set(id, setTimeout(() => dismiss(id), duration));
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) clearTimeout(timer);
    };
  }, []);

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 px-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
            className="pop-in pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl bg-[#111827] px-4 py-2.5 text-sm text-white shadow-lg"
          >
            {toast.tone === "error" ? (
              <AlertTriangle size={16} className="shrink-0 text-[#fda29b]" aria-hidden />
            ) : toast.tone === "success" ? (
              <CheckCircle2 size={16} className="shrink-0 text-[#6ce9a6]" aria-hidden />
            ) : null}
            <span className="min-w-0 flex-1">{toast.message}</span>
            {toast.action ? (
              <button
                type="button"
                onClick={() => {
                  toast.action?.onClick();
                  dismiss(toast.id);
                }}
                className="rounded-md px-2 py-1 text-sm font-bold text-[#a4bcfd] hover:bg-white/10"
              >
                {toast.action.label}
              </button>
            ) : null}
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(toast.id)} className="rounded-md p-1 text-white/60 hover:bg-white/10 hover:text-white">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
