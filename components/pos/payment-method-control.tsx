'use client';

/**
 * PaymentMethodControl — segmented tap control for active payment methods.
 *
 * Mixed payment was removed after user testing showed it is not needed. The
 * historical `mixed` value is still supported in read-only reports/receipts, but
 * this control only lets cashiers create cash, card, or credit transactions.
 */

import clsx from 'clsx';
import { Banknote, CreditCard, Clock } from 'lucide-react';
import { useLocale } from '@/components/providers/locale-context';
import type { LucideIcon } from 'lucide-react';

type ActivePaymentMethod = 'cash' | 'card' | 'credit';

interface PaymentOption {
  value: ActivePaymentMethod;
  icon: LucideIcon;
  labelKey: string;
}

// Static col-count classes (kept literal so Tailwind's JIT scanner sees them).
const SM_COLS: Record<number, string> = {
  1: 'sm:grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
};

const OPTIONS: readonly PaymentOption[] = [
  { value: 'cash', icon: Banknote, labelKey: 'common.cash' },
  { value: 'card', icon: CreditCard, labelKey: 'common.card' },
  { value: 'credit', icon: Clock, labelKey: 'common.credit' },
] as const;

interface Props {
  value: ActivePaymentMethod;
  onChange: (value: ActivePaymentMethod) => void;
  /** aria-label for the radiogroup — pass t('billing.paymentMethod') */
  label: string;
  /** Which methods to show, in render order. */
  available?: readonly ActivePaymentMethod[];
}

export function PaymentMethodControl({
  value,
  onChange,
  label,
  available,
}: Props) {
  const { t } = useLocale();

  const visible = available
    ? OPTIONS.filter((option) => available.includes(option.value))
    : OPTIONS;

  if (visible.length === 0) {
    return (
      <p className="rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-xs font-medium text-danger">
        {t('settings.atLeastOnePaymentMethod')}
      </p>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={clsx(
        'grid grid-cols-2 gap-1.5',
        SM_COLS[visible.length] ?? 'sm:grid-cols-3',
      )}
    >
      {visible.map(({ value: method, icon: Icon, labelKey }) => {
        const active = value === method;
        return (
          <button
            key={method}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(method)}
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
