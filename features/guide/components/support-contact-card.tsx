"use client";

/**
 * SupportContactCard — the "reach the operator" block for the public guide.
 * Every action is a plain <a href> (wa.me / tel: / mailto:) so it works fully
 * offline and needs no JS. Each link only renders if its channel is configured
 * in lib/config/support.ts; otherwise a gentle fallback line shows.
 *
 * Stock Tailwind classes only; inline-SVG icons (no lucide).
 */

import { useLocale } from "@/components/providers/locale-context";
import {
  hasAnySupportContact,
  buildWhatsappUrl,
  buildTelUrl,
  buildMailtoUrl,
} from "@/lib/config/support";
import {
  ChatIcon,
  PhoneIcon,
  MailIcon,
  UserPlusIcon,
} from "@/features/guide/components/icons";

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "";

export function SupportContactCard() {
  const { t, locale } = useLocale();

  const context = ` [v${APP_VERSION} · ${locale}]`;
  const whatsappUrl = buildWhatsappUrl();
  const telUrl = buildTelUrl();
  const mailtoUrl = buildMailtoUrl({
    subject: t("guide.support.emailSubject"),
    body: context.trim(),
  });
  const requestUrl = buildWhatsappUrl(t("guide.support.requestPrefill") + context);

  const actions: {
    key: string;
    href: string | null;
    label: string;
    icon: React.ReactNode;
    primary?: boolean;
  }[] = [
    {
      key: "request",
      href: requestUrl ?? whatsappUrl,
      label: t("guide.support.requestUser"),
      icon: <UserPlusIcon size={18} />,
      primary: true,
    },
    {
      key: "whatsapp",
      href: whatsappUrl,
      label: t("guide.support.whatsapp"),
      icon: <ChatIcon size={18} />,
    },
    {
      key: "call",
      href: telUrl,
      label: t("guide.support.call"),
      icon: <PhoneIcon size={18} />,
    },
    {
      key: "email",
      href: mailtoUrl,
      label: t("guide.support.email"),
      icon: <MailIcon size={18} />,
    },
  ];

  const visible = actions.filter((a) => a.href);

  if (!hasAnySupportContact() || visible.length === 0) {
    return (
      <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-500">
        {t("guide.support.none")}
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {visible.map((a) => (
        <a
          key={a.key}
          href={a.href as string}
          target="_blank"
          rel="noopener noreferrer"
          className={
            "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 " +
            (a.primary
              ? "bg-blue-600 text-white hover:bg-blue-700"
              : "bg-slate-100 text-slate-700 hover:bg-slate-200")
          }
        >
          {a.icon}
          {a.label}
        </a>
      ))}
    </div>
  );
}
