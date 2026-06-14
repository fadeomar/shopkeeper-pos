import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PwaInstallAction } from "@/components/pwa/pwa-install-action";
import { renderWithLocale } from "@/tests/helpers/render";

function setNavigator(values: Partial<Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints">>) {
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(window.navigator, key, {
      configurable: true,
      value,
    });
  }
}

function makeBeforeInstallPromptEvent(outcome: "accepted" | "dismissed") {
  const event = new Event("beforeinstallprompt") as Event & {
    prompt: ReturnType<typeof vi.fn>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  };
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome, platform: "web" });
  return event;
}

describe("PwaInstallAction", () => {
  it("opens iOS installation instructions when no native prompt is available", async () => {
    setNavigator({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      platform: "iPhone",
      maxTouchPoints: 5,
    });

    renderWithLocale(<PwaInstallAction />);

    await userEvent.click(
      await screen.findByRole("button", { name: /how to install/i }),
    );

    expect(await screen.findByText("Install Asas POS")).toBeInTheDocument();
    expect(screen.getByText("Tap the Share button at the bottom of Safari.")).toBeInTheDocument();
    expect(screen.getByText("Choose Add to Home Screen.")).toBeInTheDocument();
  });

  it("uses the native beforeinstallprompt flow when the browser exposes it", async () => {
    setNavigator({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      platform: "Win32",
      maxTouchPoints: 0,
    });
    const promptEvent = makeBeforeInstallPromptEvent("accepted");

    renderWithLocale(<PwaInstallAction />);
    await screen.findByRole("button", { name: /how to install/i });
    window.dispatchEvent(promptEvent);

    await userEvent.click(
      await screen.findByRole("button", { name: /install app/i }),
    );

    expect(promptEvent.prompt).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByText("Installed app")).toBeInTheDocument();
    });
  });
});
