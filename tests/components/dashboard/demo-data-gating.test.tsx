import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/services/supplier-ledger-service', () => ({
  getSupplierLedger: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/db/seed', () => ({
  seedDemoData: vi.fn().mockResolvedValue({ inserted: true }),
}));

import DashboardPage from '@/app/page';
import { LocaleProvider } from '@/components/providers/locale-context';
import { ToastProvider } from '@/components/ui/toast';
import { resetTestDb, seedProduct } from '@/tests/helpers/db';

function renderDashboard() {
  return render(
    <LocaleProvider>
      <ToastProvider>
        <DashboardPage />
      </ToastProvider>
    </LocaleProvider>,
  );
}

describe('Dashboard demo data action', () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not expose demo data on the daily dashboard when the flag is off', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENABLE_DEMO_DATA', '0');

    renderDashboard();

    await screen.findByText('Welcome to Asas POS');
    expect(screen.queryByRole('button', { name: 'Initialize Demo Data' })).not.toBeInTheDocument();
  });

  it('shows demo data only for an explicitly enabled empty training workspace', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENABLE_DEMO_DATA', '1');

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Initialize Demo Data' })).toBeInTheDocument();
    });
  });

  it('hides demo data when real local business data already exists', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENABLE_DEMO_DATA', '1');
    await seedProduct({ id: 'real-product', name: 'Real Product' });

    renderDashboard();

    await waitFor(() => {
      expect(screen.queryByText('Welcome to Asas POS')).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Initialize Demo Data' })).not.toBeInTheDocument();
  });
});
