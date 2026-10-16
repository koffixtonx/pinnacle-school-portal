import React from 'react';
import { useNavigate } from 'react-router-dom';
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
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import PublishIcon from '@mui/icons-material/Publish';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DownloadIcon from '@mui/icons-material/Download';
import { academicsService, assignmentService } from '../services/api.service';
import type { Assignment } from '../services/api.service';
import { isAdminRole, useCurrentUser } from '../hooks/useCurrentUser';

const statusChip = (status: Assignment['status']) => ({
  DRAFT: { label: 'Draft', color: 'default' as const },
  PUBLISHED: { label: 'Open', color: 'primary' as const },
  CLOSED: { label: 'Closed', color: 'default' as const },
}[status]);

const submissionChip = (status: string | undefined) => {
  if (!status) return null;
  return {
    SUBMITTED: { label: 'Submitted', color: 'info' as const },
    LATE: { label: 'Handed in late', color: 'warning' as const },
    GRADED: { label: 'Marked', color: 'success' as const },
  }[status as 'SUBMITTED' | 'LATE' | 'GRADED'] ?? null;
};

const dayTime = (value: string) =>
  new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** "in 3 days" / "2 hours late": a due date without a sense of distance is not useful. */
const dueDistance = (value: string) => {
  const hours = (new Date(value).getTime() - Date.now()) / 3_600_000;
  if (hours < 0) return `${Math.max(Math.round(-hours / 24), 1)} day(s) overdue`;
  if (hours < 24) return `due in ${Math.max(Math.round(hours), 1)} hour(s)`;
  return `due in ${Math.round(hours / 24)} day(s)`;
};

const toLocalInput = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

interface Composer {
  id?: string;
  courseId: string;
  title: string;
  instructions: string;
  dueAt: string;
  points: string;
}

const Assignments: React.FC = () => {
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const isStudent = currentUser?.role === 'STUDENT';
  const canCompose = !isStudent;

  const [items, setItems] = React.useState<Assignment[]>([]);
  const [courses, setCourses] = React.useState<Array<{ id: string; code: string; title: string }>>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [composer, setComposer] = React.useState<Composer | null>(null);
  const [composerBusy, setComposerBusy] = React.useState(false);
  const [submitting, setSubmitting] = React.useState<Assignment | null>(null);

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 4000);
  };

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = isStudent ? await assignmentService.listForStudent() : await assignmentService.listOwned();
      setItems(response.data.data);
      if (canCompose) {
        const all = await academicsService.listCourses();
        const mine = all.data.data.filter(
          (course: any) =>
            isAdminRole(currentUser?.role) ||
            (course.teachers ?? []).some((teacher: any) => teacher.id === currentUser?.id),
        );
        setCourses(mine.map((course: any) => ({ id: course.id, code: course.code, title: course.title })));
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Your assignments could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [canCompose, currentUser?.id, currentUser?.role, isStudent]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!composer) return;
    setComposerBusy(true);
    setError('');
    try {
      const data = {
        courseId: composer.courseId,
        title: composer.title,
        instructions: composer.instructions,
        dueAt: composer.dueAt,
        points: Number(composer.points),
      };
      if (composer.id) await assignmentService.edit(composer.id, data);
      else await assignmentService.create(data);
      setComposer(null);
      flash(composer.id ? 'The assignment was updated.' : 'The draft was saved. Publish it when you are ready.');
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'The assignment could not be saved.');
    } finally {
      setComposerBusy(false);
    }
  };

  const publish = async (assignment: Assignment) => {
    setError('');
    try {
      const response = await assignmentService.publish(assignment.id);
      flash(`Published. It is now visible to ${response.data.data.students} student(s) on the roll.`);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'The assignment could not be published.');
    }
  };

  const close = async (assignment: Assignment) => {
    setError('');
    try {
      await assignmentService.close(assignment.id);
      flash('Closed. It no longer accepts work.');
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'The assignment could not be closed.');
    }
  };

  const handIn = async (note: string, file: File | null) => {
    if (!submitting) return;
    setError('');
    try {
      await assignmentService.submit({ assignmentId: submitting.id, note, file });
      setSubmitting(null);
      flash('Handed in.');
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Your work could not be handed in.');
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

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: { xs: 'flex-start', sm: 'center' }, flexWrap: 'wrap', mb: 3 }}>
        <Box sx={{ flexGrow: 1, minWidth: 220 }}>
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
            Assignments
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {isStudent
              ? 'Work your courses have set, soonest first. Hand it in here.'
              : 'Tasks on the courses you teach. A draft stays private until you publish it.'}
          </Typography>
        </Box>
        {canCompose && (
          <Button
            variant="contained"
            startIcon={<PublishIcon />}
            onClick={() => setComposer({ courseId: courses[0]?.id ?? '', title: '', instructions: '', dueAt: '', points: '10' })}
            disabled={!courses.length}
          >
            Set an assignment
          </Button>
        )}
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice('')}>{notice}</Alert>}
      {canCompose && !courses.length && !loading && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No course is attached to you yet, so there is nothing to set an assignment on.
        </Alert>
      )}

      {loading && <CircularProgress sx={{ mb: 2 }} />}

      {!loading && !items.length && (
        <Card>
          <CardContent>
            <Typography variant="body2" color="text.secondary">
              {isStudent
                ? 'Nothing has been set for your courses yet.'
                : 'You have not set any assignments yet. Create one and it stays a draft until you publish it.'}
            </Typography>
          </CardContent>
        </Card>
      )}

      <Stack spacing={2}>
        {items.map((assignment) => {
          const chip = statusChip(assignment.status);
          const mine = assignment.submission;
          return (
            <Card key={assignment.id} variant={assignment.status === 'DRAFT' ? 'outlined' : 'elevation'}>
              <CardContent>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 0.75 }}>
                  <Typography variant="h6" sx={{ fontWeight: 700, minWidth: 0, flexGrow: 1 }}>
                    {assignment.title}
                  </Typography>
                  <Chip size="small" label={`${assignment.course?.code ?? 'Course'} · ${assignment.course?.title ?? ''}`} variant="outlined" />
                  <Chip size="small" color={chip.color} label={chip.label} />
                  {isStudent && submissionChip(mine?.status) && (
                    <Chip
                      size="small"
                      color={submissionChip(mine?.status)!.color}
                      label={
                        mine?.status === 'GRADED' && mine?.score != null
                          ? `Marked ${Number(mine.score).toFixed(2)}/${assignment.points}`
                          : submissionChip(mine?.status)!.label
                      }
                    />
                  )}
                </Stack>

                <Typography variant="caption" color="text.secondary">
                  {dayTime(assignment.dueAt)} · {dueDistance(assignment.dueAt)} · {assignment.points} mark
                  {assignment.points === 1 ? '' : 's'}
                </Typography>

                {assignment.instructions && (
                  <>
                    <Divider sx={{ my: 1.25 }} />
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-line', lineHeight: 1.6 }}>
                      {assignment.instructions}
                    </Typography>
                  </>
                )}

                {isStudent && mine && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Handed in {dayTime(mine.submittedAt)}
                    {mine.fileName ? ' · ' : ''}
                    {mine.filePath && (
                      <Button size="small" startIcon={<DownloadIcon />} onClick={() => void openFile(mine.filePath!)}>
                        {mine.fileName}
                      </Button>
                    )}
                    {mine.status === 'GRADED' && mine.feedback ? ` · ${mine.feedback}` : ''}
                  </Typography>
                )}

                <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap' }}>
                  {isStudent ? (
                    <Button
                      size="small"
                      variant={mine ? 'outlined' : 'contained'}
                      startIcon={<UploadFileIcon />}
                      disabled={assignment.status !== 'PUBLISHED' || mine?.status === 'GRADED'}
                      onClick={() => setSubmitting(assignment)}
                    >
                      {mine ? 'Replace my answer' : 'Hand in'}
                    </Button>
                  ) : (
                    <>
                      {assignment.status === 'DRAFT' && (
                        <Button size="small" variant="contained" onClick={() => void publish(assignment)}>
                          Publish
                        </Button>
                      )}
                      {assignment.status === 'PUBLISHED' && (
                        <Button size="small" variant="outlined" onClick={() => void close(assignment)}>
                          Close
                        </Button>
                      )}
                      <Button size="small" onClick={() => setComposer({
                        id: assignment.id,
                        courseId: assignment.courseId,
                        title: assignment.title,
                        instructions: assignment.instructions,
                        dueAt: toLocalInput(assignment.dueAt),
                        points: String(assignment.points),
                      })}>
                        Edit
                      </Button>
                      <Button size="small" color="primary" onClick={() => navigate(`/assignment-review?id=${assignment.id}`)}>
                        Mark
                      </Button>
                    </>
                  )}
                </Stack>
              </CardContent>
            </Card>
          );
        })}
      </Stack>

      <Dialog open={Boolean(composer)} onClose={() => setComposer(null)} fullWidth maxWidth="sm">
        <DialogTitle>{composer?.id ? 'Edit the assignment' : 'Set an assignment'}</DialogTitle>
        <DialogContent>
          {composer && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                select
                label="Course"
                value={composer.courseId}
                onChange={(event) => setComposer({ ...composer, courseId: event.target.value })}
                disabled={Boolean(composer.id)}
                helperText={composer.id ? 'A task cannot be moved to another course.' : 'Only the courses you teach are listed.'}
              >
                {courses.map((course) => (
                  <MenuItem key={course.id} value={course.id}>
                    {course.code} — {course.title}
                  </MenuItem>
                ))}
              </TextField>
              <TextField label="Title" value={composer.title} onChange={(event) => setComposer({ ...composer, title: event.target.value })} />
              <TextField
                label="Instructions"
                multiline
                minRows={3}
                value={composer.instructions}
                onChange={(event) => setComposer({ ...composer, instructions: event.target.value })}
              />
              <TextField
                type="datetime-local"
                label="Due"
                value={composer.dueAt}
                onChange={(event) => setComposer({ ...composer, dueAt: event.target.value })}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                label="Marks out of"
                type="number"
                value={composer.points}
                onChange={(event) => setComposer({ ...composer, points: event.target.value })}
                slotProps={{ htmlInput: { min: 1, max: 100, step: 0.5 } }}
                helperText="Between 1 and 100. Marks are recorded against this ceiling, not the course grade."
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setComposer(null)}>Cancel</Button>
          <Button variant="contained" disabled={composerBusy} onClick={() => void save()}>
            {composerBusy ? 'Saving…' : 'Save draft'}
          </Button>
        </DialogActions>
      </Dialog>

      <HandInDialog
        assignment={submitting}
        busy={composerBusy}
        onClose={() => setSubmitting(null)}
        onSubmit={async (note, file) => {
          setComposerBusy(true);
          try {
            await handIn(note, file);
          } finally {
            setComposerBusy(false);
          }
        }}
      />
    </Box>
  );
};

const HandInDialog: React.FC<{
  assignment: Assignment | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (note: string, file: File | null) => Promise<void>;
}> = ({ assignment, busy, onClose, onSubmit }) => {
  const [note, setNote] = React.useState('');
  const [file, setFile] = React.useState<File | null>(null);
  const [localError, setLocalError] = React.useState('');

  React.useEffect(() => {
    setNote('');
    setFile(null);
    setLocalError('');
  }, [assignment?.id]);

  const send = async () => {
    if (!note.trim() && !file) {
      setLocalError('Write something or attach a file before handing it in.');
      return;
    }
    await onSubmit(note.trim(), file);
  };

  return (
    <Dialog open={Boolean(assignment)} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Hand in: {assignment?.title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {localError && <Alert severity="error">{localError}</Alert>}
          <TextField
            label="Your answer"
            multiline
            minRows={4}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            helperText="A written answer is enough for a seminar; attach a file for anything else."
          />
          <Button variant="outlined" component="label" startIcon={<UploadFileIcon />}>
            {file ? file.name : 'Attach a file'}
            <input
              type="file"
              hidden
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </Button>
          <Typography variant="caption" color="text.secondary">
            Files are limited to 20 MB. Work after the deadline is accepted and marked as late.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={busy} onClick={() => void send()}>
          {busy ? 'Sending…' : 'Hand in'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default Assignments;
