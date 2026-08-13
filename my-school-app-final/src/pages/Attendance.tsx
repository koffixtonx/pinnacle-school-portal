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
  TextField,
  MenuItem,
  Button,
  Typography,
  Alert,
  CircularProgress,
  Chip,
} from '@mui/material';
import { academicsService, attendanceService } from '../services/api.service';
import { isAdminRole, useCurrentUser } from '../hooks/useCurrentUser';

const STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'];
const STATUS_COLOR: Record<string, 'success' | 'error' | 'warning' | 'info' | 'default'> = {
  PRESENT: 'success',
  ABSENT: 'error',
  LATE: 'warning',
  EXCUSED: 'info',
};

interface ClassSection {
  id: string;
  name: string;
}
interface RosterStudent {
  id: string;
  firstName: string;
  lastName: string;
}
interface AttendanceRecord {
  id: string;
  status: string;
  recordedAt: string;
  student: { id: string; firstName: string; lastName: string };
  classSection: { id: string; name: string };
}

const today = () => new Date().toISOString().slice(0, 10);

const Attendance: React.FC = () => {
  const user = useCurrentUser();
  const isAdmin = isAdminRole(user?.role);
  const canMark = isAdmin || user?.role === 'TEACHER';

  const [sections, setSections] = React.useState<ClassSection[]>([]);
  const [selectedSection, setSelectedSection] = React.useState('');
  const [date, setDate] = React.useState(today());
  const [roster, setRoster] = React.useState<RosterStudent[]>([]);
  const [statuses, setStatuses] = React.useState<Record<string, string>>({});
  const [records, setRecords] = React.useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState('');

  const showSuccess = (message: string) => {
    setSuccess(message);
    setTimeout(() => setSuccess(''), 3000);
  };

  const fetchRecords = async (classSectionId?: string, dateFilter?: string) => {
    try {
      setLoading(true);
      setError('');
      const response = await attendanceService.list({
        classSectionId: classSectionId || undefined,
        date: dateFilter || undefined,
      });
      setRecords(response.data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load attendance');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    if (canMark) {
      academicsService
        .listClassSections()
        .then((res) => setSections(res.data.data))
        .catch(() => {});
    }
    fetchRecords(selectedSection, date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!selectedSection) {
      setRoster([]);
      return;
    }
    academicsService
      .listClassSectionStudents(selectedSection)
      .then((res) => {
        setRoster(res.data.data);
        const defaults: Record<string, string> = {};
        res.data.data.forEach((student: RosterStudent) => {
          defaults[student.id] = 'PRESENT';
        });
        setStatuses(defaults);
      })
      .catch((err) => setError(err.response?.data?.message || 'Failed to load class roster'));
  }, [selectedSection]);

  React.useEffect(() => {
    if (!selectedSection) {
      return;
    }
    fetchRecords(selectedSection, date);
  }, [selectedSection, date]);

  const handleSubmit = async () => {
    if (!selectedSection || roster.length === 0) return;
    try {
      setLoading(true);
      setError('');
      await attendanceService.mark(
        selectedSection,
        date,
        roster.map((student) => ({ studentId: student.id, status: statuses[student.id] || 'PRESENT' }))
      );
      showSuccess('Attendance recorded');
      fetchRecords();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to record attendance');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
          Attendance
        </Typography>
        <Typography variant="body2" color="textSecondary">
          {canMark ? 'Mark daily attendance for your class.' : 'Your attendance history.'}
        </Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {canMark && (
        <Card sx={{ p: 2, mb: 3 }}>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
            <TextField
              select
              label="Class Section"
              value={selectedSection}
              onChange={(e) => setSelectedSection(e.target.value)}
              sx={{ minWidth: 220 }}
            >
              {sections.map((section) => (
                <MenuItem key={section.id} value={section.id}>
                  {section.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <Button variant="contained" onClick={handleSubmit} disabled={!selectedSection || roster.length === 0 || loading}>
              Save Attendance
            </Button>
          </Box>

          {roster.length > 0 && (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Student</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {roster.map((student) => (
                    <TableRow key={student.id}>
                      <TableCell>{student.firstName} {student.lastName}</TableCell>
                      <TableCell>
                        <TextField
                          select
                          size="small"
                          value={statuses[student.id] || 'PRESENT'}
                          onChange={(e) => setStatuses({ ...statuses, [student.id]: e.target.value })}
                          sx={{ minWidth: 140 }}
                        >
                          {STATUSES.map((status) => (
                            <MenuItem key={status} value={status}>
                              {status}
                            </MenuItem>
                          ))}
                        </TextField>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Card>
      )}

      {loading && <CircularProgress sx={{ mb: 2 }} />}

      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                {isAdmin || user?.role === 'TEACHER' ? <TableCell sx={{ fontWeight: 600 }}>Student</TableCell> : null}
                <TableCell sx={{ fontWeight: 600 }}>Class</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {records.map((record) => (
                <TableRow key={record.id}>
                  <TableCell>{new Date(record.recordedAt).toLocaleDateString()}</TableCell>
                  {isAdmin || user?.role === 'TEACHER' ? (
                    <TableCell>{record.student.firstName} {record.student.lastName}</TableCell>
                  ) : null}
                  <TableCell>{record.classSection.name}</TableCell>
                  <TableCell>
                    <Chip label={record.status} size="small" color={STATUS_COLOR[record.status] || 'default'} />
                  </TableCell>
                </TableRow>
              ))}
              {records.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Typography variant="body2" color="text.secondary">
                      No attendance records yet.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
    </Box>
  );
};

export default Attendance;
