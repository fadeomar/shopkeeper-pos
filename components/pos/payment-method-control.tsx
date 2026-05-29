'use client';

/**
 * PaymentMethodControl — 4-button segmented tap control replacing the
 * SearchableSelect dropdown for payment method selection.
 *
 * Designed for touch-first POS use: large tap targets, instant visual
 * feedback, no extra tap to open a dropdown. Renders as a 2×2 grid on
 * mobile and a single 4-column row on sm+ screens.
 *
 * ARIA: uses role="radiogroup" + role="radio" + aria-checked so the
 * selection is announced correctly by screen readers.
 */

import clsx from 'clsx';
import { Banknote, CreditCard, Coins, Clock } from 'lucide-react';
import { useLocale } from '@/components/providers/locale-context';
import type { LucideIcon } from 'lucide-react';

type PaymentMethod = 'cash' | 'card' | 'mixed' | 'credit';

interface PaymentOption {
  value: PaymentMethod;
  icon: LucideIcon;
  labelKey: string;
}

// Icon choices:
//   Banknote → Cash: physical note, universal "cash" metaphor
//   CreditCard → Card: self-evident
//   Coins → Mixed: coins + card together = mixed payment
//   Clock → Credit: deferred payment / "pay later"
const OPTIONS: readonly PaymentOption[] = [
  { value: 'cash',   icon: Banknote,    labelKey: 'common.cash'   },
  { value: 'card',   icon: CreditCard,  labelKey: 'common.card'   },
  { value: 'mixed',  icon: Coins,       labelKey: 'common.mixed'  },
  { value: 'credit', icon: Clock,       labelKey: 'common.credit' },
] as const;

interface Props {
  value: PaymentMethod;
  onChange: (value: PaymentMethod) => void;
  /** aria-label for the radiogroup — pass t('billing.paymentMethod') */
  label: string;
}

export function PaymentMethodControl({ value, onChange, label }: Props) {
  const { t } = useLocale();

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid grid-cols-2 sm:grid-cols-4 gap-1.5"
    >
      {OPTIONS.map(({ value: v, icon: Icon, labelKey }) => {
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
