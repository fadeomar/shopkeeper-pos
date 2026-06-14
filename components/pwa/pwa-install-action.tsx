"use client";

import { useState, type ReactNode } from "react";
import clsx from "clsx";
import { Download, ExternalLink, PlusSquare, Share2, Smartphone } from "lucide-react";
import { useLocale } from "@/components/providers/locale-context";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { usePwaInstall } from "@/components/pwa/use-pwa-install";

interface PwaInstallActionProps {
  compact?: boolean;
  className?: string;
}

function StepItem({ index, children }: { index: number; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm text-slate-700">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">
        {index}
      </span>
      <span>{children}</span>
    </li>
  );
}

export function PwaInstallAction({ compact = false, className }: PwaInstallActionProps) {
  const { t } = useLocale();
  const { environment, isInstalled, canUseNativePrompt, install } = usePwaInstall();
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleInstallClick() {
    if (isInstalled) return;
    setBusy(true);
    try {
      const result = await install();
      if (result === "manual-instructions" || result === "dismissed") {
        setInstructionsOpen(true);
      }
    } finally {
      setBusy(false);
    }
  }

  if (isInstalled) {
    return (
      <span
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-full bg-success/15 text-success",
          compact
            ? "px-2.5 py-0.5 text-xs font-medium"
            : "px-3 py-1.5 text-sm font-semibold",
          className,
        )}
      >
        <Smartphone size={compact ? 14 : 16} aria-hidden />
        {t("pwa.installed")}
      </span>
    );
  }

  const buttonLabel = canUseNativePrompt
    ? t("pwa.installApp")
    : t("pwa.installHelp");

  return (
    <>
      <button
        type="button"
        onClick={handleInstallClick}
        disabled={busy}
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-full font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-60",
          compact
            ? "bg-brand/15 px-2.5 py-0.5 text-xs text-brand hover:bg-brand/25 focus-visible:ring-offset-slate-950"
            : "bg-brand px-4 py-2 text-sm text-white hover:bg-brand-hover",
          className,
        )}
        aria-label={buttonLabel}
      >
        <Download size={compact ? 14 : 16} aria-hidden />
        {buttonLabel}
      </button>

      <Modal
        open={instructionsOpen}
        onClose={() => setInstructionsOpen(false)}
        title={t("pwa.installModalTitle")}
        description={t("pwa.installModalDesc")}
        presentation="auto"
        footer={
          <Button type="button" onClick={() => setInstructionsOpen(false)}>
            {t("common.close")}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          {environment.isInAppBrowser && (
            <div className="flex items-start gap-3 rounded-2xl border border-warning/25 bg-warning/10 p-3 text-sm text-warning">
              <ExternalLink size={18} className="mt-0.5 shrink-0" aria-hidden />
              <p>{t("pwa.installInAppBrowserWarning")}</p>
            </div>
          )}

          <div className="flex items-start gap-3 rounded-2xl border border-info/20 bg-info-soft p-3 text-sm text-info">
            {environment.isIOS ? (
              <Share2 size={18} className="mt-0.5 shrink-0" aria-hidden />
            ) : (
              <Download size={18} className="mt-0.5 shrink-0" aria-hidden />
            )}
            <p>
              {environment.isIOS
                ? t("pwa.installIosIntro")
                : environment.isAndroid
                  ? t("pwa.installAndroidIntro")
                  : t("pwa.installDesktopIntro")}
            </p>
          </div>

          <ol className="flex flex-col gap-2">
            {environment.isIOS ? (
              <>
                <StepItem index={1}>{t("pwa.installIosStep1")}</StepItem>
                <StepItem index={2}>{t("pwa.installIosStep2")}</StepItem>
                <StepItem index={3}>{t("pwa.installIosStep3")}</StepItem>
                <StepItem index={4}>{t("pwa.installIosStep4")}</StepItem>
              </>
            ) : environment.isAndroid ? (
              <>
                <StepItem index={1}>{t("pwa.installAndroidStep1")}</StepItem>
                <StepItem index={2}>{t("pwa.installAndroidStep2")}</StepItem>
                <StepItem index={3}>{t("pwa.installAndroidStep3")}</StepItem>
              </>
            ) : (
              <>
                <StepItem index={1}>{t("pwa.installDesktopStep1")}</StepItem>
                <StepItem index={2}>{t("pwa.installDesktopStep2")}</StepItem>
                <StepItem index={3}>{t("pwa.installDesktopStep3")}</StepItem>
              </>
            )}
          </ol>

          <div className="flex items-start gap-3 rounded-2xl border border-success/20 bg-success-soft p-3 text-sm text-success">
            <PlusSquare size={18} className="mt-0.5 shrink-0" aria-hidden />
            <p>{t("pwa.installOfflineBenefit")}</p>
          </div>
        </div>
      </Modal>
    </>
  );
}
