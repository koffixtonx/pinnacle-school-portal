import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@mui/material/styles';
import AuditLog from './AuditLog';
import getTheme from '../theme';
import { adminService } from '../services/api.service';
import type { AuditEntry } from '../services/api.service';

vi.mock('../services/api.service', () => ({ adminService: { getAuditLogs: vi.fn() } }));

const getAuditLogs = vi.mocked(adminService.getAuditLogs);

const ROW: AuditEntry = {
  id: 'r-1',
  action: 'update',
  entity: 'course_registrations',
  entityId: 'c-1',
  summary: 'Smoke Test changed TST-104 to PENDING',
  changedData: '{"status":"PENDING"}',
  createdAt: '2026-10-09T08:15:00.000Z',
  actorId: 'a-1',
  actor: {
    id: 'a-1',
    firstName: 'Ada',
    lastName: 'Admin',
    email: 'koffixtonx+qoder-admin@gmail.com',
    role: 'SCHOOL_ADMIN',
  },
};

// The service is mocked, so what matters here is the query object the page hands
// it. These expectations build the same local-midnight instants the page does:
// asserting a literal Zulu string would pass or fail on the runner's timezone.
const localDay = (day: string) => new Date(`${day}T00:00:00`).toISOString();
const nextDay = (day: string) => {
  const date = new Date(`${day}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return date.toISOString();
};

const lastQuery = (): Record<string, unknown> =>
  (getAuditLogs.mock.calls.at(-1)?.[0] ?? {}) as Record<string, unknown>;

beforeEach(() => {
  getAuditLogs.mockReset();
  getAuditLogs.mockResolvedValue({ data: { data: [ROW], paging: { nextCursor: null } }, meta: {} } as never);
});

function renderPage() {
  return render(
    <ThemeProvider theme={getTheme('light')}>
      <AuditLog />
    </ThemeProvider>,
  );
}

describe('Audit log filters', () => {
  it('opens with no filters at all, so nothing is hidden on first paint', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Ada Admin')).toBeTruthy());

    expect(getAuditLogs).toHaveBeenCalledTimes(1);
    const query = lastQuery();
    expect(query.limit).toBe(25);
    expect(query.from).toBeUndefined();
    expect(query.to).toBeUndefined();
    expect(query.entity).toBeUndefined();
    expect(query.actorId).toBeUndefined();
    expect(screen.queryByRole('button', { name: /Clear/ })).toBeNull();
  });

  it('bounds a date range by whole local days, inclusive at both ends', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Ada Admin')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } });
    await waitFor(() => expect(lastQuery().from).toBe(localDay('2026-10-01')));

    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-05' } });
    await waitFor(() => expect(lastQuery().to).toBe(nextDay('2026-10-05')));
    // The upper bound must be the following midnight, or the last day is dropped.
    expect(lastQuery().to).not.toBe(localDay('2026-10-05'));
  });

  it('counts every active filter on the Clear button', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Ada Admin')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-05' } });
    expect(await screen.findByRole('button', { name: 'Clear 1' })).toBeTruthy();

    // MUI's Select opens on mouseDown, not click.
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Action' }));
    fireEvent.click(await screen.findByRole('option', { name: 'delete' }));
    expect(await screen.findByRole('button', { name: 'Clear 2' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear 2' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Clear/ })).toBeNull());
    expect(lastQuery().to).toBeUndefined();
    expect(lastQuery().action).toBeUndefined();
  });

  it('reports a failed load instead of showing an empty table', async () => {
    getAuditLogs.mockRejectedValue({ response: { data: { message: 'relation "audit_logs" does not exist' } } });
    renderPage();
    expect(await screen.findByText('relation "audit_logs" does not exist')).toBeTruthy();
  });
});
