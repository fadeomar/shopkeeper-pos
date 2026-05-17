"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import clsx from "clsx";
import { createUuid } from "@/lib/utils/id";

interface ToastItem {
  id: string;
  message: string;
  tone: "success" | "error";
}

const ToastContext = createContext<{
  push: (message: string, tone?: "success" | "error") => void;
} | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback(
    (message: string, tone: "success" | "error" = "success") => {
      const id = createUuid();
      setToasts((cur) => [...cur, { id, message, tone }]);
      window.setTimeout(() => {
        setToasts((cur) => cur.filter((t) => t.id !== id));
      }, 3000);
    },
    [],
  );

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Use end-5 (logical) so toasts sit in the trailing corner in both LTR & RTL */}
      <div className="fixed bottom-5 end-5 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={clsx(
              "px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white",
              "translate-y-0 opacity-100 pointer-events-auto",
              "max-w-xs w-max",
              toast.tone === "success" ? "bg-green-600" : "bg-red-600",
            )}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be inside ToastProvider");
  return ctx;
}
