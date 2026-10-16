import React from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  IconButton,
  MenuItem,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useTheme } from '@mui/material/styles';
import { adminService } from '../services/api.service';
import type { AuditEntry } from '../services/api.service';

const PAGE_SIZE = 25;

// The tables `write_audit_log()` is triggered on. A list rather than a query
// because PostgREST cannot hand back the distinct set without an aggregate the
// API does not expose here; rows whose table is missing below still label
// themselves and still get a filter, from `entityOptions`.
const ENTITY_LABELS: Record<string, string> = {
  academic_sessions: 'Academic sessions',
  academic_settings: 'Academic settings',
  attendance_records: 'Attendance',
  class_sections: 'Class sections',
  course_registrations: 'Course registrations',
  courses: 'Courses',
  departments: 'Departments',
  enrollments: 'Enrollments',
  faculties: 'Faculties',
  fee_structures: 'Fee structures',
  grade_entries: 'Grade entries',
  grade_periods: 'Grade periods',
  grade_scale: 'Grade scale',
  invoices: 'Invoices',
  payment_attempts: 'Payment attempts',
  payments: 'Payments',
  profiles: 'People',
  semesters: 'Semesters',
  site_settings: 'Portal settings',
};

const ACTIONS = ['insert', 'update', 'delete'] as const;

const entityLabel = (entity: string) => ENTITY_LABELS[entity] ?? entity.replace(/_/g, ' ');

const actionColor = (action: string) => (action === 'insert' ? 'success' : action === 'delete' ? 'error' : 'warning');

const formatWhen = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });

const actorLabel = (row: AuditEntry) =>
  row.actor ? `${row.actor.firstName} ${row.actor.lastName}`.trim() || row.actor.email || 'A person' : '';

interface Filters {
  entity: string;
  action: string;
  actorId: string;
  actorName: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = { entity: '', action: '', actorId: '', actorName: '', from: '', to: '' };

const filterCount = (filters: Filters) =>
  [filters.entity, filters.action, filters.actorId, filters.from, filters.to].filter(Boolean).length;

/** A `type="date"` value is a wall-clock day; the database wants instants, and the
 *  upper bound must exclude the following midnight or the last day is never shown. */
const dayStart = (value: string) => new Date(`${value}T00:00:00`).toISOString();
const dayAfter = (value: string) => {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return date.toISOString();
};

// One field skin for all four filters: a fixed 48px box, the label floated
// inside the border rather than cut into it, and the value on the line under
// it. A date field with no value still shows its `mm/dd/yyyy` skeleton, so the
// label has to sit somewhere that never collides with it.
const FIELD_RADIUS = 10;
const fieldSx = {
  width: '100%',
  minWidth: 0,
  '& .MuiOutlinedInput-root': {
    height: 48,
    borderRadius: `${FIELD_RADIUS}px`,
    alignItems: 'stretch',
  },
  '& .MuiInputBase-input': {
    height: 'auto',
    minWidth: 0,
    padding: `19px 12px 5px`,
    lineHeight: '20px',
    fontSize: 14,
  },
  '& .MuiSelect-select': { paddingRight: 28, minWidth: 0 },
  '& .MuiSelect-icon': { bottom: 4 },
  '& .MuiInputLabel-root': {
    transform: 'translate(12px, 5px) scale(0.75)',
    transformOrigin: 'top left',
  },
  '& fieldset': { borderRadius: `${FIELD_RADIUS}px` },
  '& fieldset legend': { display: 'none' },
} as const;

// Chrome draws the date field's calendar glyph dark on dark, so the icon is
// flipped in the dark theme. It stays in the input's own flow, which keeps it
// on the value line and inside the border. The `mm/dd/yyyy` skeleton is the
// widest value any of the four fields has to hold at 768px, where all five
// controls share one row, so the date fields carry tighter type than the selects.
const dateFieldSx = (isDark: boolean) => ({
  ...fieldSx,
  '& .MuiInputBase-input': {
    ...fieldSx['& .MuiInputBase-input'],
    padding: '19px 6px 5px 8px',
    fontSize: 13,
  },
  '& input[type="date"]::-webkit-calendar-picker-indicator': {
    width: 16,
    height: 16,
    marginRight: 2,
    cursor: 'pointer',
    filter: isDark ? 'invert(1)' : 'none',
  },
});

const AuditLog: React.FC = () => {
  const isDarkMode = useTheme().palette.mode === 'dark';
  const [rows, setRows] = React.useState<AuditEntry[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [filters, setFilters] = React.useState<Filters>(EMPTY_FILTERS);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState('');
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const query = React.useMemo(
    () => ({
      limit: PAGE_SIZE,
      entity: filters.entity || undefined,
      action: filters.action || undefined,
      actorId: filters.actorId || undefined,
      from: filters.from ? dayStart(filters.from) : undefined,
      to: filters.to ? dayAfter(filters.to) : undefined,
    }),
    [filters],
  );

  const entityOptions = React.useMemo(() => {
    const known = Object.keys(ENTITY_LABELS);
    const extra = rows.map((row) => row.entity).filter((entity) => !known.includes(entity));
    return [...new Set([...known, ...extra])].sort((a, b) => entityLabel(a).localeCompare(entityLabel(b)));
  }, [rows]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await adminService.getAuditLogs(query);
      setRows(response.data.data);
      setCursor(response.data.paging.nextCursor);
      setExpanded(null);
    } catch (err: any) {
      setRows([]);
      setCursor(null);
      setError(err.response?.data?.message || 'The audit log could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [query]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    setError('');
    try {
      const response = await adminService.getAuditLogs({ ...query, cursor });
      setRows((prev) => [...prev, ...response.data.data]);
      setCursor(response.data.paging.nextCursor);
    } catch (err: any) {
      setError(err.response?.data?.message || 'The next page could not be loaded.');
    } finally {
      setLoadingMore(false);
    }
  };

  const set = (patch: Partial<Filters>) => setFilters((prev) => ({ ...prev, ...patch }));

  const followActor = (row: AuditEntry) => {
    if (!row.actor) return;
    set({ actorId: row.actor.id, actorName: actorLabel(row) });
  };

  const changedData = (row: AuditEntry) => {
    try {
      const parsed = JSON.parse(row.changedData || '{}');
      return JSON.stringify(parsed, null, 2);
    } catch {
      return row.changedData || '{}';
    }
  };

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
          Audit log
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Every change this school made to a recorded table, newest first. Reads are not logged, so the trail shows what
          moved rather than who looked.
        </Typography>
      </Box>

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={() => void load()}>
              Try again
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      <Card sx={{ borderRadius: 3, border: '1px solid rgba(15, 23, 42, 0.08)', mb: 3 }}>
        <CardContent>
          <Box
            sx={{
              display: 'grid',
              gap: '24px 16px',
              pt: '12px',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              alignItems: 'center',
              '@media (min-width: 768px)': { gridTemplateColumns: 'repeat(4, minmax(0, 1fr)) auto' },
            }}
          >
            <TextField
              select
              size="small"
              label="Table"
              value={filters.entity}
              onChange={(event) => set({ entity: event.target.value })}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={fieldSx}
            >
              <MenuItem value="">Any table</MenuItem>
              {entityOptions.map((entity) => (
                <MenuItem key={entity} value={entity}>
                  {entityLabel(entity)}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Action"
              value={filters.action}
              onChange={(event) => set({ action: event.target.value })}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={fieldSx}
            >
              <MenuItem value="">Any action</MenuItem>
              {ACTIONS.map((action) => (
                <MenuItem key={action} value={action}>
                  {action}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              type="date"
              label="From"
              value={filters.from}
              onChange={(event) => set({ from: event.target.value })}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={dateFieldSx(isDarkMode)}
            />
            <TextField
              size="small"
              type="date"
              label="To"
              value={filters.to}
              onChange={(event) => set({ to: event.target.value })}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={dateFieldSx(isDarkMode)}
            />
            <Stack
              direction="row"
              spacing={1.5}
              sx={{
                alignItems: 'center',
                justifyContent: 'flex-end',
                gridColumn: '1 / -1',
                '@media (min-width: 768px)': { gridColumn: 'auto' },
              }}
            >
              <Button
                variant="outlined"
                onClick={() => void load()}
                disabled={loading}
                startIcon={loading ? <CircularProgress size={16} /> : <RefreshIcon />}
              >
                Refresh
              </Button>
              {filterCount(filters) > 0 && (
                <Button onClick={() => setFilters(EMPTY_FILTERS)}>Clear {filterCount(filters)}</Button>
              )}
            </Stack>
          </Box>

          {filters.actorId && (
            <Stack direction="row" spacing={1} sx={{ mt: 2, alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="caption" color="text.secondary">
                Only changes by
              </Typography>
              <Chip
                size="small"
                label={filters.actorName || 'this person'}
                onDelete={() => set({ actorId: '', actorName: '' })}
              />
            </Stack>
          )}
        </CardContent>
      </Card>

      <Card sx={{ borderRadius: 3, border: '1px solid rgba(15, 23, 42, 0.08)' }}>
        <CardContent sx={{ pt: 2 }}>
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell width={64} />
                  <TableCell>When</TableCell>
                  <TableCell>Change</TableCell>
                  <TableCell>Who</TableCell>
                  <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Record</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loading &&
                  Array.from({ length: 6 }).map((_, index) => (
                    <TableRow key={`skeleton-${index}`}>
                      <TableCell />
                      <TableCell colSpan={4}>
                        <Skeleton variant="rounded" height={34} />
                      </TableCell>
                    </TableRow>
                  ))}

                {!loading &&
                  rows.map((row) => {
                    const open = expanded === row.id;
                    return (
                      <React.Fragment key={row.id}>
                        <TableRow hover>
                          <TableCell sx={{ py: 1 }}>
                            <IconButton size="small" onClick={() => setExpanded(open ? null : row.id)} aria-label={open ? 'Hide the recorded row' : 'Show the recorded row'}>
                              {open ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                            </IconButton>
                          </TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatWhen(row.createdAt)}</TableCell>
                          <TableCell>
                            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                              <Chip size="small" color={actionColor(row.action)} label={row.action} variant="outlined" />
                              <Typography variant="body2">{entityLabel(row.entity)}</Typography>
                            </Stack>
                          </TableCell>
                          <TableCell>
                            {row.actor ? (
                              <Button size="small" onClick={() => followActor(row)} sx={{ textTransform: 'none', justifyContent: 'flex-start', pl: 0 }}>
                                {actorLabel(row)}
                              </Button>
                            ) : (
                              <Typography variant="caption" color="text.secondary">
                                No account recorded
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                            <Typography variant="caption" component="span" sx={{ fontFamily: 'monospace' }}>
                              {row.entityId.slice(0, 8)}
                            </Typography>
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell colSpan={5} sx={{ py: 0, border: 0 }}>
                            <Collapse in={open} unmountOnExit>
                              <Box sx={{ py: 1.5 }}>
                                <Typography variant="caption" color="text.secondary">
                                  What the trail recorded for this change.
                                </Typography>
                                <Box
                                  component="pre"
                                  sx={{
                                    m: 0,
                                    mt: 0.5,
                                    p: 1.5,
                                    borderRadius: 2,
                                    bgcolor: 'action.hover',
                                    overflowX: 'auto',
                                    fontSize: 12,
                                    lineHeight: 1.5,
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word',
                                  }}
                                >
                                  {changedData(row)}
                                </Box>
                              </Box>
                            </Collapse>
                          </TableCell>
                        </TableRow>
                      </React.Fragment>
                    );
                  })}

                {!loading && rows.length === 0 && !error && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Typography variant="body2" color="text.secondary">
                        {filterCount(filters) > 0
                          ? 'Nothing in this school matches those filters. Clear one to widen the search.'
                          : 'This school has no recorded changes yet.'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {!loading && cursor && (
            <Button
              variant="outlined"
              sx={{ mt: 2 }}
              onClick={() => void loadMore()}
              disabled={loadingMore}
              startIcon={loadingMore ? <CircularProgress size={16} /> : undefined}
            >
              Load {PAGE_SIZE} older changes
            </Button>
          )}
        </CardContent>
      </Card>
    </Box>
  );
};

export default AuditLog;
