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
  Divider,
  Grid,
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
import AddIcon from '@mui/icons-material/Add';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { academicService } from '../services/api.service';
import type { AcademicSession, GradeScaleBand, Semester } from '../services/api.service';
import { useCurrentUser } from '../hooks/useCurrentUser';

const emptySession = { name: '', startDate: '', endDate: '' };
const emptySemester = { academicSessionId: '', name: '', number: 1, startDate: '', endDate: '' };

/** academic_settings stores instants; the field speaks local wall-clock time. */
const toLocalInput = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : null);

const day = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

const AcademicCalendar: React.FC = () => {
  const user = useCurrentUser();
  const readOnly = user?.role === 'TEACHER' || user?.role === 'STUDENT';

  const [sessions, setSessions] = React.useState<AcademicSession[]>([]);
  const [semesters, setSemesters] = React.useState<Semester[]>([]);
  const [scale, setScale] = React.useState<GradeScaleBand[]>([]);
  const [settings, setSettings] = React.useState({ minCreditUnits: 10, maxCreditUnits: 30, registrationOpensAt: '', registrationClosesAt: '' });
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState('');

  const [sessionDialog, setSessionDialog] = React.useState(false);
  const [sessionForm, setSessionForm] = React.useState(emptySession);
  const [semesterDialog, setSemesterDialog] = React.useState(false);
  const [semesterForm, setSemesterForm] = React.useState(emptySemester);

  const showSuccess = (message: string) => {
    setSuccess(message);
    setTimeout(() => setSuccess(''), 3000);
  };

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const [sessionRes, semesterRes, scaleRes, settingsRes] = await Promise.all([
        academicService.listSessions(),
        academicService.listSemesters(),
        academicService.getGradeScale(),
        academicService.getSettings(),
      ]);
      setSessions(sessionRes.data.data);
      setSemesters(semesterRes.data.data);
      setScale(scaleRes.data.data);
      const loaded = settingsRes.data.data;
      setSettings({
        minCreditUnits: loaded.minCreditUnits,
        maxCreditUnits: loaded.maxCreditUnits,
        registrationOpensAt: toLocalInput(loaded.registrationOpensAt),
        registrationClosesAt: toLocalInput(loaded.registrationClosesAt),
      });
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load the academic calendar');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    load();
  }, []);

  const saveSession = async () => {
    try {
      setLoading(true);
      setError('');
      await academicService.createSession(sessionForm);
      showSuccess('Academic session created');
      setSessionDialog(false);
      setSessionForm(emptySession);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to create the session');
    } finally {
      setLoading(false);
    }
  };

  const saveSemester = async () => {
    try {
      setLoading(true);
      setError('');
      await academicService.createSemester(semesterForm);
      showSuccess('Semester created');
      setSemesterDialog(false);
      setSemesterForm(emptySemester);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to create the semester');
    } finally {
      setLoading(false);
    }
  };

  const activateSession = async (id: string) => {
    try {
      setLoading(true);
      setError('');
      await academicService.activateSession(id);
      showSuccess('Academic session activated');
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to activate the session');
    } finally {
      setLoading(false);
    }
  };

  const activateSemester = async (id: string) => {
    try {
      setLoading(true);
      setError('');
      await academicService.activateSemester(id);
      showSuccess('Semester activated');
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to activate the semester');
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    try {
      setLoading(true);
      setError('');
      await academicService.saveSettings({
        minCreditUnits: Number(settings.minCreditUnits),
        maxCreditUnits: Number(settings.maxCreditUnits),
        registrationOpensAt: fromLocalInput(settings.registrationOpensAt),
        registrationClosesAt: fromLocalInput(settings.registrationClosesAt),
      });
      showSuccess('Registration settings saved');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to save the registration settings');
    } finally {
      setLoading(false);
    }
  };

  const sessionName = (id: string) => sessions.find((session) => session.id === id)?.name ?? '';

  return (
    <Box>
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
            Academic Calendar
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Sessions, semesters, the published grade scale and the course registration window.
          </Typography>
        </Box>
        {!readOnly && (
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setSemesterDialog(true)} disabled={sessions.length === 0}>
              New Semester
            </Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setSessionDialog(true)}>
              New Session
            </Button>
          </Stack>
        )}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}
      {loading && <CircularProgress sx={{ mb: 2 }} />}

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <Card sx={{ p: 2, mb: 2 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>Academic sessions</Typography>
            {sessions.length === 0 && !loading && (
              <Typography variant="body2" color="text.secondary">
                No sessions yet. Create one, for example 2025/2026, before adding semesters.
              </Typography>
            )}
            {sessions.length > 0 && (
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Session</TableCell>
                      <TableCell>Dates</TableCell>
                      <TableCell align="right">Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {sessions.map((session) => (
                      <TableRow key={session.id}>
                        <TableCell>{session.name}</TableCell>
                        <TableCell>{day(session.startDate)} – {day(session.endDate)}</TableCell>
                        <TableCell align="right">
                          {session.isActive ? (
                            <Chip size="small" color="success" label="Active" />
                          ) : (
                            <Button size="small" startIcon={<CheckCircleIcon />} onClick={() => activateSession(session.id)}>
                              Activate
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Card>

          <Card sx={{ p: 2, mb: 2 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>Semesters</Typography>
            {semesters.length === 0 && !loading && (
              <Typography variant="body2" color="text.secondary">
                No semesters yet.
              </Typography>
            )}
            {semesters.length > 0 && (
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Semester</TableCell>
                      <TableCell>Session</TableCell>
                      <TableCell>Dates</TableCell>
                      <TableCell align="right">Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {semesters.map((semester) => (
                      <TableRow key={semester.id}>
                        <TableCell>{semester.name}</TableCell>
                        <TableCell>{semester.academicSession?.name ?? sessionName(semester.academicSessionId)}</TableCell>
                        <TableCell>{day(semester.startDate)} – {day(semester.endDate)}</TableCell>
                        <TableCell align="right">
                          {semester.isActive ? (
                            <Chip size="small" color="success" label="Active" />
                          ) : (
                            <Button size="small" startIcon={<CheckCircleIcon />} onClick={() => activateSemester(semester.id)}>
                              Activate
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Card>

          <Card sx={{ p: 2 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>Grade scale</Typography>
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Letter</TableCell>
                    <TableCell>Percentage</TableCell>
                    <TableCell align="right">Points</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {scale.map((band) => (
                    <TableRow key={band.id}>
                      <TableCell sx={{ fontWeight: 700 }}>{band.letter}</TableCell>
                      <TableCell>{Math.round(band.minPercent)} – {Math.round(band.maxPercent)}</TableCell>
                      <TableCell align="right">{Number(band.points).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                  {scale.length === 0 && !loading && (
                    <TableRow>
                      <TableCell colSpan={3}>
                        <Typography variant="body2" color="text.secondary">No grade scale has been published yet.</Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, lg: 5 }}>
          <Card sx={{ p: 2 }}>
            <Typography variant="h6" sx={{ mb: 0.5 }}>Course registration</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Students register while the window is open and stay between these credit limits.
            </Typography>
            <Stack spacing={2}>
              <TextField
                label="Opens"
                type="datetime-local"
                slotProps={{ inputLabel: { shrink: true } }}
                value={settings.registrationOpensAt}
                onChange={(e) => setSettings({ ...settings, registrationOpensAt: e.target.value })}
                disabled={readOnly}
              />
              <TextField
                label="Closes"
                type="datetime-local"
                slotProps={{ inputLabel: { shrink: true } }}
                value={settings.registrationClosesAt}
                onChange={(e) => setSettings({ ...settings, registrationClosesAt: e.target.value })}
                disabled={readOnly}
              />
              <Divider />
              <Stack direction="row" spacing={2}>
                <TextField
                  label="Minimum credit units"
                  type="number"
                  value={settings.minCreditUnits}
                  onChange={(e) => setSettings({ ...settings, minCreditUnits: Number(e.target.value) })}
                  disabled={readOnly}
                  sx={{ flex: 1 }}
                />
                <TextField
                  label="Maximum credit units"
                  type="number"
                  value={settings.maxCreditUnits}
                  onChange={(e) => setSettings({ ...settings, maxCreditUnits: Number(e.target.value) })}
                  disabled={readOnly}
                  sx={{ flex: 1 }}
                />
              </Stack>
              {!readOnly && (
                <Box>
                  <Button variant="contained" onClick={saveSettings} disabled={loading}>
                    Save registration settings
                  </Button>
                </Box>
              )}
            </Stack>
          </Card>
        </Grid>
      </Grid>

      <Dialog open={sessionDialog} onClose={() => setSessionDialog(false)} fullWidth>
        <DialogTitle>New Academic Session</DialogTitle>
        <DialogContent>
          <TextField
            label="Name"
            fullWidth
            margin="normal"
            placeholder="2026/2027"
            value={sessionForm.name}
            onChange={(e) => setSessionForm({ ...sessionForm, name: e.target.value })}
          />
          <TextField
            label="Starts"
            type="date"
            fullWidth
            margin="normal"
            slotProps={{ inputLabel: { shrink: true } }}
            value={sessionForm.startDate}
            onChange={(e) => setSessionForm({ ...sessionForm, startDate: e.target.value })}
          />
          <TextField
            label="Ends"
            type="date"
            fullWidth
            margin="normal"
            slotProps={{ inputLabel: { shrink: true } }}
            value={sessionForm.endDate}
            onChange={(e) => setSessionForm({ ...sessionForm, endDate: e.target.value })}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSessionDialog(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={saveSession}
            disabled={!sessionForm.name || !sessionForm.startDate || !sessionForm.endDate}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={semesterDialog} onClose={() => setSemesterDialog(false)} fullWidth>
        <DialogTitle>New Semester</DialogTitle>
        <DialogContent>
          <TextField
            select
            label="Academic session"
            fullWidth
            margin="normal"
            value={semesterForm.academicSessionId}
            onChange={(e) => setSemesterForm({ ...semesterForm, academicSessionId: e.target.value })}
          >
            {sessions.map((session) => (
              <MenuItem key={session.id} value={session.id}>{session.name}</MenuItem>
            ))}
          </TextField>
          <TextField
            label="Name"
            fullWidth
            margin="normal"
            placeholder="First Semester"
            value={semesterForm.name}
            onChange={(e) => setSemesterForm({ ...semesterForm, name: e.target.value })}
          />
          <TextField
            select
            label="Number"
            fullWidth
            margin="normal"
            value={semesterForm.number}
            onChange={(e) => setSemesterForm({ ...semesterForm, number: Number(e.target.value) })}
          >
            {[1, 2, 3].map((number) => (
              <MenuItem key={number} value={number}>{number}</MenuItem>
            ))}
          </TextField>
          <TextField
            label="Starts"
            type="date"
            fullWidth
            margin="normal"
            slotProps={{ inputLabel: { shrink: true } }}
            value={semesterForm.startDate}
            onChange={(e) => setSemesterForm({ ...semesterForm, startDate: e.target.value })}
          />
          <TextField
            label="Ends"
            type="date"
            fullWidth
            margin="normal"
            slotProps={{ inputLabel: { shrink: true } }}
            value={semesterForm.endDate}
            onChange={(e) => setSemesterForm({ ...semesterForm, endDate: e.target.value })}
          />
          <Typography variant="caption" color="text.secondary">
            The dates must fall inside the session, or the school database will refuse it.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSemesterDialog(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={saveSemester}
            disabled={!semesterForm.academicSessionId || !semesterForm.name || !semesterForm.startDate || !semesterForm.endDate}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default AcademicCalendar;
