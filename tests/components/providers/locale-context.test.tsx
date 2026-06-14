import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLocale } from "@/components/providers/locale-context";
import { renderWithLocale } from "@/tests/helpers/render";

function LocaleProbe() {
  const { locale, setLocale } = useLocale();
  return (
    <div>
      <p data-testid="locale">{locale}</p>
      <button type="button" onClick={() => setLocale("ar")}>Arabic</button>
    </div>
  );
}

describe("LocaleProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.cookie = "shopkeeper-pos-locale=; path=/; max-age=0";
  });

  it("restores the preferred language from localStorage on load", async () => {
    window.localStorage.setItem("shopkeeper-pos-locale", "ar");

    renderWithLocale(<LocaleProbe />);

    await waitFor(() => {
      expect(screen.getByTestId("locale")).toHaveTextContent("ar");
      expect(document.documentElement).toHaveAttribute("lang", "ar");
      expect(document.documentElement).toHaveAttribute("dir", "rtl");
    });
  });

  it("persists language changes to localStorage and cookie", async () => {
    renderWithLocale(<LocaleProbe />);

    await userEvent.click(screen.getByRole("button", { name: "Arabic" }));

    expect(window.localStorage.getItem("shopkeeper-pos-locale")).toBe("ar");
    expect(document.cookie).toContain("shopkeeper-pos-locale=ar");
    expect(document.documentElement).toHaveAttribute("dir", "rtl");
  });

  it("falls back to the cookie and does not crash when localStorage throws", async () => {
    // Simulate private/hardened mode where localStorage access throws.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    document.cookie = "shopkeeper-pos-locale=ar; path=/";

    renderWithLocale(<LocaleProbe />);

    await waitFor(() => {
      expect(screen.getByTestId("locale")).toHaveTextContent("ar");
      expect(document.documentElement).toHaveAttribute("dir", "rtl");
    });
  });
});
