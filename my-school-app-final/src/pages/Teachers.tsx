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
  TextField,
  Typography,
  Avatar,
  Alert,
  CircularProgress,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import { adminService } from '../services/api.service';

interface Teacher {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  active: boolean;
}

const Teachers: React.FC = () => {
  const [teachers, setTeachers] = React.useState<Teacher[]>([]);
  const [search, setSearch] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [form, setForm] = React.useState({ firstName: '', lastName: '', email: '' });
  const [editing, setEditing] = React.useState<Teacher | null>(null);

  const isValidEmail = (value: string) => /\S+@\S+\.\S+/.test(value);

  React.useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const response = await adminService.listTeachers();
        setTeachers(response.data.data);
      } catch (err: any) {
        setError(err.response?.data?.message || 'Failed to load teachers');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    try {
      if (!form.firstName || !form.lastName || !form.email || !isValidEmail(form.email)) {
        setError('Please provide valid first name, last name and email');
        return;
      }
      setLoading(true);
      if (editing) {
        await adminService.updateTeacher(editing.id, { firstName: form.firstName, lastName: form.lastName, email: form.email });
      } else {
        await adminService.createTeacher(form.firstName, form.lastName, form.email);
      }
      setDialogOpen(false);
      setEditing(null);
      setForm({ firstName: '', lastName: '', email: '' });
      const response = await adminService.listTeachers();
      setTeachers(response.data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to save teacher');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this teacher?')) return;
    try {
      await adminService.deleteTeacher(id);
      setTeachers((prev) => prev.filter((t) => t.id !== id));
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to delete teacher');
    }
  };

  const handleEdit = (t: Teacher) => {
    setEditing(t);
    setForm({ firstName: t.firstName, lastName: t.lastName, email: t.email });
    setDialogOpen(true);
  };

  const filtered = teachers.filter((teacher) => {
    const term = search.toLowerCase();
    return (
      !term ||
      teacher.firstName.toLowerCase().includes(term) ||
      teacher.lastName.toLowerCase().includes(term) ||
      teacher.email.toLowerCase().includes(term)
    );
  });

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
          Teachers
        </Typography>
        <Typography variant="body2" color="textSecondary">
          Teaching staff at your school.
        </Typography>
        <Box sx={{ mt: 2 }}>
          <Button variant="contained" onClick={() => setDialogOpen(true)}>New Teacher</Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {loading && <CircularProgress sx={{ mb: 2 }} />}

      <Box sx={{ mb: 2 }}>
        <TextField
          placeholder="Search by name or email..."
          variant="outlined"
          size="small"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ minWidth: 300 }}
        />
      </Box>

      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Email</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((teacher) => (
                <TableRow key={teacher.id} sx={{ '&:hover': { backgroundColor: 'action.hover' } }}>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Avatar sx={{ width: 32, height: 32, bgcolor: 'secondary.main' }}>
                        {teacher.firstName.charAt(0)}
                      </Avatar>
                      {teacher.firstName} {teacher.lastName}
                    </Box>
                  </TableCell>
                  <TableCell>{teacher.email}</TableCell>
                  <TableCell>
                    <Chip
                      label={teacher.active ? 'Active' : 'Inactive'}
                      size="small"
                      color={teacher.active ? 'success' : 'default'}
                      variant="outlined"
                    />                    <Button size="small" onClick={() => handleEdit(teacher)} sx={{ ml: 1 }}>Edit</Button>                    <Button size="small" color="error" onClick={() => handleDelete(teacher.id)} sx={{ ml: 1 }}>Delete</Button>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={3}>
                    <Typography variant="body2" color="text.secondary">
                      No teachers found.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth>
        <DialogTitle>New Teacher</DialogTitle>
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
    </Box>
  );
};

export default Teachers;
