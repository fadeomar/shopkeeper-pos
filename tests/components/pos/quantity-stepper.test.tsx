import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuantityStepper } from '@/components/pos/quantity-stepper';
import { renderWithLocale } from '@/tests/helpers/render';
import { useState } from 'react';

function ControlledQuantityStepper({ initial = 2, min = 0, max }: { initial?: number; min?: number; max?: number }) {
  const [value, setValue] = useState(initial);
  return (
    <QuantityStepper
      value={value}
      min={min}
      max={max}
      onChange={setValue}
      ariaLabel="Quantity under test"
    />
  );
}

describe('QuantityStepper', () => {
  it('keeps focus and supports multi-digit desktop typing', async () => {
    const user = userEvent.setup();
    renderWithLocale(<ControlledQuantityStepper initial={2} min={1} />);

    const input = screen.getByRole('textbox', { name: /quantity under test/i });
    await user.click(input);
    await user.keyboard('51');

    expect(input).toHaveFocus();
    expect(input).toHaveValue('51');
  });

  it('increments and decrements using touch-sized buttons', async () => {
    const user = userEvent.setup();
    renderWithLocale(<ControlledQuantityStepper initial={2} min={1} max={3} />);

    const input = screen.getByRole('textbox', { name: /quantity under test/i });
    const increase = screen.getByRole('button', { name: /increase/i });
    const decrease = screen.getByRole('button', { name: /decrease/i });

    await user.click(increase);
    expect(input).toHaveValue('3');
    expect(increase).toBeDisabled();

    await user.click(decrease);
    await user.click(decrease);
    expect(input).toHaveValue('1');
    expect(decrease).toBeDisabled();
  });

  it('commits an empty field back to the minimum value on blur', async () => {
    const user = userEvent.setup();
    renderWithLocale(<ControlledQuantityStepper initial={5} min={1} />);

    const input = screen.getByRole('textbox', { name: /quantity under test/i });
    await user.clear(input);
    expect(input).toHaveValue('');

    await user.tab();
    expect(input).toHaveValue('1');
  });

  it('does not allow mouse wheel to silently mutate the focused value', async () => {
    const user = userEvent.setup();
    const blurSpy = vi.spyOn(HTMLInputElement.prototype, 'blur');
    renderWithLocale(<ControlledQuantityStepper initial={4} min={1} />);

    const input = screen.getByRole('textbox', { name: /quantity under test/i });
    await user.click(input);
    input.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 }));

    expect(blurSpy).toHaveBeenCalled();
    expect(input).toHaveValue('4');
  });
});
