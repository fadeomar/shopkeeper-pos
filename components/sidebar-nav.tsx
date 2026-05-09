'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { useLocale } from '@/components/providers/locale-context';

const routes = [
  { href: '/',          key: 'nav.dashboard'   },
  { href: '/products',  key: 'nav.products'    },
  { href: '/billing',   key: 'nav.newBill'     },
  { href: '/bills',     key: 'nav.billHistory' },
  { href: '/settings',  key: 'nav.settings'    },
] as const;

export function SidebarNav() {
  const pathname = usePathname();
  const { t } = useLocale();

  return (
    <nav
      className={clsx(
        'flex flex-row overflow-x-auto gap-1 px-3 py-2',
        'lg:flex-col lg:px-3 lg:py-2 lg:overflow-x-visible lg:flex-1',
      )}
    >
      {routes.map(({ href, key }) => {
        const active = pathname === href || (href !== '/' && pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            className={clsx(
              'whitespace-nowrap px-3 py-2 rounded-xl text-sm font-medium transition-colors',
              'lg:w-full',
              active
                ? 'bg-blue-600 text-white'
                : 'text-slate-300 hover:bg-white/10 hover:text-white',
            )}
          >
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
