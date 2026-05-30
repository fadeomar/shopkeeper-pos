"use client";

/**
 * PublicGuide — the logged-out /guide experience. Static content only: no
 * Dexie/Firestore, no counts, no links into app routes. The pages overview is
 * descriptive (no "Go to page"). CTAs are either "/" (sign in) or WhatsApp.
 *
 * Mobile-first single column with a sticky "Request access" action pinned to
 * the bottom; desktop reads as a centered narrative (PublicShell caps width).
 * Stock Tailwind classes only; inline-SVG icons (no lucide).
 */

import Link from "next/link";
import type { Route } from "next";
import { useLocale } from "@/components/providers/locale-context";
import { Accordion, AccordionItem } from "@/components/ui/accordion";
import { OfflineMatrix } from "@/features/guide/components/offline-matrix";
import { SupportContactCard } from "@/features/guide/components/support-contact-card";
import { buildWhatsappUrl } from "@/lib/config/support";
import {
  CartIcon,
  BoxesIcon,
  ChartIcon,
  UsersIcon,
  DeviceIcon,
  CheckIcon,
  XIcon,
  WifiOffIcon,
  DownloadIcon,
  UserPlusIcon,
  DashboardIcon,
  ReceiptIcon,
  PackageIcon,
  TruckIcon,
  StoreIcon,
  ClockIcon,
  SettingsIcon,
  ShieldIcon,
} from "@/features/guide/components/icons";

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "";

type IconCmp = (p: { size?: number }) => React.ReactNode;

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-black tracking-tight text-slate-900">{children}</h2>;
}

export function PublicGuide() {
  const { t, locale } = useLocale();

  const requestUrl =
    buildWhatsappUrl(
      t("guide.support.requestPrefill") + ` [v${APP_VERSION} · ${locale}]`,
    ) ?? null;

  const capabilities: { Icon: IconCmp; title: string; desc: string }[] = [
    { Icon: CartIcon, title: t("guide.public.canDoSellTitle"), desc: t("guide.public.canDoSellDesc") },
    { Icon: BoxesIcon, title: t("guide.public.canDoStockTitle"), desc: t("guide.public.canDoStockDesc") },
    { Icon: ChartIcon, title: t("guide.public.canDoNumbersTitle"), desc: t("guide.public.canDoNumbersDesc") },
    { Icon: UsersIcon, title: t("guide.public.canDoAccountsTitle"), desc: t("guide.public.canDoAccountsDesc") },
    { Icon: DeviceIcon, title: t("guide.public.canDoDevicesTitle"), desc: t("guide.public.canDoDevicesDesc") },
  ];

  const fitGreat = [
    t("guide.public.fitGreat1"),
    t("guide.public.fitGreat2"),
    t("guide.public.fitGreat3"),
    t("guide.public.fitGreat4"),
  ];
  const fitNot = [
    t("guide.public.fitNot1"),
    t("guide.public.fitNot2"),
    t("guide.public.fitNot3"),
    t("guide.public.fitNot4"),
  ];

  // Pages overview — descriptive only, NO deep links into app routes.
  const pages: { Icon: IconCmp; descKey: string }[] = [
    { Icon: DashboardIcon, descKey: "guide.public.pageDashboard" },
    { Icon: CartIcon, descKey: "guide.public.pageBilling" },
    { Icon: ReceiptIcon, descKey: "guide.public.pageBills" },
    { Icon: PackageIcon, descKey: "guide.public.pageProducts" },
    { Icon: TruckIcon, descKey: "guide.public.pagePurchases" },
    { Icon: BoxesIcon, descKey: "guide.public.pageInventory" },
    { Icon: UsersIcon, descKey: "guide.public.pageCustomers" },
    { Icon: StoreIcon, descKey: "guide.public.pageSuppliers" },
    { Icon: ClockIcon, descKey: "guide.public.pageShift" },
    { Icon: ChartIcon, descKey: "guide.public.pageReports" },
    { Icon: SettingsIcon, descKey: "guide.public.pageSettings" },
    { Icon: ShieldIcon, descKey: "guide.public.pageAdminUsers" },
  ];

  const installs = [
    { title: t("guide.public.installAndroidTitle"), steps: t("guide.public.installAndroidSteps") },
    { title: t("guide.public.installIosTitle"), steps: t("guide.public.installIosSteps") },
    { title: t("guide.public.installDesktopTitle"), steps: t("guide.public.installDesktopSteps") },
  ];

  const accessSteps = [
    { title: t("guide.public.accessStep1Title"), desc: t("guide.public.accessStep1Desc") },
    { title: t("guide.public.accessStep2Title"), desc: t("guide.public.accessStep2Desc") },
    { title: t("guide.public.accessStep3Title"), desc: t("guide.public.accessStep3Desc") },
  ];

  function splitPage(text: string): { lead: string; rest: string } {
    const idx = text.indexOf(" — ");
    if (idx === -1) return { lead: text, rest: "" };
    return { lead: text.slice(0, idx), rest: text.slice(idx + 3) };
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Hero */}
      <section className="flex flex-col gap-4 pt-2">
        <h1 className="text-3xl font-black leading-tight tracking-tight text-slate-900 sm:text-4xl">
          {t("guide.public.heroTitle")}
        </h1>
        <p className="text-base text-slate-600">{t("guide.public.heroSubtitle")}</p>
        <div className="flex flex-wrap gap-2">
          <a
            href={requestUrl ?? "#support"}
            target={requestUrl ? "_blank" : undefined}
            rel={requestUrl ? "noopener noreferrer" : undefined}
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-hover"
          >
            <UserPlusIcon size={18} />
            {t("guide.public.requestAccess")}
          </a>
          <Link
            href={"/" as Route}
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-slate-100 px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-200"
          >
            {t("guide.common.signIn")}
          </Link>
        </div>
      </section>

      {/* What you can do */}
      <section className="flex flex-col gap-4">
        <SectionTitle>{t("guide.public.canDoTitle")}</SectionTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {capabilities.map(({ Icon, title, desc }) => (
            <div
              key={title}
              className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                <Icon size={20} />
              </span>
              <div>
                <p className="text-sm font-bold text-slate-800">{title}</p>
                <p className="mt-0.5 text-sm text-slate-600">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Fit check */}
      <section className="flex flex-col gap-4">
        <SectionTitle>{t("guide.public.fitTitle")}</SectionTitle>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-success/20 bg-success-soft p-4">
            <p className="mb-3 text-sm font-bold text-success">{t("guide.public.fitGreatTitle")}</p>
            <ul className="flex flex-col gap-2">
              {fitGreat.map((line, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                  <span className="mt-0.5 shrink-0 text-success">
                    <CheckIcon size={16} />
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="mb-3 text-sm font-bold text-slate-500">{t("guide.public.fitNotTitle")}</p>
            <ul className="flex flex-col gap-2">
              {fitNot.map((line, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                  <span className="mt-0.5 shrink-0 text-slate-400">
                    <XIcon size={16} />
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="text-sm text-slate-500">{t("guide.public.fitUnsure")}</p>
      </section>

      {/* Pages overview — descriptive only, NO deep links */}
      <section className="flex flex-col gap-3">
        <SectionTitle>{t("guide.public.pagesTitle")}</SectionTitle>
        <p className="text-sm text-slate-500">{t("guide.public.pagesSubtitle")}</p>
        <Accordion>
          {pages.map(({ Icon, descKey }) => {
            const { lead, rest } = splitPage(t(descKey));
            return (
              <AccordionItem key={descKey} icon={<Icon size={18} />} title={lead}>
                {rest || lead}
              </AccordionItem>
            );
          })}
        </Accordion>
      </section>

      {/* Offline */}
      <section className="flex flex-col gap-4">
        <SectionTitle>{t("guide.public.offlineTitle")}</SectionTitle>
        <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-success-soft text-success">
            <WifiOffIcon size={20} />
          </span>
          <p className="text-sm text-slate-600">{t("guide.public.offlineBody")}</p>
        </div>
        <OfflineMatrix />
      </section>

      {/* PWA install */}
      <section className="flex flex-col gap-3">
        <SectionTitle>{t("guide.public.installTitle")}</SectionTitle>
        <p className="text-sm text-slate-500">{t("guide.public.installSubtitle")}</p>
        <Accordion>
          {installs.map((it, i) => (
            <AccordionItem
              key={i}
              icon={<DownloadIcon size={18} />}
              title={it.title}
              defaultOpen={i === 0}
            >
              {it.steps}
            </AccordionItem>
          ))}
        </Accordion>
        <p className="text-xs text-slate-500">{t("guide.public.installOptional")}</p>
      </section>

      {/* How to get access */}
      <section className="flex flex-col gap-4">
        <SectionTitle>{t("guide.public.accessTitle")}</SectionTitle>
        <ol className="flex flex-col gap-3">
          {accessSteps.map((step, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-bold text-slate-800">{step.title}</p>
                <p className="mt-0.5 text-sm text-slate-600">{step.desc}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="rounded-xl bg-info-soft px-4 py-3 text-sm text-info">
          {t("guide.public.accessManualNote")}
        </p>
      </section>

      {/* Support */}
      <section id="support" className="flex scroll-mt-20 flex-col gap-3">
        <SectionTitle>{t("guide.support.title")}</SectionTitle>
        <p className="text-sm text-slate-500">{t("guide.support.subtitle")}</p>
        <SupportContactCard />
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 pt-5 text-center text-xs text-slate-500">
        <p>{t("guide.common.privacyNote")}</p>
        {APP_VERSION && (
          <p className="mt-1" dir="ltr">
            {t("guide.common.versionLabel")} {APP_VERSION}
          </p>
        )}
      </footer>

      {/* Sticky mobile CTA */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-3 pt-3 pb-safe backdrop-blur sm:hidden">
        <a
          href={requestUrl ?? "#support"}
          target={requestUrl ? "_blank" : undefined}
          rel={requestUrl ? "noopener noreferrer" : undefined}
          className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-hover"
        >
          <UserPlusIcon size={18} />
          {t("guide.public.requestAccess")}
        </a>
      </div>
    </div>
  );
}
