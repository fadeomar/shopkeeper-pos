"use client";

/**
 * MobileBottomNav — fixed bottom tab bar for mobile (<lg).
 *
 * Shows the 4 primary POS actions (Sell, Bills, Products, Stock) plus a
 * "More" button that opens a bottom sheet containing the remaining routes.
 *
 * Desktop navigation is still handled by the vertical sidebar in
 * SidebarNav — this component is `lg:hidden` and never touches desktop.
 *
 * Design decisions:
 *  - 4 + More pattern keeps the bar scannable without overflow.
 *  - "Sell" is first so the primary cashier action is always one tap away.
 *  - The More sheet uses a 4-column icon grid — easy to thumb-tap, shows
 *    all secondary routes without scrolling on any phone size.
 *  - Shift open indicator dot carried over from the sidebar so cashiers
 *    always know whether a shift is active.
 *  - Close-on-navigate: useEffect watches pathname and closes the sheet
 *    automatically when a link inside is tapped.
 */

import { useState, useEffect, useId, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { lockBodyScroll } from "@/lib/utils/body-scroll-lock";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ShoppingCart,
  ReceiptText,
  Package,
  Boxes,
  MoreHorizontal,
  LayoutDashboard,
  Truck,
  BarChart3,
  Users,
  Store,
  Clock,
  Banknote,
  Wallet,
  History,
  Settings,
  X,
  type LucideIcon,
} from "lucide-react";
import { db } from "@/lib/db/schema";
import { useLocale } from "@/components/providers/locale-context";
import { useAuth } from "@/components/providers/auth-context";
import { SafeSignOutButton } from "@/components/auth/safe-sign-out-button";

interface TabRoute {
  href: string;
  shortKey: string;
  icon: LucideIcon;
}

// The 4 most-used POS actions — always visible in the bottom bar.
const PRIMARY_TABS: TabRoute[] = [
  { href: "/billing", shortKey: "navShort.newBill", icon: ShoppingCart },
  { href: "/bills", shortKey: "navShort.billHistory", icon: ReceiptText },
  { href: "/products", shortKey: "navShort.products", icon: Package },
  { href: "/inventory", shortKey: "navShort.inventory", icon: Boxes },
];

// Secondary routes — accessible via the "More" sheet.
const MORE_ROUTES: TabRoute[] = [
  { href: "/", shortKey: "navShort.dashboard", icon: LayoutDashboard },
  { href: "/purchases/new", shortKey: "navShort.newPurchase", icon: Truck },
  { href: "/purchases", shortKey: "navShort.purchaseHistory", icon: ReceiptText },
  { href: "/reports", shortKey: "navShort.reports", icon: BarChart3 },
  { href: "/customers", shortKey: "navShort.customers", icon: Users },
  { href: "/suppliers", shortKey: "navShort.suppliers", icon: Store },
  { href: "/shift", shortKey: "navShort.shift", icon: Clock },
  { href: "/cash", shortKey: "navShort.cash", icon: Banknote },
  { href: "/expenses", shortKey: "navShort.expenses", icon: Wallet },
  { href: "/audit", shortKey: "navShort.audit", icon: History },
  { href: "/settings", shortKey: "navShort.settings", icon: Settings },
];

export function MobileBottomNav() {
  const pathname = usePathname();
  const { t } = useLocale();
  const { user } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const dialogId = useId();
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const wasOpenRef = useRef(false);

  const activeShift = useLiveQuery(
    () => db.shifts.where("status").equals("open").first(),
    [],
  );

  // Close the More sheet whenever the route changes (link was tapped).
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  // Prevent background page from scrolling while the sheet is open.
  useEffect(() => {
    if (!moreOpen) return;
    return lockBodyScroll();
  }, [moreOpen]);

  // Focus management for the sheet: focus the first control on open, trap Tab
  // inside it, and close on Escape. The containment guard means a nested modal
  // (the sign-out confirm, portaled outside the sheet) keeps its own focus and
  // Escape handling rather than fighting this trap.
  useEffect(() => {
    if (!moreOpen) return;
    const focusables = () =>
      Array.from(
        sheetRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    const timer = window.setTimeout(() => focusables()[0]?.focus(), 30);

    function onKey(e: KeyboardEvent) {
      const sheet = sheetRef.current;
      const focusInSheet = !!sheet && sheet.contains(document.activeElement);
      if (e.key === "Escape") {
        if (focusInSheet) {
          e.preventDefault();
          setMoreOpen(false);
        }
        return;
      }
      if (e.key !== "Tab" || !focusInSheet) return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  // Restore focus to the More trigger when the sheet closes (keyboard users
  // shouldn't be dropped back at the top of the page).
  useEffect(() => {
    if (wasOpenRef.current && !moreOpen) moreButtonRef.current?.focus();
    wasOpenRef.current = moreOpen;
  }, [moreOpen]);

  const accountInitial =
    user?.name?.charAt(0)?.toUpperCase() ??
    user?.email?.charAt(0)?.toUpperCase() ??
    "?";

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    // /purchases and /purchases/new are separate top-level actions.
    if (href === "/purchases") return pathname === "/purchases";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  // If the current page is in the "More" set, highlight the More tab.
  const isMoreActive = MORE_ROUTES.some((r) => isActive(r.href));

  // Hide the bottom nav on the POS billing screen so the sticky checkout
  // bar (which sits at the same bottom-0 position) is never obscured.
  // The checkout bar has its own totals + finalize button — the nav would
  // be redundant there and would overlap the most important cashier action.
  //
  // IMPORTANT: this early return is placed AFTER every hook call (useState,
  // useId, useLiveQuery, and the three useEffects above) so the Rules of
  // Hooks are never violated when navigating to/from /billing.
  if (pathname.startsWith("/billing")) return null;

  return (
    <>
      {/* ── Fixed bottom tab bar ─────────────────────────────────────────── */}
      <nav
        aria-label={t("nav.mainNavLabel")}
        className={clsx(
          "lg:hidden",
          "fixed bottom-0 inset-x-0 z-40",
          "bg-slate-900 border-t border-white/10",
          // pb-safe keeps the bar above the iOS home indicator on notched phones.
          "pb-safe",
        )}
      >
        <div className="flex h-16 items-stretch">
          {PRIMARY_TABS.map(({ href, shortKey, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href as any}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "flex flex-1 flex-col items-center justify-center gap-1 px-1",
                  "text-xs font-medium transition-colors min-w-0",
                  active
                    ? "text-brand-soft"
                    : "text-slate-400 active:text-white",
                )}
              >
                <Icon
                  size={22}
                  strokeWidth={active ? 2.25 : 2}
                  aria-hidden
                />
                <span className="leading-none truncate">{t(shortKey)}</span>
              </Link>
            );
          })}

          {/* More button */}
          <button
            ref={moreButtonRef}
            type="button"
            aria-label={t("navShort.more")}
            aria-expanded={moreOpen}
            aria-controls={moreOpen ? dialogId : undefined}
            onClick={() => setMoreOpen(true)}
            className={clsx(
              "flex flex-1 flex-col items-center justify-center gap-1 px-1",
              "text-xs font-medium transition-colors min-w-0",
              isMoreActive || moreOpen
                ? "text-brand-soft"
                : "text-slate-400 active:text-white",
            )}
          >
            <MoreHorizontal size={22} strokeWidth={2} aria-hidden />
            <span className="leading-none">{t("navShort.more")}</span>
          </button>
        </div>
      </nav>

      {/* ── More sheet overlay ────────────────────────────────────────────── */}
      {moreOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end animate-fade-in"
          role="presentation"
          onClick={() => setMoreOpen(false)}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
            aria-hidden
          />

          {/* Sheet panel */}
          <div
            ref={sheetRef}
            id={dialogId}
            role="dialog"
            aria-modal="true"
            aria-label={t("nav.moreMenuLabel")}
            onClick={(e) => e.stopPropagation()}
            className={clsx(
              "relative max-h-[calc(100dvh-24px)] overflow-y-auto overscroll-contain",
              "bg-slate-900 rounded-t-3xl border-t border-white/10",
              "pb-safe animate-sheet-up",
            )}
          >
            {/* Drag handle — visual cue only */}
            <div className="flex justify-center pt-2.5 pb-1" aria-hidden>
              <div className="h-1 w-10 rounded-full bg-white/20" />
            </div>

            {/* Header: title + close button */}
            <div className="flex items-center justify-between px-5 py-3">
              <span className="text-sm font-semibold text-white">
                {t("nav.moreMenuLabel")}
              </span>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label={t("common.close")}
                className={clsx(
                  "rounded-xl bg-danger-soft/15 p-2 text-danger-soft transition-colors",
                  "hover:bg-danger-soft/25 hover:text-white",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger-soft/60",
                )}
              >
                <X size={18} aria-hidden />
              </button>
            </div>

            {/* 4-column icon grid */}
            <div className="grid grid-cols-4 gap-1 px-3 pb-5">
              {MORE_ROUTES.map(({ href, shortKey, icon: Icon }) => {
                const active = isActive(href);
                const showShiftDot = href === "/shift" && Boolean(activeShift);

                return (
                  <Link
                    key={href}
                    href={href as any}
                    aria-current={active ? "page" : undefined}
                    className={clsx(
                      "relative flex flex-col items-center gap-2 rounded-2xl px-2 py-3",
                      "text-center text-xs font-medium transition-colors",
                      active
                        ? "bg-white/10 text-white"
                        : "text-slate-400 hover:bg-white/5 hover:text-white active:bg-white/10",
                    )}
                  >
                    <Icon
                      size={24}
                      strokeWidth={active ? 2.25 : 2}
                      aria-hidden
                    />
                    <span className="leading-tight">{t(shortKey)}</span>
                    {showShiftDot && (
                      <span className="absolute top-2 end-2 inline-flex items-center">
                        <span
                          className="h-2 w-2 rounded-full bg-success"
                          aria-hidden
                        />
                        <span className="sr-only">{t("nav.shiftOpen")}</span>
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>

            {/* Account — sign-out lives here (off the working header). The
                SafeSignOutButton shows the unsynced-data warning before logout. */}
            <div className="border-t border-white/10 px-5 py-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t("nav.account")}
              </p>
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white"
                >
                  {accountInitial}
                </span>
                <div className="min-w-0 flex-1">
                  {user?.name && (
                    <p className="truncate text-sm font-medium text-white">
                      {user.name}
                    </p>
                  )}
                  {user?.email && (
                    <p className="truncate text-xs text-slate-400">
                      {user.email}
                    </p>
                  )}
                </div>
                <SafeSignOutButton className="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 hover:text-white" />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
