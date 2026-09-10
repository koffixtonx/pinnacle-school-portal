import React from 'react';
import {
  Box,
  Card,
  CardContent,
  CardActions,
  Grid,
  Typography,
  Chip,
  Button,
  IconButton,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  MenuItem,
  Alert,
  CircularProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import PeopleIcon from '@mui/icons-material/People';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import { academicsService, adminService } from '../services/api.service';
import { isAdminRole, useCurrentUser } from '../hooks/useCurrentUser';

interface Teacher {
  id: string;
  firstName: string;
  lastName: string;
}

interface Student {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface CourseRow {
  id: string;
  title: string;
  code: string;
  description: string;
  level?: string;
  teachers: Teacher[];
  _count: { enrollments: number };
}

const emptyForm = { title: '', code: '', description: '', level: '100', teacherIds: [] as string[] };

const Courses: React.FC = () => {
  const user = useCurrentUser();
  const isAdmin = isAdminRole(user?.role);

  const [courses, setCourses] = React.useState<CourseRow[]>([]);
  const [teachers, setTeachers] = React.useState<Teacher[]>([]);
  const [students, setStudents] = React.useState<Student[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState('');

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState(emptyForm);

  const [enrollDialogCourseId, setEnrollDialogCourseId] = React.useState<string | null>(null);
  const [enrollStudentId, setEnrollStudentId] = React.useState('');

  const showSuccess = (message: string) => {
    setSuccess(message);
    setTimeout(() => setSuccess(''), 3000);
  };

  const fetchCourses = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await academicsService.listCourses();
      setCourses(response.data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load courses');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchCourses();
    if (isAdmin) {
      adminService.listTeachers().then((res) => setTeachers(res.data.data)).catch(() => {});
      adminService.listStudents({ limit: 100 }).then((res) => setStudents(res.data.data)).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreateDialog = () => {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEditDialog = (course: CourseRow) => {
    setEditingId(course.id);
    setForm({
      title: course.title,
      code: course.code,
      description: course.description,
      level: course.level ?? '100',
      teacherIds: course.teachers.map((t) => t.id),
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    try {
      setLoading(true);
      setError('');
      if (editingId) {
        await academicsService.updateCourse(editingId, form);
        showSuccess('Course updated');
      } else {
        await academicsService.createCourse(form.title, form.code, form.description, form.teacherIds, form.level);
        showSuccess('Course created');
      }
      setDialogOpen(false);
      fetchCourses();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to save course');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this course? This also removes its enrollments and timetable slots.')) return;
    try {
      await academicsService.deleteCourse(id);
      showSuccess('Course deleted');
      fetchCourses();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to delete course');
    }
  };

  const handleEnroll = async () => {
    if (!enrollDialogCourseId || !enrollStudentId) return;
    try {
      await academicsService.enrollStudent(enrollDialogCourseId, enrollStudentId);
      showSuccess('Student enrolled');
      setEnrollDialogCourseId(null);
      setEnrollStudentId('');
      fetchCourses();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to enroll student');
    }
  };

  return (
    <Box>
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
            Courses
          </Typography>
          <Typography variant="body2" color="textSecondary">
            {isAdmin ? 'Manage courses, teaching assignments and enrollment.' : 'Your courses.'}
          </Typography>
        </Box>
        {isAdmin && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreateDialog}>
            New Course
          </Button>
        )}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}
      {loading && <CircularProgress sx={{ mb: 2 }} />}

      <Grid container spacing={2}>
        {courses.map((course) => (
          <Grid key={course.id} xs={12} sm={6} md={4}>
            <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <CardContent sx={{ flexGrow: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Typography variant="h6">{course.title}</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <Chip label={`${course.level ?? '100'} Level`} size="small" color="primary" />
                    <Chip label={course.code} size="small" variant="outlined" />
                  </Box>
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
                  {course.description || 'No description yet.'}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  {course.teachers.length > 0
                    ? `Taught by ${course.teachers.map((t) => `${t.firstName} ${t.lastName}`).join(', ')}`
                    : 'No teacher assigned yet'}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1 }}>
                  <PeopleIcon fontSize="small" color="action" />
                  <Typography variant="caption" color="text.secondary">
                    {course._count.enrollments} student{course._count.enrollments === 1 ? '' : 's'} enrolled
                  </Typography>
                </Box>
              </CardContent>
              {isAdmin && (
                <CardActions>
                  <IconButton size="small" onClick={() => openEditDialog(course)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" color="error" onClick={() => handleDelete(course.id)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" onClick={() => setEnrollDialogCourseId(course.id)}>
                    <PersonAddIcon fontSize="small" />
                  </IconButton>
                </CardActions>
              )}
            </Card>
          </Grid>
        ))}
        {courses.length === 0 && !loading && (
          <Grid xs={12}>
            <Typography variant="body2" color="text.secondary">
              No courses yet.
            </Typography>
          </Grid>
        )}
      </Grid>

      {/* Create/Edit Course Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth>
        <DialogTitle>{editingId ? 'Edit Course' : 'New Course'}</DialogTitle>
        <DialogContent>
          <TextField
            label="Title"
            fullWidth
            margin="normal"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <TextField
            label="Code"
            fullWidth
            margin="normal"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
          />
          <TextField
            label="Description"
            fullWidth
            multiline
            rows={2}
            margin="normal"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <TextField
            select
            label="Course level"
            fullWidth
            margin="normal"
            value={form.level}
            onChange={(e) => setForm({ ...form, level: e.target.value })}
          >
            {['100', '200', '300', '400', '500'].map((level) => (
              <MenuItem key={level} value={level}>{level} Level</MenuItem>
            ))}
          </TextField>
          <TextField
            select
            SelectProps={{ multiple: true }}
            label="Teachers"
            fullWidth
            margin="normal"
            value={form.teacherIds}
            onChange={(e) => {
              const value = e.target.value;
              const teacherIds = Array.isArray(value) ? value : String(value).split(',').filter(Boolean);
              setForm({ ...form, teacherIds });
            }}
          >
            {teachers.map((teacher) => (
              <MenuItem key={teacher.id} value={teacher.id}>
                {teacher.firstName} {teacher.lastName}
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={!form.title || !form.code}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Enroll Student Dialog */}
      <Dialog open={!!enrollDialogCourseId} onClose={() => setEnrollDialogCourseId(null)} fullWidth>
        <DialogTitle>Enroll a Student</DialogTitle>
        <DialogContent>
          <TextField
            select
            label="Student"
            fullWidth
            margin="normal"
            value={enrollStudentId}
            onChange={(e) => setEnrollStudentId(e.target.value)}
          >
            {students.map((student) => (
              <MenuItem key={student.id} value={student.id}>
                {student.firstName} {student.lastName} ({student.email})
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEnrollDialogCourseId(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleEnroll} disabled={!enrollStudentId}>
            Enroll
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Courses;
