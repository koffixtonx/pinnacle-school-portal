import React from 'react';
import {
  Box,
  Card,
  CardContent,
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
  Grid,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { academicsService, adminService } from '../services/api.service';
import { isAdminRole, useCurrentUser } from '../hooks/useCurrentUser';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

interface Slot {
  id: string;
  dayOfWeek: number;
  startsAt: string;
  endsAt: string;
  room: string;
  course: { id: string; title: string; code: string };
  classSection: { id: string; name: string };
  teacher: { id: string; firstName: string; lastName: string };
}

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

const emptyForm = {
  courseId: '',
  classSectionId: '',
  teacherId: '',
  dayOfWeek: 0,
  startTime: '09:00',
  endTime: '10:00',
  room: '',
};

const Timetable: React.FC = () => {
  const user = useCurrentUser();
  const isAdmin = isAdminRole(user?.role);

  const [slots, setSlots] = React.useState<Slot[]>([]);
  const [courses, setCourses] = React.useState<Array<{ id: string; title: string }>>([]);
  const [classes, setClasses] = React.useState<Array<{ id: string; name: string }>>([]);
  const [teachers, setTeachers] = React.useState<Array<{ id: string; firstName: string; lastName: string }>>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState('');
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [form, setForm] = React.useState(emptyForm);

  const showSuccess = (message: string) => {
    setSuccess(message);
    setTimeout(() => setSuccess(''), 3000);
  };

  const fetchSlots = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await academicsService.listTimetable();
      setSlots(response.data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load timetable');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchSlots();
    if (isAdmin) {
      academicsService.listCourses().then((res) => setCourses(res.data.data)).catch(() => {});
      academicsService.listClassSections().then((res) => setClasses(res.data.data)).catch(() => {});
      adminService.listTeachers().then((res) => setTeachers(res.data.data)).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async () => {
    try {
      setLoading(true);
      setError('');
      const today = new Date();
      // Anchor start/end times on an arbitrary reference date - only the
      // hour/minute and dayOfWeek matter for display and scheduling here.
      const [startHour, startMinute] = form.startTime.split(':').map(Number);
      const [endHour, endMinute] = form.endTime.split(':').map(Number);
      const startsAt = new Date(today);
      startsAt.setHours(startHour, startMinute, 0, 0);
      const endsAt = new Date(today);
      endsAt.setHours(endHour, endMinute, 0, 0);

      await academicsService.createTimetableSlot({
        courseId: form.courseId,
        classSectionId: form.classSectionId,
        teacherId: form.teacherId,
        dayOfWeek: form.dayOfWeek,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        room: form.room,
      });
      showSuccess('Timetable slot added');
      setDialogOpen(false);
      setForm(emptyForm);
      fetchSlots();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to add slot');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Remove this timetable slot?')) return;
    try {
      await academicsService.deleteTimetableSlot(id);
      showSuccess('Slot removed');
      fetchSlots();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to remove slot');
    }
  };

  return (
    <Box>
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
            Timetable
          </Typography>
          <Typography variant="body2" color="textSecondary">
            {isAdmin ? 'Manage the weekly class schedule.' : 'Your weekly schedule.'}
          </Typography>
        </Box>
        {isAdmin && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
            Add Slot
          </Button>
        )}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}
      {loading && <CircularProgress sx={{ mb: 2 }} />}

      <Grid container spacing={2}>
        {DAYS.map((day, dayIndex) => {
          const daySlots = slots
            .filter((slot) => slot.dayOfWeek === dayIndex)
            .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
          return (
            <Grid key={day} item xs={12} md={12 / 5}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                {day}
              </Typography>
              <Box sx={{ display: 'grid', gap: 1 }}>
                {daySlots.map((slot) => (
                  <Card key={slot.id} variant="outlined">
                    <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {slot.course.code} - {slot.course.title}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" display="block">
                            {formatTime(slot.startsAt)} - {formatTime(slot.endsAt)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" display="block">
                            {slot.classSection.name} · {slot.teacher.firstName} {slot.teacher.lastName}
                          </Typography>
                          {slot.room && <Chip label={slot.room} size="small" sx={{ mt: 0.5 }} />}
                        </Box>
                        {isAdmin && (
                          <IconButton size="small" onClick={() => handleDelete(slot.id)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        )}
                      </Box>
                    </CardContent>
                  </Card>
                ))}
                {daySlots.length === 0 && (
                  <Typography variant="caption" color="text.secondary">
                    No classes
                  </Typography>
                )}
              </Box>
            </Grid>
          );
        })}
      </Grid>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth>
        <DialogTitle>Add Timetable Slot</DialogTitle>
        <DialogContent>
          <TextField
            select
            label="Course"
            fullWidth
            margin="normal"
            value={form.courseId}
            onChange={(e) => setForm({ ...form, courseId: e.target.value })}
          >
            {courses.map((course) => (
              <MenuItem key={course.id} value={course.id}>
                {course.title}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Class Section"
            fullWidth
            margin="normal"
            value={form.classSectionId}
            onChange={(e) => setForm({ ...form, classSectionId: e.target.value })}
          >
            {classes.map((section) => (
              <MenuItem key={section.id} value={section.id}>
                {section.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Teacher"
            fullWidth
            margin="normal"
            value={form.teacherId}
            onChange={(e) => setForm({ ...form, teacherId: e.target.value })}
          >
            {teachers.map((teacher) => (
              <MenuItem key={teacher.id} value={teacher.id}>
                {teacher.firstName} {teacher.lastName}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Day"
            fullWidth
            margin="normal"
            value={form.dayOfWeek}
            onChange={(e) => setForm({ ...form, dayOfWeek: Number(e.target.value) })}
          >
            {DAYS.map((day, index) => (
              <MenuItem key={day} value={index}>
                {day}
              </MenuItem>
            ))}
          </TextField>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              label="Start Time"
              type="time"
              fullWidth
              margin="normal"
              value={form.startTime}
              onChange={(e) => setForm({ ...form, startTime: e.target.value })}
            />
            <TextField
              label="End Time"
              type="time"
              fullWidth
              margin="normal"
              value={form.endTime}
              onChange={(e) => setForm({ ...form, endTime: e.target.value })}
            />
          </Box>
          <TextField
            label="Room"
            fullWidth
            margin="normal"
            value={form.room}
            onChange={(e) => setForm({ ...form, room: e.target.value })}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={!form.courseId || !form.classSectionId || !form.teacherId}
          >
            Add
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Timetable;
