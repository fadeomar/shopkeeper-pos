"use client";

import { useCallback, useEffect, useState } from "react";
import {
  detectPwaInstallEnvironment,
  type PwaInstallEnvironment,
} from "@/lib/pwa/install-environment";

type InstallOutcome = "accepted" | "dismissed";

interface PwaInstallUserChoice {
  outcome: InstallOutcome;
  platform: string;
}

interface BeforeInstallPromptEvent extends Event {
  readonly platforms?: string[];
  readonly userChoice: Promise<PwaInstallUserChoice>;
  prompt: () => Promise<void>;
}

export type PwaInstallResult =
  | "accepted"
  | "dismissed"
  | "already-installed"
  | "manual-instructions";

export interface UsePwaInstallResult {
  environment: PwaInstallEnvironment;
  isInstalled: boolean;
  canUseNativePrompt: boolean;
  install: () => Promise<PwaInstallResult>;
}

const INITIAL_ENVIRONMENT: PwaInstallEnvironment = {
  isStandalone: false,
  isIOS: false,
  isAndroid: false,
  isChromium: false,
  isSafari: false,
  isInAppBrowser: false,
};
const INSTALL_STATUS_KEY = "shopkeeper-pos-pwa-installed";

function readStoredInstalledFlag(): boolean {
  try {
    return window.localStorage.getItem(INSTALL_STATUS_KEY) === "1";
  } catch {
    return false;
  }
}

function writeStoredInstalledFlag(): void {
  try {
    window.localStorage.setItem(INSTALL_STATUS_KEY, "1");
  } catch {
    // Storage can be unavailable in strict/private modes. The in-memory state
    // still updates for this session, so installation UX remains usable.
  }
}

export function usePwaInstall(): UsePwaInstallResult {
  const [environment, setEnvironment] =
    useState<PwaInstallEnvironment>(INITIAL_ENVIRONMENT);
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installedFromPrompt, setInstalledFromPrompt] = useState(false);

  useEffect(() => {
    let mounted = true;

    function refreshEnvironment() {
      if (!mounted) return;
      const next = detectPwaInstallEnvironment();
      setEnvironment(next);
    }

    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      refreshEnvironment();
    }

    function markInstalled() {
      writeStoredInstalledFlag();
      setInstalledFromPrompt(true);
    }

    function onAppInstalled() {
      setDeferredPrompt(null);
      markInstalled();
      refreshEnvironment();
    }

    setInstalledFromPrompt(readStoredInstalledFlag());
    refreshEnvironment();
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    const standaloneQuery = window.matchMedia("(display-mode: standalone)");
    if (typeof standaloneQuery.addEventListener === "function") {
      standaloneQuery.addEventListener("change", refreshEnvironment);
    } else {
      standaloneQuery.addListener(refreshEnvironment);
    }

    return () => {
      mounted = false;
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
      if (typeof standaloneQuery.removeEventListener === "function") {
        standaloneQuery.removeEventListener("change", refreshEnvironment);
      } else {
        standaloneQuery.removeListener(refreshEnvironment);
      }
    };
  }, []);

  const install = useCallback(async (): Promise<PwaInstallResult> => {
    if (environment.isStandalone || installedFromPrompt) return "already-installed";
    if (!deferredPrompt) return "manual-instructions";

    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (choice.outcome === "accepted") {
      writeStoredInstalledFlag();
      setInstalledFromPrompt(true);
      setEnvironment(detectPwaInstallEnvironment());
      return "accepted";
    }
    return "dismissed";
  }, [deferredPrompt, environment.isStandalone, installedFromPrompt]);

  const isInstalled = environment.isStandalone || installedFromPrompt;

  return {
    environment,
    isInstalled,
    canUseNativePrompt: Boolean(deferredPrompt && !isInstalled),
    install,
  };
}
