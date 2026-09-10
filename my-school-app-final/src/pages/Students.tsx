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
  Chip,
  Button,
  TextField,
  Typography,
  Avatar,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import { adminService } from '../services/api.service';
import { isAdminRole, useCurrentUser } from '../hooks/useCurrentUser';

interface Student {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  active: boolean;
  studentStatus?: 'ACTIVE' | 'INACTIVE' | 'ON_PROBATION';
  admittedYear?: number | null;
  studentLevel?: string;
  department?: { id: string; name: string; code: string } | null;
  createdAt: string;
}

const Students: React.FC = () => {
  const currentUser = useCurrentUser();
  const canManageStudents = isAdminRole(currentUser?.role) || currentUser?.role === 'TEACHER';
  const canCreateStudents = isAdminRole(currentUser?.role);
  const [students, setStudents] = React.useState<Student[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [departments, setDepartments] = React.useState<Array<{ id: string; name: string; code: string }>>([]);
  const [form, setForm] = React.useState<{ firstName: string; lastName: string; email: string; studentStatus: NonNullable<Student['studentStatus']>; admittedYear: string; studentLevel: string; departmentId: string }>({ firstName: '', lastName: '', email: '', studentStatus: 'ACTIVE', admittedYear: '', studentLevel: '100', departmentId: '' });
  const [editingStudent, setEditingStudent] = React.useState<Student | null>(null);
  const isValidEmail = (value: string) => /\S+@\S+\.\S+/.test(value);

  const fetchStudents = async (nextCursor?: string | null) => {
    try {
      setLoading(true);
      setError('');
      const response = await adminService.listStudents({ limit: 25, cursor: nextCursor ?? undefined });
      setStudents((prev) => (nextCursor ? [...prev, ...response.data.data] : response.data.data));
      setCursor(response.data.paging.nextCursor);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load students');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchStudents();
    if (canManageStudents) adminService.listDepartments().then((response) => setDepartments(response.data.data ?? [])).catch(() => undefined);
  }, []);

  const handleSave = async () => {
    try {
      if (!form.firstName || !form.lastName || !form.email || !isValidEmail(form.email)) {
        setError('Please provide valid first name, last name and email');
        return;
      }
      setLoading(true);
      if (editingStudent) {
        await adminService.updateStudent(editingStudent.id, { firstName: form.firstName, lastName: form.lastName, email: form.email, studentStatus: form.studentStatus, admittedYear: form.admittedYear ? Number(form.admittedYear) : null, studentLevel: form.studentLevel, departmentId: form.departmentId || null });
        // update in place
        setStudents((prev) => prev.map((s) => (s.id === editingStudent.id ? { ...s, firstName: form.firstName, lastName: form.lastName, email: form.email, studentStatus: form.studentStatus, admittedYear: form.admittedYear ? Number(form.admittedYear) : null, studentLevel: form.studentLevel, department: departments.find((department) => department.id === form.departmentId) ?? null } : s)));
      } else {
        await adminService.createStudent(form.firstName, form.lastName, form.email);
        setCursor(null);
        setStudents([]);
        await fetchStudents();
      }
      setDialogOpen(false);
      setEditingStudent(null);
      setForm({ firstName: '', lastName: '', email: '', studentStatus: 'ACTIVE', admittedYear: '', studentLevel: '100', departmentId: '' });
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to save student');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this student?')) return;
    try {
      await adminService.deleteStudent(id);
      setStudents((prev) => prev.filter((s) => s.id !== id));
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to delete student');
    }
  };

  const handleEdit = (s: Student) => {
    setEditingStudent(s);
    setForm({ firstName: s.firstName, lastName: s.lastName, email: s.email, studentStatus: s.studentStatus ?? (s.active ? 'ACTIVE' : 'INACTIVE'), admittedYear: s.admittedYear?.toString() ?? '', studentLevel: s.studentLevel ?? '100', departmentId: s.department?.id ?? '' });
    setDialogOpen(true);
  };

  const filtered = students.filter((student) => {
    const term = search.toLowerCase();
    return (
      !term ||
      student.firstName.toLowerCase().includes(term) ||
      student.lastName.toLowerCase().includes(term) ||
      student.email.toLowerCase().includes(term)
    );
  });

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
          Students
        </Typography>
        <Typography variant="body2" color="textSecondary">
          Student roster for your school. New students are added via bulk import on the admin dashboard.
        </Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Box sx={{ mb: 2 }}>
        <TextField
          placeholder="Search by name or email..."
          variant="outlined"
          size="small"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ minWidth: 300 }}
        />
        <Box component="span" sx={{ ml: 2 }}>
          {canCreateStudents && <Button variant="contained" onClick={() => setDialogOpen(true)}>New Student</Button>}
        </Box>
      </Box>

      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Email</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Level</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Admitted</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Joined</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((student) => (
                <TableRow key={student.id} sx={{ '&:hover': { backgroundColor: 'action.hover' } }}>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main' }}>
                        {student.firstName.charAt(0)}
                      </Avatar>
                      {student.firstName} {student.lastName}
                    </Box>
                  </TableCell>
                  <TableCell>{student.email}</TableCell>
                  <TableCell>
                    <Chip
                      label={student.studentStatus === 'ON_PROBATION' ? 'On Probation' : student.studentStatus === 'INACTIVE' ? 'Inactive' : 'Active'}
                      size="small"
                      color={student.studentStatus === 'ON_PROBATION' ? 'warning' : student.studentStatus === 'ACTIVE' || (!student.studentStatus && student.active) ? 'success' : 'default'}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>{student.studentLevel ? `${student.studentLevel} Level` : '100 Level'}</TableCell>
                  <TableCell>{student.admittedYear ?? '—'}</TableCell>
                  <TableCell>{new Date(student.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell>
                    {canManageStudents && <Button size="small" onClick={() => handleEdit(student)}>Edit</Button>}
                    {canCreateStudents && <Button size="small" color="error" onClick={() => handleDelete(student.id)}>Delete</Button>}
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={7}>
                    <Typography variant="body2" color="text.secondary">
                      No students found.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth>
        <DialogTitle>New Student</DialogTitle>
        <DialogContent>
          <TextField label="First name" fullWidth margin="normal" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          <TextField label="Last name" fullWidth margin="normal" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          <TextField label="Email" fullWidth margin="normal" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          {editingStudent && <TextField select label="Status" fullWidth margin="normal" value={form.studentStatus} onChange={(e) => setForm({ ...form, studentStatus: e.target.value as NonNullable<Student['studentStatus']> })}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="ON_PROBATION">On Probation</option>
          </TextField>}
          {editingStudent && <TextField select label="Level" fullWidth margin="normal" value={form.studentLevel} onChange={(e) => setForm({ ...form, studentLevel: e.target.value })}>
            {['100', '200', '300', '400', '500'].map((level) => <option key={level} value={level}>{level} Level</option>)}
          </TextField>}
          {editingStudent && <TextField label="Year admitted" type="number" fullWidth margin="normal" value={form.admittedYear} onChange={(e) => setForm({ ...form, admittedYear: e.target.value })} inputProps={{ min: 2000, max: 2100 }} />}
          {editingStudent && <TextField select label="Department" fullWidth margin="normal" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
            <option value="">Unassigned</option>
            {departments.map((department) => <option key={department.id} value={department.id}>{department.code} - {department.name}</option>)}
          </TextField>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={!form.firstName || !form.lastName || !form.email}>Save</Button>
        </DialogActions>
      </Dialog>

      {loading && <CircularProgress sx={{ mt: 2 }} />}
      {cursor && !loading && (
        <Button sx={{ mt: 2 }} variant="outlined" onClick={() => fetchStudents(cursor)}>
          Load more
        </Button>
      )}
    </Box>
  );
};

export default Students;
