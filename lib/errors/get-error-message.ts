import { AppError } from './app-error';

/**
 * Extracts a localized error message from an unknown caught value.
 *
 * - AppError → looks up errors.<code> in the translation dict and interpolates
 *   any params (e.g. {{name}} → product name).
 * - plain Error → returns error.message as-is (English, used for unexpected
 *   errors that don't have a code yet).
 * - anything else → returns the provided fallback string.
 *
 * Usage in components:
 *   push(getServiceErrorMessage(error, t, t('billing.billFailed')), 'error');
 */
export function getServiceErrorMessage(
  error: unknown,
  t: (key: string, vars?: Record<string, string | number>) => string,
  fallback?: string,
): string {
  if (error instanceof AppError) {
    return t(`errors.${error.code}`, error.params);
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback ?? t('errors.UNKNOWN');
}
