'use client';

/**
 * PaymentMethodControl — 4-button segmented tap control replacing the
 * SearchableSelect dropdown for payment method selection.
 *
 * Designed for touch-first POS use: large tap targets, instant visual
 * feedback, no extra tap to open a dropdown. Renders 2 per row on mobile
 * and one row of N on sm+ screens, where N is the number of enabled methods.
 *
 * The `available` prop gates which methods render — it is driven by the
 * store's payment-method settings (enableCash/enableCard/enableCredit), so a
 * disabled method is never selectable. When omitted, all four render.
 *
 * ARIA: uses role="radiogroup" + role="radio" + aria-checked so the
 * selection is announced correctly by screen readers.
 */

import clsx from 'clsx';
import { Banknote, CreditCard, Clock } from 'lucide-react';
import { useLocale } from '@/components/providers/locale-context';
import type { LucideIcon } from 'lucide-react';

type PaymentMethod = 'cash' | 'card' | 'mixed' | 'credit';

interface PaymentOption {
  value: PaymentMethod;
  icon: LucideIcon;
  labelKey: string;
}

// Static col-count classes (kept literal so Tailwind's JIT scanner sees them).
const SM_COLS: Record<number, string> = {
  1: 'sm:grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
};

// Icon choices:
//   Banknote → Cash: physical note, universal "cash" metaphor
//   CreditCard → Card: self-evident
//   Clock → Credit: deferred payment / "pay later"
// NOTE: "mixed" is intentionally omitted — it is no longer offered as a payment
// option (it confused cashiers). The PaymentMethod type still includes 'mixed'
// so historical bills saved as mixed continue to display/aggregate correctly.
const OPTIONS: readonly PaymentOption[] = [
  { value: 'cash',   icon: Banknote,    labelKey: 'common.cash'   },
  { value: 'card',   icon: CreditCard,  labelKey: 'common.card'   },
  { value: 'credit', icon: Clock,       labelKey: 'common.credit' },
] as const;

interface Props {
  value: PaymentMethod;
  onChange: (value: PaymentMethod) => void;
  /** aria-label for the radiogroup — pass t('billing.paymentMethod') */
  label: string;
  /**
   * Which methods to show, in render order. Defaults to all four.
   * Driven by store payment-method settings so disabled methods never appear.
   */
  available?: readonly PaymentMethod[];
}

export function PaymentMethodControl({
  value,
  onChange,
  label,
  available,
}: Props) {
  const { t } = useLocale();

  const options = available
    ? OPTIONS.filter((o) => available.includes(o.value))
    : OPTIONS;
  // Fall back to all options if a bad/empty list was passed (never render none).
  const visible = options.length > 0 ? options : OPTIONS;

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={clsx(
        'grid grid-cols-2 gap-1.5',
        SM_COLS[visible.length] ?? 'sm:grid-cols-4',
      )}
    >
      {visible.map(({ value: v, icon: Icon, labelKey }) => {
        const active = value === v;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(v)}
            className={clsx(
              'flex flex-col items-center gap-1.5 rounded-xl border px-2 py-2.5',
              'text-xs font-semibold transition-all',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30',
              active
                ? 'border-brand bg-brand text-white shadow-sm'
                : [
                    'border-border-default bg-surface text-slate-600',
                    'hover:border-border-strong hover:bg-surface-soft',
                    'active:bg-surface-muted',
                  ],
            )}
          >
            <Icon
              size={18}
              strokeWidth={active ? 2.25 : 2}
              aria-hidden
              className="shrink-0"
            />
            <span className="leading-none">{t(labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}
