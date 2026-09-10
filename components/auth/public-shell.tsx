"use client";

/**
 * PublicShell — minimal chrome for public, logged-out pages (currently /guide).
 * Deliberately NOT the POS shell: no DbBootstrap, no SyncProvider restore, no
 * Dexie/Firestore reads. Static + i18n + links only — renders with no local
 * database and no network.
 *
 * Slim top bar: app name, language toggle (so a visitor can switch to Arabic
 * before signing in), and a "Sign in" link to "/" (which shows the auth screen
 * when logged out). Stock Tailwind classes only; inline-SVG icon.
 */

import Link from "next/link";
import type { Route } from "next";
import { useLocale } from "@/components/providers/locale-context";
import { useAuth } from "@/components/providers/auth-context";
import { LoginIcon } from "@/features/guide/components/icons";

export function PublicShell({ children }: { children: React.ReactNode }) {
  const { t, locale, setLocale } = useLocale();
  const { status } = useAuth();
  const authenticated = status === "authenticated";

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link
            href={"/" as Route}
            className="flex items-center gap-2 font-bold tracking-tight text-slate-900"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand text-sm font-black text-white">
              S
            </span>
            <span className="text-sm sm:text-base">Asas POS</span>
          </Link>

          <div className="ms-auto flex items-center gap-2">
            <div
              className="flex items-center rounded-xl border border-slate-200 p-0.5"
              role="group"
              aria-label="Language"
            >
              {(["en", "ar"] as const).map((lng) => (
                <button
                  key={lng}
                  type="button"
                  onClick={() => setLocale(lng)}
                  aria-pressed={locale === lng}
                  className={
                    "rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors " +
                    (locale === lng
                      ? "bg-brand text-white"
                      : "text-slate-500 hover:text-slate-800")
                  }
                >
                  {lng === "en" ? "EN" : "عربي"}
                </button>
              ))}
            </div>

            <Link
              href={"/" as Route}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200"
            >
              <LoginIcon size={14} />
              {authenticated ? t("guide.common.backToApp") : t("guide.common.signIn")}
            </Link>
          </div>
        </div>
      </header>

      <main id="main-content" className="mx-auto max-w-3xl px-4 pb-28 pt-6">
        {children}
      </main>
    </div>
  );
}
