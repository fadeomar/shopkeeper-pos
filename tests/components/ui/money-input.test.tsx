import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm, useWatch } from 'react-hook-form';
import { MoneyInput, MoneyInputRHF } from '@/components/ui/money-input';
import { renderWithLocale } from '@/tests/helpers/render';

function ControlledMoneyInput({
  initial = 12.5,
  min,
  max,
  currency = 'ILS',
  onChange,
}: {
  initial?: number;
  min?: number;
  max?: number;
  currency?: string;
  onChange?: (value: number) => void;
}) {
  const [value, setValue] = useState<number | ''>(initial);
  return (
    <MoneyInput
      aria-label="Paid amount"
      currency={currency}
      value={value}
      min={min}
      max={max}
      onValueChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

describe('MoneyInput', () => {
  it('renders a localized currency prefix and uses a decimal keyboard hint', () => {
    renderWithLocale(<ControlledMoneyInput currency="ILS" />);

    const input = screen.getByRole('textbox', { name: /paid amount/i });
    expect(input).toHaveAttribute('inputMode', 'decimal');
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByText('₪')).toBeInTheDocument();
  });

  it('keeps focus and accepts multi-digit decimal typing without auto-blur', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithLocale(<ControlledMoneyInput initial={2} onChange={onChange} />);

    const input = screen.getByRole('textbox', { name: /paid amount/i });
    await user.click(input);
    await user.keyboard('51.75');

    expect(input).toHaveFocus();
    expect(input).toHaveValue('51.75');
    expect(onChange).toHaveBeenLastCalledWith(51.75);
  });

  it('accepts comma decimals and Arabic-Indic digits from Arabic keyboards', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithLocale(<ControlledMoneyInput initial={0} onChange={onChange} />);

    const input = screen.getByRole('textbox', { name: /paid amount/i });
    await user.clear(input);
    await user.type(input, '١٢,٥');

    expect(input).toHaveValue('١٢,٥');
    expect(onChange).toHaveBeenLastCalledWith(12.5);
  });

  it('does not emit invalid alphanumeric input while the cashier is editing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithLocale(<ControlledMoneyInput initial={10} onChange={onChange} />);

    const input = screen.getByRole('textbox', { name: /paid amount/i });
    await user.clear(input);
    await user.type(input, '12abc');

    expect(input).toHaveValue('12abc');
    // The clean prefix "12" emits once, but the invalid full buffer must not
    // overwrite the last valid business value with NaN or 0 while focused.
    expect(onChange).toHaveBeenLastCalledWith(12);
    expect(onChange).not.toHaveBeenCalledWith(Number.NaN);
  });

  it('commits invalid or empty values back to 0.00 on blur by default', async () => {
    const user = userEvent.setup();
    renderWithLocale(<ControlledMoneyInput initial={10} />);

    const input = screen.getByRole('textbox', { name: /paid amount/i });
    await user.clear(input);
    expect(input).toHaveValue('');

    await user.tab();
    expect(input).toHaveValue('0.00');

    await user.click(input);
    await user.keyboard('abc');
    await user.tab();
    expect(input).toHaveValue('0.00');
  });

  it('clamps to min/max and formats to two decimals only on blur', async () => {
    const user = userEvent.setup();
    renderWithLocale(<ControlledMoneyInput initial={5} min={1} max={99.99} />);

    const input = screen.getByRole('textbox', { name: /paid amount/i });
    await user.clear(input);
    await user.type(input, '100.987');
    expect(input).toHaveValue('100.987');

    await user.tab();
    expect(input).toHaveValue('99.99');
  });

  it('prevents mouse wheel changes on focused money fields', async () => {
    const user = userEvent.setup();
    renderWithLocale(<ControlledMoneyInput initial={33} />);

    const input = screen.getByRole('textbox', { name: /paid amount/i });
    await user.click(input);
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 });
    const preventDefault = vi.spyOn(wheel, 'preventDefault');
    input.dispatchEvent(wheel);

    // The wheel is blocked rather than blurring the field — trackpad users
    // scrolling the page shouldn't lose focus mid-entry.
    expect(preventDefault).toHaveBeenCalled();
    expect(input).toHaveFocus();
    expect(input).toHaveValue('33.00');
  });
});

describe('MoneyInputRHF', () => {
  function FormProbe({ onAfterChange = vi.fn() }: { onAfterChange?: (value: number) => void }) {
    const form = useForm<{ amount: number | '' }>({ defaultValues: { amount: 7.5 } });
    const watchedAmount = useWatch({ control: form.control, name: 'amount' });
    return (
      <form>
        <MoneyInputRHF
          name="amount"
          control={form.control}
          currency="USD"
          aria-label="RHF amount"
          onAfterChange={onAfterChange}
        />
        <output aria-label="watched amount">{String(watchedAmount)}</output>
      </form>
    );
  }

  it('binds to react-hook-form and calls onAfterChange with the parsed value', async () => {
    const user = userEvent.setup();
    const onAfterChange = vi.fn();
    renderWithLocale(<FormProbe onAfterChange={onAfterChange} />);

    const input = screen.getByRole('textbox', { name: /rhf amount/i });
    await user.clear(input);
    await user.type(input, '22.25');

    expect(onAfterChange).toHaveBeenLastCalledWith(22.25);
    await waitFor(() => {
      expect(screen.getByLabelText(/watched amount/i)).toHaveTextContent('22.25');
    });
  });
});
