import React from 'react';
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
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DownloadIcon from '@mui/icons-material/Download';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import { academicsService, materialService } from '../services/api.service';
import type { CourseMaterial } from '../services/api.service';
import { isAdminRole, useCurrentUser } from '../hooks/useCurrentUser';

type Material = CourseMaterial & { course?: { id: string; code: string; title: string } | null };

const MAX_MB = 50;

const day = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

const humanSize = (bytes?: number | null) => {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

interface Draft {
  id?: string;
  courseId: string;
  title: string;
  description: string;
  weekLabel: string;
  file: File | null;
}

const Materials: React.FC = () => {
  const currentUser = useCurrentUser();
  const isStudent = currentUser?.role === 'STUDENT';
  const canPublish = !isStudent;

  const [items, setItems] = React.useState<Material[]>([]);
  const [courses, setCourses] = React.useState<Array<{ id: string; code: string; title: string }>>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [busy, setBusy] = React.useState(false);

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 4000);
  };

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await materialService.listVisible();
      setItems(response.data.data as Material[]);
      if (canPublish) {
        const all = await academicsService.listCourses();
        const mine = all.data.data.filter(
          (course: any) =>
            isAdminRole(currentUser?.role) ||
            (course.teachers ?? []).some((teacher: any) => teacher.id === currentUser?.id),
        );
        setCourses(mine.map((course: any) => ({ id: course.id, code: course.code, title: course.title })));
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Your materials could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [canPublish, currentUser?.id, currentUser?.role]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const grouped = React.useMemo(() => {
    const map = new Map<string, { course: string; items: Material[] }>();
    items.forEach((item) => {
      const key = item.course?.id ?? item.courseId;
      const label = item.course ? `${item.course.code} — ${item.course.title}` : 'Course';
      const group = map.get(key) ?? { course: label, items: [] };
      group.items.push(item);
      map.set(key, group);
    });
    return [...map.values()];
  }, [items]);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError('');
    try {
      if (draft.id) {
        await materialService.edit(draft.id, {
          title: draft.title,
          description: draft.description,
          weekLabel: draft.weekLabel,
        });
        flash('The handout was renamed.');
      } else {
        if (!draft.file) {
          setError('Choose the file to attach.');
          return;
        }
        await materialService.publish({
          courseId: draft.courseId,
          title: draft.title,
          description: draft.description,
          weekLabel: draft.weekLabel,
          file: draft.file,
        });
        flash('Published. The class can open it now.');
      }
      setDraft(null);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'The material could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const openFile = async (material: Material) => {
    setError('');
    try {
      const response = await materialService.download(material.storagePath);
      window.open(response.data.data, '_blank', 'noopener');
    } catch (err: any) {
      setError(err.response?.data?.message || 'That file could not be opened.');
    }
  };

  const remove = async (material: Material) => {
    setError('');
    try {
      await materialService.remove(material.id);
      flash(`"${material.title}" has been taken down, file and all.`);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'The material could not be removed.');
    }
  };

  return (
    <Box>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: { xs: 'flex-start', sm: 'center' }, flexWrap: 'wrap', mb: 3 }}
      >
        <Box sx={{ flexGrow: 1, minWidth: 220 }}>
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
            Course materials
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {isStudent
              ? 'Handouts, slides and readings your lecturers have put up.'
              : 'What you have put up for the courses you teach. The office sees the whole school.'}
          </Typography>
        </Box>
        {canPublish && (
          <Button
            variant="contained"
            startIcon={<UploadFileIcon />}
            disabled={!courses.length}
            onClick={() =>
              setDraft({ courseId: courses[0]?.id ?? '', title: '', description: '', weekLabel: '', file: null })
            }
          >
            Upload a material
          </Button>
        )}
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice('')}>{notice}</Alert>}
      {canPublish && !courses.length && !loading && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No course is attached to you yet, so there is nothing to upload materials to.
        </Alert>
      )}

      {loading && <CircularProgress sx={{ mb: 2 }} />}

      {!loading && !items.length && (
        <Card>
          <CardContent>
            <Typography variant="body2" color="text.secondary">
              {isStudent
                ? 'Nothing has been shared with you yet. Handouts appear here as soon as a lecturer puts one up.'
                : 'You have not shared any material yet.'}
            </Typography>
          </CardContent>
        </Card>
      )}

      <Stack spacing={2}>
        {grouped.map((group) => (
          <Card key={group.course}>
            <CardContent>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
                <FolderOpenIcon fontSize="small" color="primary" />
                <Typography variant="subtitle1" sx={{ fontWeight: 700, flexGrow: 1, minWidth: 0 }}>
                  {group.course}
                </Typography>
                <Chip size="small" variant="outlined" label={`${group.items.length} file(s)`} />
              </Stack>
              <Divider sx={{ mb: 1 }} />
              <Stack spacing={1}>
                {group.items.map((material) => (
                  <Box key={material.id}>
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      spacing={1}
                      sx={{ alignItems: { xs: 'flex-start', sm: 'center' } }}
                    >
                      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {material.title}
                          {material.weekLabel && (
                            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                              {material.weekLabel}
                            </Typography>
                          )}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {material.fileName}
                          {material.sizeBytes != null ? ` · ${humanSize(material.sizeBytes)}` : ''} ·{' '}
                          {day(material.createdAt)}
                        </Typography>
                        {material.description && (
                          <Typography variant="body2" sx={{ whiteSpace: 'pre-line', mt: 0.5 }}>
                            {material.description}
                          </Typography>
                        )}
                      </Box>
                      <Stack direction="row" spacing={0.5}>
                        <Button size="small" startIcon={<DownloadIcon />} onClick={() => void openFile(material)}>
                          Open
                        </Button>
                        {canPublish && (
                          <>
                            <Button
                              size="small"
                              startIcon={<EditIcon />}
                              onClick={() =>
                                setDraft({
                                  id: material.id,
                                  courseId: material.courseId,
                                  title: material.title,
                                  description: material.description ?? '',
                                  weekLabel: material.weekLabel ?? '',
                                  file: null,
                                })
                              }
                            >
                              Rename
                            </Button>
                            <Button
                              size="small"
                              color="error"
                              startIcon={<DeleteOutlineIcon />}
                              onClick={() => void remove(material)}
                            >
                              Remove
                            </Button>
                          </>
                        )}
                      </Stack>
                    </Stack>
                  </Box>
                ))}
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>

      <Dialog open={Boolean(draft)} onClose={() => setDraft(null)} fullWidth maxWidth="sm">
        <DialogTitle>{draft?.id ? 'Rename the handout' : 'Upload a material'}</DialogTitle>
        <DialogContent>
          {draft && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              {!draft.id && (
                <TextField
                  select
                  label="Course"
                  value={draft.courseId}
                  onChange={(event) => setDraft({ ...draft, courseId: event.target.value })}
                  helperText="Only the courses you teach are listed."
                >
                  {courses.map((course) => (
                    <MenuItem key={course.id} value={course.id}>
                      {course.code} — {course.title}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              <TextField
                label="Title"
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                helperText="What the class sees in the list."
              />
              <TextField
                label="Week or unit"
                value={draft.weekLabel}
                onChange={(event) => setDraft({ ...draft, weekLabel: event.target.value })}
                placeholder="Week 3"
              />
              <TextField
                label="Note for the class"
                multiline
                minRows={2}
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
              {!draft.id && (
                <>
                  <Button variant="outlined" component="label" startIcon={<UploadFileIcon />}>
                    {draft.file ? `${draft.file.name} (${humanSize(draft.file.size)})` : `Choose a file (up to ${MAX_MB} MB)`}
                    <input
                      type="file"
                      hidden
                      onChange={(event) => setDraft({ ...draft, file: event.target.files?.[0] ?? null })}
                    />
                  </Button>
                  <Typography variant="caption" color="text.secondary">
                    The file is stored privately. Anyone who opens it gets a link that expires in two minutes.
                  </Typography>
                </>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>Cancel</Button>
          <Button variant="contained" disabled={busy} onClick={() => void save()}>
            {busy ? 'Working…' : draft?.id ? 'Save' : 'Publish'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Materials;
