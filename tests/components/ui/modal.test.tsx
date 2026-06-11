import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from '@/components/ui/modal';
import { renderWithLocale } from '@/tests/helpers/render';

function TestModal({ onClose = vi.fn(), open = true }: { onClose?: () => void; open?: boolean }) {
  return (
    <Modal
      open={open}
      title="Confirm action"
      description="This action needs confirmation"
      onClose={onClose}
      footer={<button type="button">Save changes</button>}
      presentation="centered"
    >
      <button type="button">First body action</button>
      <button type="button">Last body action</button>
    </Modal>
  );
}

describe('Modal', () => {
  it('renders through a portal only when open', () => {
    const { rerender } = renderWithLocale(<TestModal open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(<TestModal open />);
    expect(screen.getByRole('dialog', { name: /confirm action/i })).toBeInTheDocument();
    expect(screen.getByText(/this action needs confirmation/i)).toBeInTheDocument();
  });

  it('locks body scroll while open and restores it on unmount', () => {
    const { unmount } = renderWithLocale(<TestModal />);

    expect(document.body).toHaveAttribute('data-asas-scroll-locked', 'true');
    expect(document.body.style.overflow).toBe('hidden');

    unmount();

    expect(document.body).not.toHaveAttribute('data-asas-scroll-locked');
    expect(document.body.style.overflow).toBe('');
  });

  it('closes with Escape, backdrop click, and the icon close button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithLocale(<TestModal onClose={onClose} />);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(2);

    const backdrop = document.querySelector<HTMLElement>('[role="presentation"]');
    expect(backdrop).not.toBeNull();
    await user.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('keeps keyboard focus inside the dialog when tabbing around', async () => {
    const user = userEvent.setup();
    renderWithLocale(<TestModal />);

    const closeButton = screen.getByRole('button', { name: /close/i });
    const saveButton = screen.getByRole('button', { name: /save changes/i });

    await waitFor(() => expect(closeButton).toHaveFocus());

    saveButton.focus();
    await user.tab();
    expect(closeButton).toHaveFocus();

    await user.tab({ shift: true });
    expect(saveButton).toHaveFocus();
  });
});
