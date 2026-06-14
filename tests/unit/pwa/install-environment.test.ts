import { describe, expect, it } from "vitest";
import { detectPwaInstallEnvironment } from "@/lib/pwa/install-environment";

describe("detectPwaInstallEnvironment", () => {
  it("detects iPhone Safari as iOS manual install flow", () => {
    const env = detectPwaInstallEnvironment({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      platform: "iPhone",
      maxTouchPoints: 5,
    });

    expect(env.isIOS).toBe(true);
    expect(env.isSafari).toBe(true);
    expect(env.isChromium).toBe(false);
    expect(env.isStandalone).toBe(false);
  });

  it("detects Android Chrome as Chromium install-capable environment", () => {
    const env = detectPwaInstallEnvironment({
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
      platform: "Linux armv8l",
      maxTouchPoints: 5,
    });

    expect(env.isAndroid).toBe(true);
    expect(env.isChromium).toBe(true);
    expect(env.isIOS).toBe(false);
  });

  it("marks standalone launch when either display-mode or navigator standalone is true", () => {
    expect(
      detectPwaInstallEnvironment({ displayModeStandalone: true }).isStandalone,
    ).toBe(true);
    expect(
      detectPwaInstallEnvironment({ navigatorStandalone: true }).isStandalone,
    ).toBe(true);
  });

  it("flags common in-app browsers so the UI can ask users to open Safari or Chrome", () => {
    const env = detectPwaInstallEnvironment({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 WhatsApp/24.12.78",
      platform: "iPhone",
      maxTouchPoints: 5,
    });

    expect(env.isIOS).toBe(true);
    expect(env.isInAppBrowser).toBe(true);
  });
});
