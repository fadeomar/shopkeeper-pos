import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/searchable-select';
import { renderWithLocale } from '@/tests/helpers/render';
import { useState } from 'react';

const options: SearchableSelectOption[] = [
  { value: 'apple', label: 'Apple Juice', description: 'Drinks' },
  { value: 'banana', label: 'Banana', description: 'Fruit' },
  { value: 'bread', label: 'Bread', description: 'Bakery' },
  { value: 'disabled', label: 'Disabled item', disabled: true },
];

function ControlledSearchableSelect({ clearable = false }: { clearable?: boolean }) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <SearchableSelect
      name="productId"
      options={options}
      value={value}
      onValueChange={setValue}
      placeholder="Choose product"
      searchPlaceholder="Search product"
      clearable={clearable}
    />
  );
}

describe('SearchableSelect', () => {
  it('opens via portal, filters options, and selects by click', async () => {
    const user = userEvent.setup();
    renderWithLocale(<ControlledSearchableSelect />);

    await user.click(screen.getByRole('button', { name: /choose product/i }));
    const search = await screen.findByRole('combobox', { name: /search product/i });
    await user.type(search, 'ban');

    expect(screen.getByRole('option', { name: /banana/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /apple juice/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: /banana/i }));

    expect(screen.queryByRole('combobox', { name: /search product/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /banana/i })).toBeInTheDocument();
    expect(document.querySelector<HTMLInputElement>('input[name="productId"]')?.value).toBe('banana');
  });

  it('supports keyboard navigation and Enter selection', async () => {
    const user = userEvent.setup();
    renderWithLocale(<ControlledSearchableSelect />);

    await user.click(screen.getByRole('button', { name: /choose product/i }));
    const search = await screen.findByRole('combobox', { name: /search product/i });
    await waitFor(() => expect(search).toHaveFocus());
    await user.keyboard('{ArrowDown}{Enter}');

    expect(search).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /banana/i })).toBeInTheDocument();
  });

  it('does not select disabled options', async () => {
    const user = userEvent.setup();
    renderWithLocale(<ControlledSearchableSelect />);

    await user.click(screen.getByRole('button', { name: /choose product/i }));
    const search = await screen.findByRole('combobox', { name: /search product/i });
    await user.type(search, 'disabled');
    await user.click(screen.getByRole('option', { name: /disabled item/i }));

    expect(screen.getByRole('combobox', { name: /search product/i })).toBeInTheDocument();
    expect(document.querySelector<HTMLInputElement>('input[name="productId"]')?.value).toBe('');
  });

  it('can clear an already selected value', async () => {
    const user = userEvent.setup();
    renderWithLocale(<ControlledSearchableSelect clearable />);

    await user.click(screen.getByRole('button', { name: /choose product/i }));
    await user.click(await screen.findByRole('option', { name: /apple juice/i }));
    expect(document.querySelector<HTMLInputElement>('input[name="productId"]')?.value).toBe('apple');

    await user.click(screen.getByRole('button', { name: /apple juice/i }));
    await user.click(await screen.findByRole('button', { name: /clear/i }));

    expect(screen.getByRole('button', { name: /choose product/i })).toBeInTheDocument();
    expect(document.querySelector<HTMLInputElement>('input[name="productId"]')?.value).toBe('');
  });

  it('does not auto-focus the search input in mobile sheet mode', async () => {
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: query.includes('max-width'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const user = userEvent.setup();
    renderWithLocale(<ControlledSearchableSelect />);

    const trigger = screen.getByRole('button', { name: /choose product/i });
    await user.click(trigger);
    await screen.findByRole('dialog');

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /search product/i })).not.toHaveFocus();
    });

    matchMedia.mockRestore();
  });
});
