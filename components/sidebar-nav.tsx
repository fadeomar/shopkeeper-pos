'use client';

/**
 * SidebarNav — desktop-only vertical navigation inside the dark sidebar.
 *
 * Mobile navigation is handled by MobileBottomNav (fixed bottom tab bar
 * + "More" sheet). This component is hidden on mobile via `hidden lg:flex`.
 *
 * Desktop active state: soft brand-tinted background + a 3px brand bar
 * on the inline-start edge, so the active route is scannable against the
 * dark sidebar without a hard filled background.
 *
 * The shift indicator (green dot) sits at the end of the Shift row so
 * cashiers can see at a glance whether a shift is open.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  LayoutDashboard,
  ShoppingCart,
  ReceiptText,
  Truck,
  Package,
  Boxes,
  BarChart3,
  Users,
  Store,
  Clock,
  Banknote,
  Wallet,
  History,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { db } from '@/lib/db/schema';
import { useLocale } from '@/components/providers/locale-context';

interface Route {
  href: string;
  key: string;
  icon: LucideIcon;
}

// Icon choices are intentional, not random:
//   - Dashboard:  LayoutDashboard — universal home/overview metaphor
//   - New Bill:   ShoppingCart    — the act of selling
//   - Bill History: ReceiptText   — printed receipts in a stack
//   - New Purchase: Truck         — restocking inventory from suppliers
//   - Products:   Package         — SKUs / catalogue
//   - Inventory:  Boxes           — what's on the shelves right now
//   - Reports:    BarChart3       — financial views
//   - Customers:  Users           — multiple people (vs Store)
//   - Suppliers:  Store           — vendor / external business
//   - Shift:      Clock           — time-bounded work session
//   - Cash:       Banknote        — physical money movements
//   - Expenses:   Wallet          — outflows from the till
//   - Audit:      History         — chronological log
//   - Settings:   Settings        — the canonical gear
const routes: readonly Route[] = [
  { href: '/',              key: 'nav.dashboard',   icon: LayoutDashboard },
  { href: '/billing',       key: 'nav.newBill',     icon: ShoppingCart },
  { href: '/bills',         key: 'nav.billHistory', icon: ReceiptText },
  { href: '/purchases/new', key: 'nav.newPurchase', icon: Truck },
  { href: '/products',      key: 'nav.products',    icon: Package },
  { href: '/inventory',     key: 'nav.inventory',   icon: Boxes },
  { href: '/reports',       key: 'nav.reports',     icon: BarChart3 },
  { href: '/customers',     key: 'nav.customers',   icon: Users },
  { href: '/suppliers',     key: 'nav.suppliers',   icon: Store },
  { href: '/shift',         key: 'nav.shift',       icon: Clock },
  { href: '/cash',          key: 'nav.cash',        icon: Banknote },
  { href: '/expenses',      key: 'nav.expenses',    icon: Wallet },
  { href: '/audit',         key: 'nav.audit',       icon: History },
  { href: '/settings',      key: 'nav.settings',    icon: Settings },
] as const;

export function SidebarNav() {
  const pathname = usePathname();
  const { t } = useLocale();
  const activeShift = useLiveQuery(
    () => db.shifts.where('status').equals('open').first(),
    [],
  );

  return (
    // hidden on mobile — MobileBottomNav handles routing below lg.
    <nav
      aria-label={t('nav.mainNavLabel')}
      className="hidden lg:flex lg:flex-col lg:flex-1 lg:px-3 lg:py-2"
    >
      {routes.map(({ href, key, icon: Icon }) => {
        const active = pathname === href || (href !== '/' && pathname.startsWith(href));
        const showShiftDot = href === '/shift' && Boolean(activeShift);

        return (
          <Link
            key={href}
            href={href as any}
            aria-current={active ? 'page' : undefined}
            className={clsx(
              'group relative flex items-center gap-3 w-full',
              'rounded-xl text-sm font-medium transition-all',
              'ps-4 pe-3 py-2.5',
              active
                ? [
                    'bg-white/10 text-white',
                    // 3px brand bar on the inline-start edge for scannability.
                    'before:absolute before:inset-y-2 before:start-0',
                    'before:w-[3px] before:rounded-full before:bg-brand',
                  ]
                : 'text-slate-300 hover:bg-white/10 hover:text-white',
            )}
          >
            <Icon
              size={18}
              strokeWidth={active ? 2.25 : 2}
              aria-hidden
              className={clsx(
                'shrink-0 transition-colors',
                active ? 'text-white/80' : 'text-slate-400 group-hover:text-white',
              )}
            />
            <span className="flex-1 truncate">{t(key)}</span>
            {showShiftDot && (
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full bg-success"
                aria-label={t('nav.shiftOpen')}
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
