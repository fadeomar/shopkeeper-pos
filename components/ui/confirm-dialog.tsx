"use client";

import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { typographyClasses } from "@/lib/design/variants";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "neutral",
  onConfirm,
  onCancel,
  loading,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "warning" | "neutral";
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      title={title}
      description={description}
      onClose={onCancel}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={
              tone === "danger"
                ? "danger"
                : tone === "warning"
                  ? "warning"
                  : "primary"
            }
            loading={loading}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description ? (
        <p className={typographyClasses.muted}>{description}</p>
      ) : null}
    </Modal>
  );
}
