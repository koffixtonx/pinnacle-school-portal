import React from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Grid,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import { adminService } from '../services/api.service';

interface Faculty {
  id: string;
  name: string;
  _count?: { departments: number };
}

interface Department {
  id: string;
  name: string;
  code: string;
  faculty: { id: string; name: string };
  _count?: { students: number; courses: number };
}

const Departments: React.FC = () => {
  const [faculties, setFaculties] = React.useState<Faculty[]>([]);
  const [departments, setDepartments] = React.useState<Department[]>([]);
  const [facultyName, setFacultyName] = React.useState('');
  const [departmentName, setDepartmentName] = React.useState('');
  const [departmentCode, setDepartmentCode] = React.useState('');
  const [facultyId, setFacultyId] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState('');

  const loadData = async () => {
    try {
      setLoading(true);
      const [facultyResponse, departmentResponse] = await Promise.all([adminService.listFaculties(), adminService.listDepartments()]);
      setFaculties(facultyResponse.data.data ?? []);
      setDepartments(departmentResponse.data.data ?? []);
    } catch (requestError: any) {
      setError(requestError.response?.data?.message || 'Unable to load academic organization.');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    void loadData();
  }, []);

  const createFaculty = async () => {
    if (!facultyName.trim()) return;
    try {
      setSaving(true);
      setError('');
      await adminService.createFaculty(facultyName.trim());
      setFacultyName('');
      setSuccess('Faculty created.');
      await loadData();
    } catch (requestError: any) {
      setError(requestError.response?.data?.message || 'Unable to create faculty.');
    } finally {
      setSaving(false);
    }
  };

  const createDepartment = async () => {
    if (!departmentName.trim() || !departmentCode.trim() || !facultyId) return;
    try {
      setSaving(true);
      setError('');
      await adminService.createDepartment(departmentName.trim(), departmentCode.trim(), facultyId);
      setDepartmentName('');
      setDepartmentCode('');
      setFacultyId('');
      setSuccess('Department created.');
      await loadData();
    } catch (requestError: any) {
      setError(requestError.response?.data?.message || 'Unable to create department.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>Faculties & Departments</Typography>
          <Typography variant="body2" color="text.secondary">Organize the university by faculty, department, and academic ownership.</Typography>
        </Box>
        <AccountTreeIcon color="primary" sx={{ fontSize: 42 }} />
      </Stack>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 5 }}>
          <Card sx={{ height: '100%' }}><CardContent>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>Add faculty</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField fullWidth size="small" label="Faculty name" value={facultyName} onChange={(event) => setFacultyName(event.target.value)} />
              <Button variant="contained" onClick={() => void createFaculty()} disabled={saving || !facultyName.trim()}>Add</Button>
            </Stack>
          </CardContent></Card>
        </Grid>
        <Grid size={{ xs: 12, md: 7 }}>
          <Card sx={{ height: '100%' }}><CardContent>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>Add department</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField fullWidth size="small" label="Department name" value={departmentName} onChange={(event) => setDepartmentName(event.target.value)} />
              <TextField size="small" label="Code" value={departmentCode} onChange={(event) => setDepartmentCode(event.target.value)} sx={{ minWidth: 120 }} />
              <TextField select fullWidth size="small" label="Faculty" value={facultyId} onChange={(event) => setFacultyId(event.target.value)}>
                {faculties.map((faculty) => <MenuItem key={faculty.id} value={faculty.id}>{faculty.name}</MenuItem>)}
              </TextField>
              <Button variant="contained" onClick={() => void createDepartment()} disabled={saving || !departmentName.trim() || !departmentCode.trim() || !facultyId}>Add</Button>
            </Stack>
          </CardContent></Card>
        </Grid>
      </Grid>
      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>Department directory</Typography>
          {loading ? <CircularProgress /> : <TableContainer><Table>
            <TableHead><TableRow><TableCell>Department</TableCell><TableCell>Code</TableCell><TableCell>Faculty</TableCell><TableCell>Students</TableCell><TableCell>Courses</TableCell></TableRow></TableHead>
            <TableBody>
              {departments.map((department) => <TableRow key={department.id}><TableCell sx={{ fontWeight: 600 }}>{department.name}</TableCell><TableCell>{department.code}</TableCell><TableCell>{department.faculty.name}</TableCell><TableCell>{department._count?.students ?? 0}</TableCell><TableCell>{department._count?.courses ?? 0}</TableCell></TableRow>)}
              {departments.length === 0 && <TableRow><TableCell colSpan={5}><Typography color="text.secondary">No departments created yet.</Typography></TableCell></TableRow>}
            </TableBody>
          </Table></TableContainer>}
        </CardContent>
      </Card>
    </Box>
  );
};

export default Departments;
