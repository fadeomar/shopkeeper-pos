"use client";

/**
 * OfflineMatrix — the "what works offline / what needs internet" split.
 * Two tinted lists (green / blue) side by side on desktop, stacked on mobile,
 * plus the reassurance line. Stock Tailwind classes only; inline-SVG icons.
 */

import { useLocale } from "@/components/providers/locale-context";
import {
  WifiOffIcon,
  CloudIcon,
  CheckIcon,
} from "@/features/guide/components/icons";

export function OfflineMatrix() {
  const { t } = useLocale();

  const works = [
    t("guide.offline.works1"),
    t("guide.offline.works2"),
    t("guide.offline.works3"),
    t("guide.offline.works4"),
    t("guide.offline.works5"),
    t("guide.offline.works6"),
    t("guide.offline.works7"),
  ];
  const needs = [
    t("guide.offline.needs1"),
    t("guide.offline.needs2"),
    t("guide.offline.needs3"),
    t("guide.offline.needs4"),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-green-200 bg-green-50 p-4">
          <div className="mb-3 flex items-center gap-2 text-green-700">
            <WifiOffIcon size={18} />
            <h3 className="text-sm font-bold">{t("guide.offline.worksTitle")}</h3>
          </div>
          <ul className="flex flex-col gap-2">
            {works.map((line, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                <span className="mt-0.5 shrink-0 text-green-600">
                  <CheckIcon size={16} />
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <div className="mb-3 flex items-center gap-2 text-blue-700">
            <CloudIcon size={18} />
            <h3 className="text-sm font-bold">{t("guide.offline.needsTitle")}</h3>
          </div>
          <ul className="flex flex-col gap-2">
            {needs.map((line, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                <span className="mt-0.5 shrink-0 text-blue-600">
                  <CloudIcon size={16} />
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="rounded-xl bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">
        {t("guide.offline.reassurance")}
      </p>
    </div>
  );
}
