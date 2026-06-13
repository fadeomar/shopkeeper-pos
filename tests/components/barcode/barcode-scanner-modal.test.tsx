import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BarcodeScannerModal } from '@/components/barcode/barcode-scanner-modal';
import { renderWithLocale } from '@/tests/helpers/render';

function renderScanner(props: Partial<ComponentProps<typeof BarcodeScannerModal>> = {}) {
  return renderWithLocale(
    <BarcodeScannerModal
      open
      title="Scan barcode"
      description="Point the camera at the barcode"
      onClose={vi.fn()}
      onDetected={vi.fn()}
      {...props}
    />,
  );
}

describe('BarcodeScannerModal', () => {
  it('does not render when closed', () => {
    renderWithLocale(
      <BarcodeScannerModal open={false} onClose={vi.fn()} onDetected={vi.fn()} title="Scan barcode" />,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('blurs the active input before opening the camera to prevent mobile keyboard overlap', async () => {
    const { rerender } = renderWithLocale(
      <>
        <input aria-label="Barcode input behind modal" />
        <BarcodeScannerModal open={false} onClose={vi.fn()} onDetected={vi.fn()} title="Scan barcode" />
      </>,
    );

    const behindInput = screen.getByRole('textbox', { name: /barcode input behind modal/i });
    behindInput.focus();
    expect(behindInput).toHaveFocus();

    rerender(
      <>
        <input aria-label="Barcode input behind modal" />
        <BarcodeScannerModal open onClose={vi.fn()} onDetected={vi.fn()} title="Scan barcode" />
      </>,
    );

    await waitFor(() => {
      expect(behindInput).not.toHaveFocus();
    });
    expect(screen.getByRole('dialog', { name: /scan barcode/i })).toBeInTheDocument();
  });

  it('shows unsupported camera state without getUserMedia', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: undefined,
    });

    renderScanner();

    expect(await screen.findByText(/no camera found/i)).toBeInTheDocument();
  });

  it('shows a permission message when the camera request is denied', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockRejectedValue(new Error('NotAllowedError: permission denied')),
      },
    });

    renderScanner();

    expect(await screen.findByText(/camera access denied/i)).toBeInTheDocument();
  });

  it('closes from Escape, backdrop click, and done button in continuous mode', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderScanner({ onClose, continuous: true });

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('dialog', { name: /scan barcode/i }));
    expect(onClose).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole('button', { name: /done scanning/i }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
