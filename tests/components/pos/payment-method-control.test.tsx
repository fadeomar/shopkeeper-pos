import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PaymentMethodControl } from '@/components/pos/payment-method-control';
import { renderWithLocale } from '@/tests/helpers/render';
import { useState, type FormEvent } from 'react';

function ControlledPaymentControl({ available }: { available?: readonly ('cash' | 'card' | 'credit')[] }) {
  const [value, setValue] = useState<'cash' | 'card' | 'credit'>('cash');
  return (
    <PaymentMethodControl
      value={value}
      onChange={setValue}
      label="Payment method"
      available={available}
    />
  );
}

describe('PaymentMethodControl', () => {
  it('renders cash/card/credit as radio options and never exposes mixed payment', () => {
    renderWithLocale(<ControlledPaymentControl />);

    expect(screen.getByRole('radiogroup', { name: /payment method/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /cash/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /card/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /credit/i })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /mixed/i })).not.toBeInTheDocument();
  });

  it('selects a payment method without submitting the surrounding form', async () => {
    const user = userEvent.setup();
    const submit = vi.fn((e: FormEvent) => e.preventDefault());
    renderWithLocale(
      <form onSubmit={submit}>
        <ControlledPaymentControl />
      </form>,
    );

    await user.click(screen.getByRole('radio', { name: /card/i }));

    expect(screen.getByRole('radio', { name: /card/i })).toHaveAttribute('aria-checked', 'true');
    expect(submit).not.toHaveBeenCalled();
  });

  it('honors available payment-method settings', () => {
    renderWithLocale(<ControlledPaymentControl available={['cash', 'credit']} />);

    expect(screen.getByRole('radio', { name: /cash/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /credit/i })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /card/i })).not.toBeInTheDocument();
  });

  it('shows a clear settings error when all payment methods are disabled', () => {
    renderWithLocale(<ControlledPaymentControl available={[]} />);

    expect(screen.getByText(/at least one payment method/i)).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });
});
