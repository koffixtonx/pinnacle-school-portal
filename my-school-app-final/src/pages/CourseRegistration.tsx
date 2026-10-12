import React from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { academicService, registrationService } from '../services/api.service';
import type { AcademicSettings, CatalogCourse as CatalogEntry } from '../services/api.service';

const COUNTED_STATUSES = ['PENDING', 'APPROVED'];

const statusTone: Record<string, 'default' | 'info' | 'success' | 'warning' | 'error'> = {
  PENDING: 'info',
  APPROVED: 'success',
  REJECTED: 'error',
  DROPPED: 'default',
};

const CourseRegistrationPage: React.FC = () => {
  const [semester, setSemester] = React.useState<{ name: string; startDate: string; endDate: string } | null>(null);
  const [catalog, setCatalog] = React.useState<CatalogEntry[]>([]);
  const [settings, setSettings] = React.useState<AcademicSettings | null>(null);
  const [registrationWindow, setWindow] = React.useState<{ open: boolean; message: string | null }>({ open: false, message: null });
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState('');

  const showSuccess = (message: string) => {
    setSuccess(message);
    setTimeout(() => setSuccess(''), 3000);
  };

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const [catalogRes, settingsRes, windowRes] = await Promise.all([
        registrationService.listCatalog(),
        academicService.getSettings(),
        academicService.getRegistrationWindow(),
      ]);
      setSemester(catalogRes.data.data.semester);
      setCatalog(catalogRes.data.data.courses);
      setSettings(settingsRes.data.data);
      setWindow(windowRes.data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load your courses');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    load();
  }, []);

  const creditLoad = catalog
    .filter((course) => COUNTED_STATUSES.includes(course.registration?.status ?? ''))
    .reduce((total, course) => total + (course.registration?.creditUnits ?? 0), 0);

  const ceiling = settings?.maxCreditUnits ?? 0;

  const register = async (courseId: string) => {
    try {
      setLoading(true);
      setError('');
      await registrationService.register(courseId);
      showSuccess('Course added to your registration list');
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to register for this course');
    } finally {
      setLoading(false);
    }
  };

  const drop = async (registrationId: string) => {
    try {
      setLoading(true);
      setError('');
      await registrationService.drop(registrationId);
      showSuccess('Course dropped');
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to drop this course');
    } finally {
      setLoading(false);
    }
  };

  const wouldExceedCeiling = (course: CatalogEntry) =>
    settings != null && creditLoad + course.creditUnits > settings.maxCreditUnits;

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
          Course Registration
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {semester ? `${semester.name} · ${semester.startDate} to ${semester.endDate}` : 'Register for courses this semester.'}
        </Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}
      {loading && <CircularProgress sx={{ mb: 2 }} />}

      <Card sx={{ p: 2, mb: 3 }}>
        <Stack spacing={1.5}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Credit load</Typography>
            <Chip
              size="small"
              color={registrationWindow.open ? 'success' : 'default'}
              label={registrationWindow.open ? 'Registration open' : 'Registration closed'}
            />
          </Box>
          <LinearProgress
            variant="determinate"
            value={ceiling ? Math.min(100, (creditLoad / ceiling) * 100) : 0}
            color={creditLoad > ceiling ? 'error' : 'primary'}
            sx={{ height: 10, borderRadius: 5 }}
          />
          <Typography variant="body2" color="text.secondary">
            {creditLoad} of {settings?.maxCreditUnits ?? '—'} credit units
            {settings ? ` · at least ${settings.minCreditUnits} required` : ''}
          </Typography>
          {registrationWindow.message && !registrationWindow.open && (
            <Alert severity="info" sx={{ py: 0.5 }}>
              {registrationWindow.message}
            </Alert>
          )}
        </Stack>
      </Card>

      <Card>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell>
                <TableCell>Course</TableCell>
                <TableCell align="right">Units</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {catalog.map((course) => {
                const status = course.registration?.status;
                const counted = status ? COUNTED_STATUSES.includes(status) : false;
                return (
                  <TableRow key={course.id}>
                    <TableCell>{course.code}</TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{course.title}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {course.level ? `${course.level} level` : ''}
                        {course.description ? ` · ${course.description}` : ''}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">{course.creditUnits}</TableCell>
                    <TableCell>
                      {status ? <Chip size="small" color={statusTone[status] ?? 'default'} label={status} /> : '—'}
                    </TableCell>
                    <TableCell align="right">
                      {counted ? (
                        <Button size="small" onClick={() => drop(course.registration!.id)} disabled={!registrationWindow.open}>
                          Drop
                        </Button>
                      ) : (
                        <Button
                          size="small"
                          variant={status ? 'text' : 'contained'}
                          onClick={() => register(course.id)}
                          disabled={!registrationWindow.open || wouldExceedCeiling(course)}
                        >
                          {status === 'REJECTED' ? 'Request again' : 'Register'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {catalog.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Typography variant="body2" color="text.secondary">No courses have been published yet.</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
        Requests go to your school administrator for approval. Only published results appear on your Results page.
      </Typography>
    </Box>
  );
};

export default CourseRegistrationPage;
