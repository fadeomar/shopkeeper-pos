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
import { useAppPermissions } from '@/lib/hooks/use-app-permissions';

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
  { href: '/purchases',     key: 'nav.purchaseHistory', icon: ReceiptText },
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
  const permissions = useAppPermissions();
  const visibleRoutes = routes.filter((route) => permissions.canAccessRoute(route.href));
  const activeShift = useLiveQuery(
    () => db.shifts.where('status').equals('open').first(),
    [],
  );

  function isActive(href: string) {
    if (href === '/') return pathname === '/';
    // /purchases and /purchases/new are separate top-level actions.
    // Keep history from looking active while the cashier is receiving stock.
    if (href === '/purchases') return pathname === '/purchases';
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    // hidden on mobile — MobileBottomNav handles routing below lg.
    <nav
      aria-label={t('nav.mainNavLabel')}
      className="hidden lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:gap-1 lg:overflow-y-auto lg:px-3 lg:py-2"
    >
      {visibleRoutes.map(({ href, key, icon: Icon }) => {
        const active = isActive(href);
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
                    // Active = brand-tinted fill + accent bar + faint inset ring.
                    // Distinct enough from hover that "I am here" never reads as
                    // "I can click this".
                    'bg-brand/20 text-white',
                    'shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-brand)_35%,transparent)]',
                    // 3px brand bar on the inline-start edge for scannability.
                    'before:absolute before:inset-y-2 before:start-0',
                    'before:w-[3px] before:rounded-full before:bg-brand',
                  ]
                : // Hover = barely-there wash; clearly weaker than the active fill.
                  'text-slate-300 hover:bg-white/[0.045] hover:text-slate-100',
            )}
          >
            <Icon
              size={18}
              strokeWidth={active ? 2.25 : 2}
              aria-hidden
              className={clsx(
                'shrink-0 transition-colors',
                active ? 'text-white' : 'text-slate-400 group-hover:text-slate-200',
              )}
            />
            <span className="flex-1 truncate">{t(key)}</span>
            {showShiftDot && (
              <span className="inline-flex items-center">
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full bg-success"
                  aria-hidden
                />
                <span className="sr-only">{t('nav.shiftOpen')}</span>
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
