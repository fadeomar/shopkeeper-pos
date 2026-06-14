export interface PwaInstallDetectionInput {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  navigatorStandalone?: boolean;
  displayModeStandalone?: boolean;
}

export interface PwaInstallEnvironment {
  isStandalone: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  isChromium: boolean;
  isSafari: boolean;
  isInAppBrowser: boolean;
}

const IN_APP_BROWSER_RE =
  /FBAN|FBAV|FBIOS|FB_IAB|Instagram|Line\/|WhatsApp|Twitter|Pinterest|Snapchat|TikTok|Messenger|wv\)/i;

function readNavigatorValue<K extends keyof Navigator>(key: K): Navigator[K] | undefined {
  if (typeof navigator === "undefined") return undefined;
  return navigator[key];
}

export function detectPwaInstallEnvironment(
  input: PwaInstallDetectionInput = {},
): PwaInstallEnvironment {
  const userAgent = input.userAgent ?? readNavigatorValue("userAgent") ?? "";
  const platform = input.platform ?? readNavigatorValue("platform") ?? "";
  const maxTouchPoints =
    input.maxTouchPoints ?? readNavigatorValue("maxTouchPoints") ?? 0;

  const displayModeStandalone =
    input.displayModeStandalone ??
    (typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches);
  const navigatorStandalone =
    input.navigatorStandalone ??
    (typeof navigator !== "undefined" &&
      (navigator as Navigator & { standalone?: boolean }).standalone === true);

  const isIPadOSDesktopMode =
    platform === "MacIntel" && maxTouchPoints > 1 && /Safari/i.test(userAgent);
  const isIOS = /iPad|iPhone|iPod/i.test(userAgent) || isIPadOSDesktopMode;
  const isAndroid = /Android/i.test(userAgent);
  const isSafari =
    /Safari/i.test(userAgent) &&
    !/Chrome|Chromium|CriOS|FxiOS|Edg|OPR|SamsungBrowser/i.test(userAgent);
  const isChromium =
    /Chrome|Chromium|Edg|OPR|SamsungBrowser/i.test(userAgent) && !isIOS;

  return {
    isStandalone: Boolean(displayModeStandalone || navigatorStandalone),
    isIOS,
    isAndroid,
    isChromium,
    isSafari,
    isInAppBrowser: IN_APP_BROWSER_RE.test(userAgent),
  };
}
