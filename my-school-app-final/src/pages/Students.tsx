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
  Stack,
  Switch,
  FormControlLabel,
} from '@mui/material';
import { adminService, guardianService } from '../services/api.service';
import type { GuardianLink } from '../services/api.service';
import { isAdminRole, useCurrentUser } from '../hooks/useCurrentUser';

interface Student {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  active: boolean;
  matricNumber?: string | null;
  studentStatus?: 'ACTIVE' | 'INACTIVE' | 'ON_PROBATION';
  admittedYear?: number | null;
  studentLevel?: string;
  department?: { id: string; name: string; code: string } | null;
  createdAt: string;
}

const groupByStudent = (links: GuardianLink[]) => {
  const grouped: Record<string, GuardianLink[]> = {};
  links.forEach((link) => {
    (grouped[link.studentId] ??= []).push(link);
  });
  return grouped;
};

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
  const [matricStudent, setMatricStudent] = React.useState<Student | null>(null);
  const [matricValue, setMatricValue] = React.useState('');
  const [savingMatric, setSavingMatric] = React.useState(false);
  const [success, setSuccess] = React.useState('');
  const [guardians, setGuardians] = React.useState<Record<string, GuardianLink[]>>({});
  const [linkStudent, setLinkStudent] = React.useState<Student | null>(null);
  const [linkForm, setLinkForm] = React.useState({ email: '', relationship: 'Guardian', firstName: '', lastName: '', createAccount: false });
  const [savingLink, setSavingLink] = React.useState(false);
  const isValidEmail = (value: string) => /\S+@\S+\.\S+/.test(value);

  const showSuccess = (message: string) => {
    setSuccess(message);
    setTimeout(() => setSuccess(''), 4000);
  };

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
  }, [canManageStudents]);

  // One call for the whole page of students. A teacher sees the roster but the
  // database hands them no family links, so the column is for administrators.
  const refreshGuardians = React.useCallback(async () => {
    if (!canCreateStudents) return;
    if (!students.length) {
      setGuardians({});
      return;
    }
    try {
      const response = await guardianService.forStudents(students.map((student) => student.id));
      setGuardians(groupByStudent(response.data.data));
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Guardian links could not be loaded.');
    }
  }, [canCreateStudents, students]);

  React.useEffect(() => {
    void refreshGuardians();
  }, [refreshGuardians]);

  const handleLinkGuardian = async () => {
    if (!linkStudent) return;
    if (!isValidEmail(linkForm.email)) {
      setError('Enter the parent’s email address, for example ada@example.com.');
      return;
    }
    if (linkForm.createAccount && (!linkForm.firstName.trim() || !linkForm.lastName.trim())) {
      setError('A new parent account needs a first and last name.');
      return;
    }
    setSavingLink(true);
    setError('');
    try {
      if (linkForm.createAccount) {
        await guardianService.createParent(linkForm.firstName, linkForm.lastName, linkForm.email);
      }
      await guardianService.link(linkStudent.id, linkForm.email, linkForm.relationship);
      await refreshGuardians();
      setLinkStudent(null);
      setLinkForm({ email: '', relationship: 'Guardian', firstName: '', lastName: '', createAccount: false });
      showSuccess(`${linkForm.email.trim()} is now linked to ${linkStudent.firstName} ${linkStudent.lastName}.`);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'The parent could not be linked to this student.');
    } finally {
      setSavingLink(false);
    }
  };

  const handleUnlink = async (student: Student, link: GuardianLink) => {
    if (!window.confirm(`Unlink ${link.guardian?.firstName ?? 'this parent'} from ${student.firstName} ${student.lastName}?`)) return;
    setError('');
    try {
      await guardianService.unlink(link.id);
      setGuardians((prev) => ({ ...prev, [student.id]: (prev[student.id] ?? []).filter((item) => item.id !== link.id) }));
      showSuccess('The link has been removed.');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'The link could not be removed.');
    }
  };

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

  const openMatricDialog = (student: Student) => {
    setMatricStudent(student);
    setMatricValue(student.matricNumber ?? '');
  };

  const handleSaveMatric = async () => {
    if (!matricStudent) return;
    setSavingMatric(true);
    setError('');
    try {
      await adminService.setStudentMatricNumber(matricStudent.id, matricValue);
      // The database upper-cases what it stores, so the list has to agree with it.
      const issued = matricValue.trim() ? matricValue.trim().toUpperCase() : null;
      setStudents((prev) => prev.map((s) => (s.id === matricStudent.id ? { ...s, matricNumber: issued } : s)));
      setMatricStudent(null);
      showSuccess(issued ? `${issued} has been issued to ${matricStudent.firstName} ${matricStudent.lastName}.` : 'The matric number has been withdrawn.');
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'The matric number could not be saved.');
    } finally {
      setSavingMatric(false);
    }
  };

  const filtered = students.filter((student) => {
    const term = search.toLowerCase();
    return (
      !term ||
      student.firstName.toLowerCase().includes(term) ||
      student.lastName.toLowerCase().includes(term) ||
      student.email.toLowerCase().includes(term) ||
      (student.matricNumber ?? '').toLowerCase().includes(term)
    );
  });

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
          Students
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Student roster for your school. New students are added via bulk import on the admin dashboard.
        </Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      <Box sx={{ mb: 2 }}>
        <TextField
          placeholder="Search by name, email or matric number..."
          variant="outlined"
          size="small"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ width: { xs: '100%', sm: 320 }, minWidth: 0 }}
        />
        <Box component="span" sx={{ ml: 2 }}>
          {canCreateStudents && <Button variant="contained" onClick={() => setDialogOpen(true)}>New Student</Button>}
        </Box>
      </Box>

      <Card>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                <TableCell sx={{ fontWeight: 600, display: { xs: 'none', sm: 'table-cell' } }}>Email</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Matric no.</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600, display: { xs: 'none', sm: 'table-cell' } }}>Level</TableCell>
                <TableCell sx={{ fontWeight: 600, display: { xs: 'none', sm: 'table-cell' } }}>Admitted</TableCell>
                <TableCell sx={{ fontWeight: 600, display: { xs: 'none', sm: 'table-cell' } }}>Joined</TableCell>
                {canCreateStudents && <TableCell sx={{ fontWeight: 600 }}>Guardians</TableCell>}
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
                  <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>{student.email}</TableCell>
                  <TableCell>
                    {canCreateStudents ? (
                      <Button
                        size="small"
                        onClick={() => openMatricDialog(student)}
                        sx={{ fontWeight: 600, letterSpacing: 0.4, textTransform: 'none' }}
                      >
                        {student.matricNumber ?? 'Issue'}
                      </Button>
                    ) : (
                      (student.matricNumber ?? '—')
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={student.studentStatus === 'ON_PROBATION' ? 'On Probation' : student.studentStatus === 'INACTIVE' ? 'Inactive' : 'Active'}
                      size="small"
                      color={student.studentStatus === 'ON_PROBATION' ? 'warning' : student.studentStatus === 'ACTIVE' || (!student.studentStatus && student.active) ? 'success' : 'default'}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>{student.studentLevel ? `${student.studentLevel} Level` : '100 Level'}</TableCell>
                  <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>{student.admittedYear ?? '—'}</TableCell>
                  <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>{new Date(student.createdAt).toLocaleDateString()}</TableCell>
                  {canCreateStudents && (
                    <TableCell sx={{ minWidth: 190 }}>
                      <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
                        {(guardians[student.id] ?? []).map((link) => (
                          <Chip
                            key={link.id}
                            size="small"
                            variant="outlined"
                            label={`${link.relationship} · ${link.guardian?.firstName ?? ''} ${link.guardian?.lastName ?? ''}`.trim()}
                            onDelete={() => void handleUnlink(student, link)}
                          />
                        ))}
                        <Button size="small" onClick={() => setLinkStudent(student)}>
                          {(guardians[student.id] ?? []).length ? 'Link another' : 'Link parent'}
                        </Button>
                      </Stack>
                    </TableCell>
                  )}
                  <TableCell>
                    {canManageStudents && <Button size="small" onClick={() => handleEdit(student)}>Edit</Button>}
                    {canCreateStudents && <Button size="small" color="error" onClick={() => handleDelete(student.id)}>Delete</Button>}
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={canCreateStudents ? 9 : 8}>
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
          {editingStudent && <TextField label="Year admitted" type="number" fullWidth margin="normal" value={form.admittedYear} onChange={(e) => setForm({ ...form, admittedYear: e.target.value })}  slotProps={{ htmlInput: { min: 2000, max: 2100 } }} />}
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

      <Dialog open={!!matricStudent} onClose={() => setMatricStudent(null)} fullWidth maxWidth="xs">
        <DialogTitle>Matric number</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {matricStudent?.firstName} {matricStudent?.lastName} · {matricStudent?.email}
          </Typography>
          <TextField
            autoFocus
            fullWidth
            margin="normal"
            label="Matric number"
            value={matricValue}
            onChange={(e) => setMatricValue(e.target.value)}
            helperText="For example PIN/2026/0042. Letters, digits, slashes and dashes. Leave it empty to withdraw the number."
          />
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
            Students sign in with this number and their surname once it has been issued.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMatricStudent(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveMatric} disabled={savingMatric || matricValue.trim() === (matricStudent?.matricNumber ?? '')}>
            {savingMatric ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!linkStudent} onClose={() => setLinkStudent(null)} fullWidth maxWidth="xs">
        <DialogTitle>Link a parent</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {linkStudent?.firstName} {linkStudent?.lastName} · {linkStudent?.email}
          </Typography>
          <TextField
            autoFocus
            label="Parent's email"
            fullWidth
            margin="normal"
            value={linkForm.email}
            onChange={(e) => setLinkForm({ ...linkForm, email: e.target.value })}
            helperText="The address they sign in with."
          />
          <TextField
            label="Relationship"
            fullWidth
            margin="normal"
            value={linkForm.relationship}
            onChange={(e) => setLinkForm({ ...linkForm, relationship: e.target.value })}
            helperText="Mother, Father, Guardian…"
          />
          <FormControlLabel
            control={
              <Switch
                checked={linkForm.createAccount}
                onChange={(e) => setLinkForm({ ...linkForm, createAccount: e.target.checked })}
              />
            }
            label="No account yet — create one for this parent"
          />
          {linkForm.createAccount && (
            <>
              <TextField
                label="First name"
                fullWidth
                margin="normal"
                value={linkForm.firstName}
                onChange={(e) => setLinkForm({ ...linkForm, firstName: e.target.value })}
              />
              <TextField
                label="Last name"
                fullWidth
                margin="normal"
                value={linkForm.lastName}
                onChange={(e) => setLinkForm({ ...linkForm, lastName: e.target.value })}
              />
              <Typography variant="caption" color="text.secondary" component="div">
                The account is created with a temporary password, which the parent should change on first sign-in.
              </Typography>
            </>
          )}
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
            A linked parent reads the notices the school addresses to parents, and nothing else on the register.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLinkStudent(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleLinkGuardian} disabled={savingLink || !linkForm.email.trim()}>
            {savingLink ? 'Linking…' : 'Link'}
          </Button>
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
