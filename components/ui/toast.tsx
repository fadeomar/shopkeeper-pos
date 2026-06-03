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
import {
  CircleCheck,
  CircleAlert,
  Info,
  TriangleAlert,
  X,
} from "@/components/ui/icons";
import { useLocale } from "@/components/providers/locale-context";
import type { LucideIcon } from "lucide-react";

// "success" and "error" are the original tones (all existing call sites use
// these); "info" and "warning" are added for richer feedback. The signature
// stays backward compatible — tone is optional and defaults to "success".
type ToastTone = "success" | "error" | "info" | "warning";

/**
 * Structured toast input. `push` accepts either a plain string (the original
 * API — title only) or this object for richer offline-first feedback with an
 * optional secondary line and a single inline action (e.g. "Open receipt").
 */
export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Optional inline action button. */
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastItem {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
  actionLabel?: string;
  onAction?: () => void;
}

// Per-tone presentation: a semantic-token icon chip + icon. The toast body is
// a neutral surface card so it stays legible over any page content; the colour
// lives in the leading icon chip (mirrors the design-system status palette).
const TONE_CONFIG: Record<
  ToastTone,
  { icon: LucideIcon; chip: string; iconColor: string }
> = {
  success: { icon: CircleCheck, chip: "bg-success-soft", iconColor: "text-success" },
  error: { icon: CircleAlert, chip: "bg-danger-soft", iconColor: "text-danger" },
  info: { icon: Info, chip: "bg-info-soft", iconColor: "text-info" },
  warning: { icon: TriangleAlert, chip: "bg-warning-soft", iconColor: "text-warning" },
};

// Errors/warnings linger longer so the cashier has time to read them.
const TONE_DURATION_MS: Record<ToastTone, number> = {
  success: 3000,
  info: 3000,
  error: 5000,
  warning: 5000,
};

const ToastContext = createContext<{
  push: (input: string | ToastInput, tone?: ToastTone) => void;
} | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { t } = useLocale();
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((cur) => cur.filter((toast) => toast.id !== id));
  }, []);

  // Backward compatible: push("msg") / push("msg", "error") still work, and
  // push({ title, description, tone, actionLabel, onAction }) adds structure.
  const push = useCallback(
    (input: string | ToastInput, tone: ToastTone = "success") => {
      const item: ToastItem =
        typeof input === "string"
          ? { id: createUuid(), title: input, tone }
          : {
              id: createUuid(),
              title: input.title,
              description: input.description,
              tone: input.tone ?? "success",
              actionLabel: input.actionLabel,
              onAction: input.onAction,
            };
      setToasts((cur) => [...cur, item]);
      window.setTimeout(() => dismiss(item.id), TONE_DURATION_MS[item.tone]);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* end-4 (logical) keeps toasts in the trailing corner in LTR & RTL.
          bottom-20 clears the mobile bottom nav; lg drops it to the corner.
          role="status" + aria-live="polite" announces new toasts to SRs. */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="false"
        className="fixed bottom-20 end-4 z-[100] flex flex-col gap-2 pointer-events-none lg:bottom-5 lg:end-5"
      >
        {toasts.map((toast) => {
          const { icon: Icon, chip, iconColor } = TONE_CONFIG[toast.tone];
          return (
            <div
              key={toast.id}
              className={clsx(
                "pointer-events-auto flex items-start gap-3 animate-toast-in",
                "max-w-xs w-max rounded-xl border border-border-default bg-surface",
                "ps-3 pe-2 py-2.5 shadow-lg",
              )}
            >
              <span
                className={clsx(
                  "mt-0.5 shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-lg",
                  chip,
                )}
              >
                <Icon size={16} aria-hidden className={iconColor} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">{toast.title}</p>
                {toast.description && (
                  <p className="mt-0.5 text-xs text-fg-muted">
                    {toast.description}
                  </p>
                )}
                {toast.actionLabel && toast.onAction && (
                  <button
                    type="button"
                    onClick={() => {
                      toast.onAction?.();
                      dismiss(toast.id);
                    }}
                    className={clsx(
                      "mt-1.5 inline-flex rounded-lg px-2 py-1 text-xs font-semibold",
                      "bg-brand-soft text-brand transition-colors hover:brightness-95",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
                    )}
                  >
                    {toast.actionLabel}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label={t("common.close")}
                className={clsx(
                  "mt-0.5 shrink-0 rounded-lg bg-danger-soft/50 p-1 text-danger/75 transition-colors",
                  "hover:bg-danger-soft hover:text-danger",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/25",
                )}
              >
                <X size={14} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be inside ToastProvider");
  return ctx;
}
