import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorBoundary, { FatalScreen } from './ErrorBoundary';

const { reportError } = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock('../services/monitoring', () => ({ reportError }));

function Boom(): never {
  throw new Error('chart data is not an array');
}

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>Student roster</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('Student roster')).toBeTruthy();
    expect(reportError).not.toHaveBeenCalled();
  });

  it('replaces the tree with the fallback and reports the error once', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText('This page could not be displayed')).toBeTruthy();
    expect(screen.getByText(/chart data is not an array/)).toBeTruthy();
    expect(screen.queryByText('Student roster')).toBeNull();
    expect(reportError).toHaveBeenCalledTimes(1);

    const [error, context] = reportError.mock.calls[0] as [Error, { componentStack: string }];
    expect(error.message).toBe('chart data is not an array');
    // The component stack is what makes a production report pointable.
    expect(context.componentStack).toContain('Boom');
    spy.mockRestore();
  });

  it('is reachable without a child error, for failed chunk loads', () => {
    render(<FatalScreen error="Failed to fetch dynamically imported module" />);
    expect(screen.getByText(/Failed to fetch dynamically imported module/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });
});
