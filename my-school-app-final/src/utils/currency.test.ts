// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatCurrency } from './currency';

describe('formatCurrency', () => {
  it('formats whole naira with thousands separators and two decimals', () => {
    expect(formatCurrency(25000)).toBe('₦25,000.00');
    expect(formatCurrency('20000.5')).toBe('₦20,000.50');
  });

  // Invoices and score rows come back from PostgREST as strings, and a missing
  // balance renders as ₦0.00 rather than an empty cell or NaN.
  it('accepts the string and empty shapes the API returns', () => {
    expect(formatCurrency('0')).toBe('₦0.00');
    expect(formatCurrency('')).toBe('₦0.00');
    expect(formatCurrency(null)).toBe('₦0.00');
    expect(formatCurrency(undefined)).toBe('₦0.00');
  });
});
