import { describe, expect, it } from 'vitest';
import { AppError, AppErrorCode } from '@/lib/errors/app-error';
import { assertPaymentMethodEnabled, effectiveTaxAmount } from '@/lib/services/settings-policy';
import { makeSettings } from '@/tests/helpers/builders';

describe('settings policy service', () => {
  it('allows enabled payment methods and treats undefined toggles as enabled for historical settings', () => {
    const settings = makeSettings({ enableCash: undefined, enableCard: undefined, enableCredit: undefined });

    expect(() => assertPaymentMethodEnabled(settings, 'cash')).not.toThrow();
    expect(() => assertPaymentMethodEnabled(settings, 'card')).not.toThrow();
    expect(() => assertPaymentMethodEnabled(settings, 'credit')).not.toThrow();
  });

  it('rejects disabled payment methods at the service layer', () => {
    const settings = makeSettings({ enableCash: false, enableCard: false, enableCredit: false });

    expect(() => assertPaymentMethodEnabled(settings, 'cash')).toThrow(AppError);
    expect(() => assertPaymentMethodEnabled(settings, 'card')).toThrow(AppError);
    expect(() => assertPaymentMethodEnabled(settings, 'credit')).toThrow(AppError);
  });

  it('keeps mixed payment retired for new writes even if legacy records can still display it', () => {
    expect(() => assertPaymentMethodEnabled(makeSettings(), 'mixed')).toThrow(AppErrorCode.PAYMENT_METHOD_DISABLED);
  });

  it('only allows manual tax in exclusive tax mode', () => {
    expect(effectiveTaxAmount(makeSettings({ taxMode: 'exclusive' }), 3.25)).toBe(3.25);
    expect(effectiveTaxAmount(makeSettings({ taxMode: 'inclusive' }), 3.25)).toBe(0);
    expect(effectiveTaxAmount(makeSettings({ taxMode: 'none' }), 3.25)).toBe(0);
    expect(effectiveTaxAmount(makeSettings({ taxMode: undefined }), 3.25)).toBe(0);
  });
});
