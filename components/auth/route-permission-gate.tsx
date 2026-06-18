'use client';

import type { ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/components/providers/auth-context';
import { useAppPermissions } from '@/lib/hooks/use-app-permissions';
import { canAccessRoute } from '@/lib/permissions/permission-engine';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/components/providers/locale-context';

function AccessDenied() {
  const { t } = useLocale();
  return (
    <Card className="mx-auto mt-8 max-w-xl p-6 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft/15 text-danger-soft">
        <ShieldAlert size={24} aria-hidden />
      </div>
      <h1 className="text-lg font-semibold text-slate-900">{t('auth.accessDeniedTitle')}</h1>
      <p className="mt-2 text-sm text-slate-600">
        {t('auth.accessDeniedDescription')}
      </p>
      <Button type="button" className="mt-5" onClick={() => window.history.back()}>
        {t('common.back')}
      </Button>
    </Card>
  );
}

export function RoutePermissionGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const permissions = useAppPermissions();
  if (!canAccessRoute(user?.role, permissions, pathname)) return <AccessDenied />;
  return <>{children}</>;
}
