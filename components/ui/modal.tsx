"use client";

import { useEffect, type PropsWithChildren, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/providers/locale-context";
import {
  dividerClasses,
  surfaceClasses,
  typographyClasses,
} from "@/lib/design/variants";

interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  footer?: ReactNode;
}

export function Modal({
  open,
  title,
  description,
  onClose,
  footer,
  children,
}: PropsWithChildren<ModalProps>) {
  const { t } = useLocale();

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    /* Backdrop */
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${surfaceClasses.modalBackdrop}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      onClick={onClose}
    >
      {/* Panel — stop propagation so clicking inside doesn't close */}
      <div
        className={`w-full max-w-lg rounded-2xl border shadow-2xl ${surfaceClasses.surface} ${dividerClasses.borderDefault}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={`flex items-start justify-between gap-4 border-b px-5 py-4 ${dividerClasses.borderSubtle}`}
        >
          <div className="min-w-0">
            <h3 id="modal-title" className={typographyClasses.sectionTitle}>
              {title}
            </h3>
            {description && (
              <p className={typographyClasses.sectionDescription}>
                {description}
              </p>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            {t("common.close")}
          </Button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">{children}</div>

        {/* Footer */}
        {footer && (
          <div
            className={`flex items-center justify-end gap-2 border-t px-5 py-4 ${dividerClasses.borderSubtle}`}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
