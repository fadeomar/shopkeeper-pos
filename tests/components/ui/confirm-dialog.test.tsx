import type { FormEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { renderWithLocale } from '@/tests/helpers/render';

function renderDialog(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const props = {
    open: true,
    title: 'Delete bill',
    description: 'This cannot be undone',
    confirmLabel: 'Delete',
    cancelLabel: 'Keep bill',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  const result = renderWithLocale(<ConfirmDialog {...props} />);
  return { ...result, props };
}

describe('ConfirmDialog', () => {
  it('renders title, description, and footer actions only when open', () => {
    const { rerender, props } = renderDialog({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(<ConfirmDialog {...props} open />);
    expect(screen.getByRole('dialog', { name: /delete bill/i })).toBeInTheDocument();
    expect(screen.getByText(/this cannot be undone/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /keep bill/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('calls confirm and cancel callbacks without submitting a parent form', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    renderWithLocale(
      <form onSubmit={onSubmit}>
        <ConfirmDialog
          open
          title="Delete bill"
          description="This cannot be undone"
          confirmLabel="Delete"
          cancelLabel="Keep bill"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      </form>,
    );

    await user.click(screen.getByRole('button', { name: /delete/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /keep bill/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('routes Escape, close icon, and backdrop dismiss through onCancel', async () => {
    const user = userEvent.setup();
    const { props } = renderDialog();

    await user.keyboard('{Escape}');
    expect(props.onCancel).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(props.onCancel).toHaveBeenCalledTimes(2);

    const backdrop = document.querySelector<HTMLElement>('[role="presentation"]');
    expect(backdrop).not.toBeNull();
    await user.click(backdrop!);
    expect(props.onCancel).toHaveBeenCalledTimes(3);
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it('disables the confirm action while loading', async () => {
    const user = userEvent.setup();
    const { props } = renderDialog({ loading: true });
    const confirmButton = screen.getByRole('button', { name: /delete/i });

    expect(confirmButton).toBeDisabled();
    expect(confirmButton).toHaveAttribute('aria-busy', 'true');
    await user.click(confirmButton);

    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it('maps tone to the intended visual button variant', () => {
    const { rerender } = renderWithLocale(
      <ConfirmDialog
        open
        title="Danger action"
        confirmLabel="Delete"
        tone="danger"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /delete/i })).toHaveClass('bg-danger-soft');

    rerender(
      <ConfirmDialog
        open
        title="Warning action"
        confirmLabel="Continue"
        tone="warning"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /continue/i })).toHaveClass('bg-warning-soft');

    rerender(
      <ConfirmDialog
        open
        title="Neutral action"
        confirmLabel="Confirm"
        tone="neutral"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /confirm/i })).toHaveClass('bg-brand');
  });

  it('keeps initial keyboard focus on the cancel/close area rather than triggering the destructive action', async () => {
    renderDialog({ tone: 'danger' });

    const closeButton = screen.getByRole('button', { name: /close/i });
    const confirmButton = screen.getByRole('button', { name: /delete/i });

    await waitFor(() => expect(closeButton).toHaveFocus());
    expect(confirmButton).not.toHaveFocus();
  });
});
