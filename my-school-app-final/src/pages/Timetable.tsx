import React from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { academicsService } from '../services/api.service';
import { isAdminRole, useCurrentUser } from '../hooks/useCurrentUser';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const HOURS = [8, 10, 12, 14, 16];
type Course = { id: string; code: string; title: string };
type Department = { id: string; name: string; courses: Course[] };
type Slot = { id: string; dayOfWeek: number; startHour: number; course: { code: string; title: string }; department: { name: string } };

const Timetable: React.FC = () => {
  const isAdmin = isAdminRole(useCurrentUser()?.role);
  const [slots, setSlots] = React.useState<Slot[]>([]);
  const [departments, setDepartments] = React.useState<Department[]>([]);
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ departmentId: '', courseId: '', dayOfWeek: 1, startHour: 8 });

  const load = async () => {
    try {
      setLoading(true);
      const [timetable, hierarchy] = await Promise.all([academicsService.listDepartmentTimetable(), academicsService.getCourseHierarchy()]);
      setSlots(timetable.data.data);
      setDepartments(hierarchy.data.data.flatMap((faculty: { departments: Department[] }) => faculty.departments));
    } catch (err: any) { setError(err.response?.data?.message || 'Unable to load timetable.'); }
    finally { setLoading(false); }
  };
  React.useEffect(() => { void load(); }, []);
  const courses = departments.find((department) => department.id === form.departmentId)?.courses ?? [];
  const save = async () => {
    try {
      setError('');
      await academicsService.createDepartmentTimetableSlot(form);
      setOpen(false); setForm({ departmentId: '', courseId: '', dayOfWeek: 1, startHour: 8 }); await load();
    } catch (err: any) { setError(err.response?.data?.message || 'Unable to assign course.'); }
  };
  const remove = async (id: string) => { try { await academicsService.deleteDepartmentTimetableSlot(id); await load(); } catch (err: any) { setError(err.response?.data?.message || 'Unable to remove assignment.'); } };
  const slotAt = (dayOfWeek: number, startHour: number) => slots.find((slot) => slot.dayOfWeek === dayOfWeek && slot.startHour === startHour);

  return <Box>
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}><Typography variant="h4" fontWeight={700}>Department timetable</Typography>{isAdmin && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>Assign course</Button>}</Box>
    <Typography color="text.secondary" sx={{ mb: 3 }}>Fixed two-hour periods, back to back, from 08:00 to 18:00.</Typography>
    {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
    {loading ? <CircularProgress /> : <TableContainer><Table><TableHead><TableRow><TableCell>Time</TableCell>{DAYS.map((day) => <TableCell key={day}>{day}</TableCell>)}</TableRow></TableHead><TableBody>{HOURS.map((hour) => <TableRow key={hour}><TableCell sx={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{String(hour).padStart(2, '0')}:00 – {String(hour + 2).padStart(2, '0')}:00</TableCell>{DAYS.map((_, index) => { const slot = slotAt(index + 1, hour); return <TableCell key={index} sx={{ minWidth: 150, verticalAlign: 'top' }}>{slot ? <><Typography variant="body2" fontWeight={700}>{slot.course.code}</Typography><Typography variant="caption" display="block">{slot.course.title}</Typography><Typography variant="caption" color="text.secondary">{slot.department.name}</Typography>{isAdmin && <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={() => void remove(slot.id)}>Remove</Button>}</> : <Typography variant="body2" color="text.disabled">—</Typography>}</TableCell>; })}</TableRow>)}</TableBody></Table></TableContainer>}
    <Dialog open={open} onClose={() => setOpen(false)} fullWidth><DialogTitle>Assign a course</DialogTitle><DialogContent><TextField select fullWidth margin="normal" label="Department" value={form.departmentId} onChange={(event) => setForm({ ...form, departmentId: event.target.value, courseId: '' })}>{departments.map((department) => <MenuItem value={department.id} key={department.id}>{department.name}</MenuItem>)}</TextField><TextField select fullWidth margin="normal" label="Course" value={form.courseId} disabled={!form.departmentId} onChange={(event) => setForm({ ...form, courseId: event.target.value })}>{courses.map((course) => <MenuItem value={course.id} key={course.id}>{course.code} — {course.title}</MenuItem>)}</TextField><TextField select fullWidth margin="normal" label="Day" value={form.dayOfWeek} onChange={(event) => setForm({ ...form, dayOfWeek: Number(event.target.value) })}>{DAYS.map((day, index) => <MenuItem value={index + 1} key={day}>{day}</MenuItem>)}</TextField><TextField select fullWidth margin="normal" label="Time" value={form.startHour} onChange={(event) => setForm({ ...form, startHour: Number(event.target.value) })}>{HOURS.map((hour) => <MenuItem value={hour} key={hour}>{String(hour).padStart(2, '0')}:00 – {String(hour + 2).padStart(2, '0')}:00</MenuItem>)}</TextField></DialogContent><DialogActions><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="contained" disabled={!form.courseId} onClick={() => void save()}>Assign</Button></DialogActions></Dialog>
  </Box>;
};

export default Timetable;
