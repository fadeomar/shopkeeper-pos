'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { useLocale } from '@/components/providers/locale-context';

const routes = [
  { href: '/',          key: 'nav.dashboard',   short: 'Home'      },
  { href: '/billing',   key: 'nav.newBill',     short: 'Sell'      },
  { href: '/bills',     key: 'nav.billHistory', short: 'Bills'     },
  { href: '/products',  key: 'nav.products',    short: 'Products'  },
  { href: '/inventory', key: 'nav.inventory',   short: 'Stock'     },
  { href: '/reports',   key: 'nav.reports',     short: 'Reports'   },
  { href: '/customers', key: 'nav.customers',   short: 'Customers' },
  { href: '/suppliers', key: 'nav.suppliers',   short: 'Suppliers' },
  { href: '/shift',     key: 'nav.shift',       short: 'Shift'     },
  { href: '/settings',  key: 'nav.settings',    short: 'Settings'  },
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
      {routes.map(({ href, key, short }) => {
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
            <span className="lg:hidden">{short}</span>
            <span className="hidden lg:inline">{t(key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
