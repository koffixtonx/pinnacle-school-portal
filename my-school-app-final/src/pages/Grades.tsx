import React from 'react';
import {
  Box,
  Card,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  MenuItem,
  Button,
  Typography,
  Alert,
  CircularProgress,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import { academicsService, gradesService } from '../services/api.service';
import { useCurrentUser } from '../hooks/useCurrentUser';

interface Course {
  id: string;
  title: string;
  code: string;
}
interface GradePeriod {
  id: string;
  name: string;
  courseId: string;
}
interface Enrollment {
  id: string;
  student: { id: string; firstName: string; lastName: string };
}
interface GradeEntry {
  id: string;
  score: number;
  letterGrade: string;
  gradePeriod: { id: string; name: string; courseId: string };
  enrollment: { id: string; studentId: string };
}

const Grades: React.FC = () => {
  const user = useCurrentUser();
  const canEnter = user?.role === 'TEACHER' || user?.role === 'SUPER_ADMIN' || user?.role === 'SCHOOL_ADMIN';

  const [courses, setCourses] = React.useState<Course[]>([]);
  const [selectedCourse, setSelectedCourse] = React.useState('');
  const [periods, setPeriods] = React.useState<GradePeriod[]>([]);
  const [selectedPeriod, setSelectedPeriod] = React.useState('');
  const [enrollments, setEnrollments] = React.useState<Enrollment[]>([]);
  const [entries, setEntries] = React.useState<GradeEntry[]>([]);
  const [scores, setScores] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState('');
  const [periodDialogOpen, setPeriodDialogOpen] = React.useState(false);
  const [periodForm, setPeriodForm] = React.useState({ name: '', startsAt: '', endsAt: '' });

  const showSuccess = (message: string) => {
    setSuccess(message);
    setTimeout(() => setSuccess(''), 3000);
  };

  const fetchEntries = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await gradesService.listEntries({
        courseId: selectedCourse || undefined,
        gradePeriodId: selectedPeriod || undefined,
      });
      setEntries(response.data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load grades');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    if (canEnter) {
      academicsService.listCourses().then((res) => setCourses(res.data.data)).catch(() => {});
    }
    fetchEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!selectedCourse) {
      setPeriods([]);
      setEnrollments([]);
      return;
    }
    gradesService.listPeriods(selectedCourse).then((res) => setPeriods(res.data.data)).catch(() => {});
    academicsService.listCourseEnrollments(selectedCourse).then((res) => setEnrollments(res.data.data)).catch(() => {});
  }, [selectedCourse]);

  React.useEffect(() => {
    fetchEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCourse, selectedPeriod]);

  const handleCreatePeriod = async () => {
    if (!selectedCourse) return;
    try {
      setLoading(true);
      await gradesService.createPeriod(selectedCourse, periodForm.name, periodForm.startsAt, periodForm.endsAt);
      showSuccess('Grade period created');
      setPeriodDialogOpen(false);
      setPeriodForm({ name: '', startsAt: '', endsAt: '' });
      const res = await gradesService.listPeriods(selectedCourse);
      setPeriods(res.data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to create grade period');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveScore = async (enrollmentId: string) => {
    if (!selectedPeriod) {
      setError('Select a grade period first.');
      return;
    }
    const scoreValue = Number(scores[enrollmentId]);
    if (Number.isNaN(scoreValue)) return;
    try {
      await gradesService.upsertEntry(enrollmentId, selectedPeriod, scoreValue);
      showSuccess('Grade saved');
      fetchEntries();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to save grade');
    }
  };

  const entryFor = (enrollmentId: string) => entries.find((entry) => entry.enrollment.id === enrollmentId);

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
          Grades
        </Typography>
        <Typography variant="body2" color="textSecondary">
          {canEnter ? 'Enter and review grades for your courses.' : 'Your grades.'}
        </Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {canEnter && (
        <Card sx={{ p: 2, mb: 3 }}>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              select
              label="Course"
              value={selectedCourse}
              onChange={(e) => setSelectedCourse(e.target.value)}
              sx={{ minWidth: 220 }}
            >
              {courses.map((course) => (
                <MenuItem key={course.id} value={course.id}>
                  {course.code} - {course.title}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Grade Period"
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              sx={{ minWidth: 200 }}
              disabled={!selectedCourse}
            >
              {periods.map((period) => (
                <MenuItem key={period.id} value={period.id}>
                  {period.name}
                </MenuItem>
              ))}
            </TextField>
            <Button variant="outlined" onClick={() => setPeriodDialogOpen(true)} disabled={!selectedCourse}>
              New Grade Period
            </Button>
          </Box>

          {selectedCourse && selectedPeriod && enrollments.length > 0 && (
            <TableContainer sx={{ mt: 2 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Student</TableCell>
                    <TableCell>Current</TableCell>
                    <TableCell>New Score</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {enrollments.map((enrollment) => {
                    const existing = entryFor(enrollment.id);
                    return (
                      <TableRow key={enrollment.id}>
                        <TableCell>
                          {enrollment.student.firstName} {enrollment.student.lastName}
                        </TableCell>
                        <TableCell>
                          {existing ? <Chip label={`${existing.score} (${existing.letterGrade})`} size="small" /> : '—'}
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            type="number"
                            placeholder="0-100"
                            value={scores[enrollment.id] ?? ''}
                            onChange={(e) => setScores({ ...scores, [enrollment.id]: e.target.value })}
                            sx={{ width: 100 }}
                          />
                        </TableCell>
                        <TableCell>
                          <Button size="small" onClick={() => handleSaveScore(enrollment.id)}>
                            Save
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Card>
      )}

      {loading && <CircularProgress sx={{ mb: 2 }} />}

      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Grade Period</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Score</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Letter Grade</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{entry.gradePeriod.name}</TableCell>
                  <TableCell>{entry.score}</TableCell>
                  <TableCell>
                    <Chip label={entry.letterGrade} size="small" />
                  </TableCell>
                </TableRow>
              ))}
              {entries.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={3}>
                    <Typography variant="body2" color="text.secondary">
                      No grades recorded yet.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Dialog open={periodDialogOpen} onClose={() => setPeriodDialogOpen(false)} fullWidth>
        <DialogTitle>New Grade Period</DialogTitle>
        <DialogContent>
          <TextField
            label="Name"
            fullWidth
            margin="normal"
            placeholder="e.g. Midterm, Final"
            value={periodForm.name}
            onChange={(e) => setPeriodForm({ ...periodForm, name: e.target.value })}
          />
          <TextField
            label="Starts"
            type="date"
            fullWidth
            margin="normal"
            InputLabelProps={{ shrink: true }}
            value={periodForm.startsAt}
            onChange={(e) => setPeriodForm({ ...periodForm, startsAt: e.target.value })}
          />
          <TextField
            label="Ends"
            type="date"
            fullWidth
            margin="normal"
            InputLabelProps={{ shrink: true }}
            value={periodForm.endsAt}
            onChange={(e) => setPeriodForm({ ...periodForm, endsAt: e.target.value })}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPeriodDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreatePeriod} disabled={!periodForm.name || !periodForm.startsAt || !periodForm.endsAt}>
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Grades;
