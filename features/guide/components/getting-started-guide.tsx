"use client";

import Link from "next/link";
import type { Route } from "next";
import { useAuth } from "@/components/providers/auth-context";
import { useLocale } from "@/components/providers/locale-context";
import {
  BoxesIcon,
  CartIcon,
  CheckIcon,
  ClockIcon,
  DeviceIcon,
  PackageIcon,
  ReceiptIcon,
  StoreIcon,
  SettingsIcon,
  TruckIcon,
  UsersIcon,
} from "@/features/guide/components/icons";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xl font-black tracking-tight text-slate-900">{children}</h2>;
}

function ActionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href as Route}
      className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-hover"
    >
      {children}
    </Link>
  );
}

export function GettingStartedGuide() {
  const { t } = useLocale();
  const { status } = useAuth();
  const authenticated = status === "authenticated";

  const actionHref = (href: string) => (authenticated ? href : "/");

  const scenarios = [
    {
      Icon: TruckIcon,
      tone: "bg-brand-soft text-brand",
      title: t("guide.gettingStarted.newStoreTitle"),
      desc: t("guide.gettingStarted.newStoreDesc"),
      steps: [
        t("guide.gettingStarted.newStoreStep1"),
        t("guide.gettingStarted.newStoreStep2"),
        t("guide.gettingStarted.newStoreStep3"),
      ],
      href: actionHref("/purchases/new"),
      action: authenticated
        ? t("guide.gettingStarted.newStoreAction")
        : t("guide.gettingStarted.signInAction"),
    },
    {
      Icon: BoxesIcon,
      tone: "bg-success-soft text-success",
      title: t("guide.gettingStarted.existingStockTitle"),
      desc: t("guide.gettingStarted.existingStockDesc"),
      steps: [
        t("guide.gettingStarted.existingStockStep1"),
        t("guide.gettingStarted.existingStockStep2"),
        t("guide.gettingStarted.existingStockStep3"),
      ],
      href: actionHref("/products"),
      action: authenticated
        ? t("guide.gettingStarted.existingStockAction")
        : t("guide.gettingStarted.signInAction"),
    },
    {
      Icon: ReceiptIcon,
      tone: "bg-info-soft text-info",
      title: t("guide.gettingStarted.spreadsheetTitle"),
      desc: t("guide.gettingStarted.spreadsheetDesc"),
      steps: [
        t("guide.gettingStarted.spreadsheetStep1"),
        t("guide.gettingStarted.spreadsheetStep2"),
        t("guide.gettingStarted.spreadsheetStep3"),
      ],
      href: actionHref("/products"),
      action: authenticated
        ? t("guide.gettingStarted.spreadsheetAction")
        : t("guide.gettingStarted.signInAction"),
    },
    {
      Icon: DeviceIcon,
      tone: "bg-warning-soft text-warning",
      title: t("guide.gettingStarted.migrationTitle"),
      desc: t("guide.gettingStarted.migrationDesc"),
      steps: [
        t("guide.gettingStarted.migrationStep1"),
        t("guide.gettingStarted.migrationStep2"),
        t("guide.gettingStarted.migrationStep3"),
      ],
      href: actionHref("/products"),
      action: authenticated
        ? t("guide.gettingStarted.migrationAction")
        : t("guide.gettingStarted.signInAction"),
    },
  ];

  const sharedSteps = [
    { Icon: SettingsIcon, title: t("guide.gettingStarted.commonStep1Title"), desc: t("guide.gettingStarted.commonStep1Desc") },
    { Icon: PackageIcon, title: t("guide.gettingStarted.commonStep2Title"), desc: t("guide.gettingStarted.commonStep2Desc") },
    { Icon: BoxesIcon, title: t("guide.gettingStarted.commonStep3Title"), desc: t("guide.gettingStarted.commonStep3Desc") },
    { Icon: ClockIcon, title: t("guide.gettingStarted.commonStep4Title"), desc: t("guide.gettingStarted.commonStep4Desc") },
    { Icon: CartIcon, title: t("guide.gettingStarted.commonStep5Title"), desc: t("guide.gettingStarted.commonStep5Desc") },
  ];

  const concepts = [
    { Icon: PackageIcon, title: t("guide.gettingStarted.productsTitle"), desc: t("guide.gettingStarted.productsDesc") },
    { Icon: TruckIcon, title: t("guide.gettingStarted.purchasesTitle"), desc: t("guide.gettingStarted.purchasesDesc") },
    { Icon: BoxesIcon, title: t("guide.gettingStarted.inventoryTitle"), desc: t("guide.gettingStarted.inventoryDesc") },
  ];

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4 pt-2">
        <Link href={"/guide" as Route} className="text-sm font-semibold text-brand hover:text-brand-hover">
          {t("guide.gettingStarted.backToGuide")}
        </Link>
        <div>
          <h1 className="text-3xl font-black leading-tight tracking-tight text-slate-900 sm:text-4xl">
            {t("guide.gettingStarted.heroTitle")}
          </h1>
          <p className="mt-2 max-w-2xl text-base text-slate-600">{t("guide.gettingStarted.heroSubtitle")}</p>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <SectionTitle>{t("guide.gettingStarted.chooseTitle")}</SectionTitle>
        <p className="text-sm text-slate-500">{t("guide.gettingStarted.chooseSubtitle")}</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {scenarios.map(({ Icon, tone, title, desc, steps, href, action }) => (
            <article key={title} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5">
              <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${tone}`}>
                <Icon size={21} />
              </span>
              <h3 className="mt-4 text-base font-bold text-slate-900">{title}</h3>
              <p className="mt-1 text-sm text-slate-600">{desc}</p>
              <ol className="mt-4 flex flex-1 flex-col gap-2">
                {steps.map((step, index) => (
                  <li key={step} className="flex items-start gap-2 text-sm text-slate-600">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-5">
                <ActionLink href={href}>{action}</ActionLink>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <SectionTitle>{t("guide.gettingStarted.commonTitle")}</SectionTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {sharedSteps.map(({ Icon, title, desc }, index) => (
            <div key={title} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                <Icon size={19} />
              </span>
              <div>
                <p className="text-xs font-bold text-brand">{t("guide.gettingStarted.stepLabel", { step: index + 1 })}</p>
                <p className="mt-0.5 text-sm font-bold text-slate-800">{title}</p>
                <p className="mt-1 text-sm text-slate-600">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <SectionTitle>{t("guide.gettingStarted.conceptsTitle")}</SectionTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {concepts.map(({ Icon, title, desc }) => (
            <div key={title} className="rounded-2xl border border-slate-200 bg-white p-4">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                <Icon size={18} />
              </span>
              <p className="mt-3 text-sm font-bold text-slate-800">{title}</p>
              <p className="mt-1 text-sm text-slate-600">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-success/20 bg-success-soft p-5">
          <div className="flex items-center gap-2 text-success">
            <CheckIcon size={18} />
            <h2 className="text-sm font-bold">{t("guide.gettingStarted.laterTitle")}</h2>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-700">
            <div className="flex items-center gap-2"><UsersIcon size={17} />{t("guide.gettingStarted.customersLater")}</div>
            <div className="flex items-center gap-2"><StoreIcon size={17} />{t("guide.gettingStarted.suppliersLater")}</div>
          </div>
          <p className="mt-3 text-sm text-slate-600">{t("guide.gettingStarted.laterDesc")}</p>
        </div>

        <div className="rounded-2xl border border-warning/25 bg-warning-soft p-5">
          <h2 className="text-sm font-bold text-warning">{t("guide.gettingStarted.migrationLimitTitle")}</h2>
          <p className="mt-2 text-sm text-slate-700">{t("guide.gettingStarted.migrationLimitDesc")}</p>
        </div>
      </section>

      {authenticated && (
        <section className="rounded-2xl border border-brand/20 bg-brand-soft p-5">
          <h2 className="text-base font-bold text-slate-900">{t("guide.gettingStarted.readyTitle")}</h2>
          <p className="mt-1 text-sm text-slate-600">{t("guide.gettingStarted.readyDesc")}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <ActionLink href="/purchases/new">{t("guide.gettingStarted.newStoreAction")}</ActionLink>
            <Link
              href={"/products" as Route}
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-50"
            >
              {t("guide.gettingStarted.existingStockAction")}
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
