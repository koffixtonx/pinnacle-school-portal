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

interface Student {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  active: boolean;
  createdAt: string;
}

const Students: React.FC = () => {
  const [students, setStudents] = React.useState<Student[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [form, setForm] = React.useState({ firstName: '', lastName: '', email: '' });
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
  }, []);

  const handleSave = async () => {
    try {
      if (!form.firstName || !form.lastName || !form.email || !isValidEmail(form.email)) {
        setError('Please provide valid first name, last name and email');
        return;
      }
      setLoading(true);
      if (editingStudent) {
        await adminService.updateStudent(editingStudent.id, { firstName: form.firstName, lastName: form.lastName, email: form.email });
        // update in place
        setStudents((prev) => prev.map((s) => (s.id === editingStudent.id ? { ...s, firstName: form.firstName, lastName: form.lastName, email: form.email } : s)));
      } else {
        await adminService.createStudent(form.firstName, form.lastName, form.email);
        setCursor(null);
        setStudents([]);
        await fetchStudents();
      }
      setDialogOpen(false);
      setEditingStudent(null);
      setForm({ firstName: '', lastName: '', email: '' });
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
    setForm({ firstName: s.firstName, lastName: s.lastName, email: s.email });
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
          <Button variant="contained" onClick={() => setDialogOpen(true)}>New Student</Button>
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
                <TableCell sx={{ fontWeight: 600 }}>Joined</TableCell>
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
                      label={student.active ? 'Active' : 'Inactive'}
                      size="small"
                      color={student.active ? 'success' : 'default'}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>{new Date(student.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Button size="small" onClick={() => handleEdit(student)}>Edit</Button>
                    <Button size="small" color="error" onClick={() => handleDelete(student.id)}>Delete</Button>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={4}>
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
