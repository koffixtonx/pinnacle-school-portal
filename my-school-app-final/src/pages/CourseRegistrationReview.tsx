import React from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
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
import { academicService, registrationService } from '../services/api.service';
import type { CourseRegistration, RegistrationStatus, Semester } from '../services/api.service';

const STATUSES: RegistrationStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'DROPPED'];

const statusTone: Record<RegistrationStatus, 'default' | 'info' | 'success' | 'error'> = {
  PENDING: 'info',
  APPROVED: 'success',
  REJECTED: 'error',
  DROPPED: 'default',
};

const fullName = (registration: CourseRegistration) => {
  const student = registration.student;
  const name = student ? `${student.firstName ?? ''} ${student.lastName ?? ''}`.trim() : '';
  return name || student?.email || 'Unknown student';
};

const CourseRegistrationReview: React.FC = () => {
  const [semester, setSemester] = React.useState<Semester | null>(null);
  const [registrations, setRegistrations] = React.useState<CourseRegistration[]>([]);
  const [statusFilter, setStatusFilter] = React.useState<RegistrationStatus | ''>('PENDING');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState('');
  const [decision, setDecision] = React.useState<{ registration: CourseRegistration; approve: boolean } | null>(null);
  const [notes, setNotes] = React.useState('');

  const showSuccess = (message: string) => {
    setSuccess(message);
    setTimeout(() => setSuccess(''), 3000);
  };

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const active = await academicService.getActiveSemester();
      const current = active.data.data;
      setSemester(current);
      if (!current) {
        setRegistrations([]);
        return;
      }
      const list = await registrationService.listForReview({
        semesterId: current.id,
        status: statusFilter || undefined,
      });
      setRegistrations(list.data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load the registrations');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const loadByStudent = React.useMemo(() => {
    const totals = new Map<string, number>();
    registrations.forEach((registration) => {
      totals.set(registration.studentId, (totals.get(registration.studentId) ?? 0) + registration.creditUnits);
    });
    return totals;
  }, [registrations]);

  const openDecision = (registration: CourseRegistration, approve: boolean) => {
    setDecision({ registration, approve });
    setNotes(registration.notes ?? '');
  };

  const confirmDecision = async () => {
    if (!decision) return;
    try {
      setLoading(true);
      setError('');
      await registrationService.review(decision.registration.id, decision.approve, notes);
      showSuccess(decision.approve ? 'Registration approved and enrolled' : 'Registration rejected');
      setDecision(null);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to review this registration');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
          Registration Requests
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {semester
            ? `${semester.name} · approving a request enrols the student in the course.`
            : 'No semester is active yet, so there is nothing to approve.'}
        </Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}
      {loading && <CircularProgress sx={{ mb: 2 }} />}

      <Stack direction="row" spacing={2} sx={{ mb: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <TextField
          select
          label="Status"
          size="small"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as RegistrationStatus | '')}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">All</MenuItem>
          {STATUSES.map((status) => (
            <MenuItem key={status} value={status}>{status}</MenuItem>
          ))}
        </TextField>
        <Typography variant="caption" color="text.secondary">
          {registrations.length} registration{registrations.length === 1 ? '' : 's'}
        </Typography>
      </Stack>

      <Card>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Student</TableCell>
                <TableCell>Course</TableCell>
                <TableCell align="right">Units</TableCell>
                <TableCell align="right">Load</TableCell>
                <TableCell>Requested</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {registrations.map((registration) => {
                const open = registration.status === 'PENDING';
                return (
                  <TableRow key={registration.id}>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{fullName(registration)}</Typography>
                      <Typography variant="caption" color="text.secondary">{registration.student?.email}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{registration.course?.title}</Typography>
                      <Typography variant="caption" color="text.secondary">{registration.course?.code}</Typography>
                    </TableCell>
                    <TableCell align="right">{registration.creditUnits}</TableCell>
                    <TableCell align="right">{loadByStudent.get(registration.studentId) ?? registration.creditUnits}</TableCell>
                    <TableCell>{new Date(registration.requestedAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Chip size="small" color={statusTone[registration.status]} label={registration.status} />
                      {registration.notes && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', maxWidth: 220 }}>
                          {registration.notes}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {open ? (
                        <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                          <Button size="small" color="error" onClick={() => openDecision(registration, false)}>
                            Reject
                          </Button>
                          <Button size="small" variant="contained" onClick={() => openDecision(registration, true)}>
                            Approve
                          </Button>
                        </Stack>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          {registration.reviewedAt ? new Date(registration.reviewedAt).toLocaleDateString() : '—'}
                        </Typography>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {registrations.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={7}>
                    <Typography variant="body2" color="text.secondary">
                      {semester ? 'No registrations match this filter.' : 'Activate a semester in the academic calendar first.'}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Dialog open={!!decision} onClose={() => setDecision(null)} fullWidth>
        <DialogTitle>{decision?.approve ? 'Approve registration' : 'Reject registration'}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {decision ? `${fullName(decision.registration)} · ${decision.registration.course?.code} ${decision.registration.course?.title}` : ''}
          </Typography>
          <TextField
            label="Note for the student"
            fullWidth
            multiline
            rows={2}
            margin="normal"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDecision(null)}>Cancel</Button>
          <Button variant="contained" onClick={confirmDecision}>
            {decision?.approve ? 'Approve' : 'Reject'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default CourseRegistrationReview;
