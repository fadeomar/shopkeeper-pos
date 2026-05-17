'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { useLocale } from '@/components/providers/locale-context';

const routes = [
  { href: '/',          key: 'nav.dashboard',   shortKey: 'navShort.dashboard' },
  { href: '/billing',   key: 'nav.newBill',     shortKey: 'navShort.newBill' },
  { href: '/bills',     key: 'nav.billHistory', shortKey: 'navShort.billHistory' },
  { href: '/purchases/new', key: 'nav.newPurchase', shortKey: 'navShort.newPurchase' },
  { href: '/products',  key: 'nav.products',    shortKey: 'navShort.products' },
  { href: '/inventory', key: 'nav.inventory',   shortKey: 'navShort.inventory' },
  { href: '/reports',   key: 'nav.reports',     shortKey: 'navShort.reports' },
  { href: '/customers', key: 'nav.customers',   shortKey: 'navShort.customers' },
  { href: '/suppliers', key: 'nav.suppliers',   shortKey: 'navShort.suppliers' },
  { href: '/shift',     key: 'nav.shift',       shortKey: 'navShort.shift' },
  { href: '/settings',  key: 'nav.settings',    shortKey: 'navShort.settings' },
] as const;

export function SidebarNav() {
  const pathname = usePathname();
  const { t } = useLocale();

  return (
    <nav
      className={clsx(
        'flex flex-row overflow-x-auto gap-1 px-3 py-2 no-scrollbar snap-x',
        'lg:flex-col lg:px-3 lg:py-2 lg:overflow-x-visible lg:flex-1 lg:snap-none',
      )}
    >
      {routes.map(({ href, key, shortKey }) => {
        const active = pathname === href || (href !== '/' && pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={href as any}
            className={clsx(
              'whitespace-nowrap px-3 py-2.5 rounded-xl text-sm font-medium transition-colors snap-start',
              'min-w-[76px] text-center lg:min-w-0 lg:text-start lg:w-full',
              active
                ? 'bg-blue-600 text-white'
                : 'text-slate-300 hover:bg-white/10 hover:text-white',
            )}
          >
            <span className="lg:hidden">{t(shortKey)}</span>
            <span className="hidden lg:inline">{t(key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
