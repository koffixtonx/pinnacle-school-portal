import React from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import { assignmentService } from '../services/api.service';
import type { Assignment, AssignmentRoster } from '../services/api.service';

const dayTime = (value?: string | null) =>
  value ? new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

const rosterChip = (status: string | null) => {
  if (!status) return <Chip size="small" color="default" label="Not handed in" />;
  if (status === 'GRADED') return <Chip size="small" color="success" label="Marked" />;
  if (status === 'LATE') return <Chip size="small" color="warning" label="Late" />;
  return <Chip size="small" color="info" label="Submitted" />;
};

const AssignmentReview: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const [assignments, setAssignments] = React.useState<Assignment[]>([]);
  const [assignmentId, setAssignmentId] = React.useState(params.get('id') ?? '');
  const [roster, setRoster] = React.useState<AssignmentRoster | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingRoster, setLoadingRoster] = React.useState(false);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [marking, setMarking] = React.useState<AssignmentRoster['students'][number] | null>(null);

  const assignment = assignments.find((row) => row.id === assignmentId) ?? null;

  React.useEffect(() => {
    let cancelled = false;
    assignmentService
      .listOwned()
      .then((response) => {
        if (cancelled) return;
        const rows = response.data.data;
        setAssignments(rows);
        if (!assignmentId && rows.length) {
          setAssignmentId(rows[0].id);
          setParams({ id: rows[0].id }, { replace: true });
        }
      })
      .catch((err: any) => setError(err.response?.data?.message || 'Your assignments could not be loaded.'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [assignmentId, setParams]);

  React.useEffect(() => {
    if (!assignmentId) return;
    let cancelled = false;
    setLoadingRoster(true);
    setError('');
    assignmentService
      .roster(assignmentId)
      .then((response) => { if (!cancelled) setRoster(response.data.data); })
      .catch((err: any) => setError(err.response?.data?.message || 'The roster could not be loaded.'))
      .finally(() => { if (!cancelled) setLoadingRoster(false); });
    return () => { cancelled = true; };
  }, [assignmentId]);

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 4000);
  };

  const choose = (id: string) => {
    setAssignmentId(id);
    setParams(id ? { id } : {}, { replace: true });
  };

  const saveMark = async (score: number, feedback: string) => {
    if (!marking?.submissionId) return;
    setError('');
    try {
      await assignmentService.grade(marking.submissionId, score, feedback);
      setMarking(null);
      flash(`${marking.firstName} ${marking.lastName} has been marked, and told.`);
      const response = await assignmentService.roster(assignmentId);
      setRoster(response.data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'The mark could not be saved.');
    }
  };

  const openFile = async (filePath: string) => {
    setError('');
    try {
      const response = await assignmentService.download(filePath);
      window.open(response.data.data, '_blank', 'noopener');
    } catch (err: any) {
      setError(err.response?.data?.message || 'That file could not be opened.');
    }
  };

  if (loading) return <CircularProgress />;

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
        Marking
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        The roll as it stood when you opened this page. A mark is sent to the student the moment you save it.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice('')}>{notice}</Alert>}

      {!assignments.length ? (
        <Card>
          <CardContent>
            <Typography variant="body2" color="text.secondary">
              You have not set any assignments yet, so there is nothing to mark.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Stack spacing={1.5}>
                <TextField
                  select
                  label="Assignment"
                  value={assignmentId}
                  onChange={(event) => choose(event.target.value)}
                  size="small"
                >
                  {assignments.map((row) => (
                    <MenuItem key={row.id} value={row.id}>
                      {row.course?.code ? `${row.course.code} — ` : ''}{row.title}
                    </MenuItem>
                  ))}
                </TextField>

                {assignment && (
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography variant="body2" color="text.secondary">
                      Due {dayTime(assignment.dueAt)} · {assignment.points} marks · {assignment.status.toLowerCase()}
                    </Typography>
                  </Stack>
                )}

                {roster && (
                  <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                    <Chip size="small" label={`${roster.submitted} handed in`} />
                    <Chip size="small" color="warning" variant="outlined" label={`${roster.late} late`} />
                    <Chip size="small" color="success" variant="outlined" label={`${roster.graded} marked`} />
                    <Chip size="small" variant="outlined" label={`${roster.missing} not handed in`} />
                  </Stack>
                )}
              </Stack>
            </CardContent>
          </Card>

          {loadingRoster && <CircularProgress sx={{ mb: 2 }} />}

          {!loadingRoster && roster && !roster.students.length && (
            <Alert severity="info">Nobody is on the roll for this course yet.</Alert>
          )}

          <Stack spacing={1.5}>
            {roster?.students.map((student) => (
              <Card key={student.studentId} variant="outlined">
                <CardContent>
                  <Stack direction="row" spacing={1} sx={{ alignItems: { xs: 'flex-start', sm: 'center' }, flexWrap: 'wrap' }}>
                    <Box sx={{ flexGrow: 1, minWidth: 180 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                        {student.lastName}, {student.firstName}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {student.matricNumber ?? 'no matric number'}
                        {student.submittedAt ? ` · handed in ${dayTime(student.submittedAt)}` : ''}
                      </Typography>
                    </Box>
                    {rosterChip(student.status)}
                    {student.score != null && (
                      <Chip size="small" label={`${Number(student.score).toFixed(2)} / ${assignment?.points ?? '?'}`} color="primary" />
                    )}
                    <Stack direction="row" spacing={1}>
                      {student.filePath && (
                        <Button size="small" startIcon={<DownloadIcon />} onClick={() => void openFile(student.filePath!)}>
                          File
                        </Button>
                      )}
                      <Button
                        size="small"
                        variant="contained"
                        disabled={!student.submissionId}
                        onClick={() => setMarking(student)}
                      >
                        {student.status === 'GRADED' ? 'Change mark' : 'Mark'}
                      </Button>
                    </Stack>
                  </Stack>

                  {student.note && (
                    <Typography variant="body2" sx={{ mt: 1, whiteSpace: 'pre-line' }}>
                      {student.note}
                    </Typography>
                  )}
                  {student.feedback && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                      Your feedback: {student.feedback}
                    </Typography>
                  )}
                </CardContent>
              </Card>
            ))}
          </Stack>
        </>
      )}

      <MarkDialog
        student={marking}
        points={assignment?.points ?? 10}
        onClose={() => setMarking(null)}
        onSave={saveMark}
      />
    </Box>
  );
};

const MarkDialog: React.FC<{
  student: AssignmentRoster['students'][number] | null;
  points: number;
  onClose: () => void;
  onSave: (score: number, feedback: string) => Promise<void>;
}> = ({ student, points, onClose, onSave }) => {
  const [score, setScore] = React.useState('');
  const [feedback, setFeedback] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [localError, setLocalError] = React.useState('');

  React.useEffect(() => {
    setScore(student?.score != null ? String(student.score) : '');
    setFeedback(student?.feedback ?? '');
    setLocalError('');
  }, [student]);

  const save = async () => {
    const value = Number(score);
    if (score.trim() === '' || !Number.isFinite(value) || value < 0) {
      setLocalError('Enter the mark to record.');
      return;
    }
    if (value > points) {
      setLocalError(`${value} is more than this assignment is worth.`);
      return;
    }
    setBusy(true);
    try {
      await onSave(value, feedback.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(student)} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>
        Mark {student?.firstName} {student?.lastName}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {localError && <Alert severity="error">{localError}</Alert>}
          <TextField
            label={`Mark out of ${points}`}
            type="number"
            value={score}
            onChange={(event) => setScore(event.target.value)}
            slotProps={{ htmlInput: { min: 0, max: points, step: 0.5 } }}
          />
          <TextField
            label="Feedback"
            multiline
            minRows={3}
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            helperText="Sent to the student with the mark."
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save mark'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AssignmentReview;
