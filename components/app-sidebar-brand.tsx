'use client';

import { useSettings } from '@/components/providers/settings-context';
import { useLocale } from '@/components/providers/locale-context';

export function AppSidebarBrand() {
  const { settings } = useSettings();
  const { t } = useLocale();

  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-lg font-bold text-white tracking-tight">
        {t('sidebar.title')}
      </h1>
      <p className="text-xs text-slate-400">
        {settings?.storeName?.trim() || t('sidebar.subtitle')}
      </p>
    </div>
  );
}
