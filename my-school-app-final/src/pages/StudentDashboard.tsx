import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Button,
} from '@mui/material';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import GradeIcon from '@mui/icons-material/Grade';
import {
  academicsService,
  attendanceService,
  gradesService,
  feesService,
} from '../services/api.service';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { formatCurrency } from '../utils/currency';

interface Course {
  id: string;
  title: string;
  code: string;
}

interface AvailableCourse extends Course {
  level?: string;
  enrollments: Array<{ id: string; status: string }>;
}

interface TimetableSlot {
  id: string;
  dayOfWeek: number;
  startsAt: string;
  endsAt: string;
  room: string;
  course: { id: string; title: string; code: string };
  classSection: { id: string; name: string };
}

interface AttendanceRecord {
  id: string;
  status: string;
  recordedAt: string;
}

interface GradeEntry {
  id: string;
  score: number;
  letterGrade: string;
  comments?: string;
  recordedAt: string;
  gradePeriod: { id: string; name: string; courseId: string };
}

interface Invoice {
  id: string;
  status: string;
  dueDate: string;
  totalAmount: string | number;
  paidAmount: string | number;
  reference: string;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const formatTime = (value: string) =>
  new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

interface MetricCardProps {
  title: string;
  value: string | number;
  icon: React.ElementType;
  accent: string;
}

const MetricCard: React.FC<MetricCardProps> = ({ title, value, icon: Icon, accent }) => (
  <Card sx={{ height: '100%', border: '1px solid rgba(15, 23, 42, 0.08)', boxShadow: '0 12px 30px rgba(15, 23, 42, 0.06)' }}>
    <CardContent>
      <Stack direction="row" alignItems="center" spacing={2}>
        <Box
          sx={{
            width: 48,
            height: 48,
            borderRadius: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: accent,
            color: '#fff',
          }}
        >
          <Icon />
        </Box>
        <Box>
          <Typography variant="h5" fontWeight={700}>
            {value}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {title}
          </Typography>
        </Box>
      </Stack>
    </CardContent>
  </Card>
);

const StudentDashboard: React.FC = () => {
  const currentUser = useCurrentUser();
  const [courses, setCourses] = useState<Course[]>([]);
  const [availableCourses, setAvailableCourses] = useState<AvailableCourse[]>([]);
  const [timetable, setTimetable] = useState<TimetableSlot[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [grades, setGrades] = useState<GradeEntry[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [coursesRes, availableCoursesRes, timetableRes, attendanceRes, gradesRes, invoicesRes] = await Promise.all([
          academicsService.listCourses(),
          academicsService.listAvailableCourses(),
          academicsService.listTimetable(),
          attendanceService.list(),
          gradesService.listEntries(),
          feesService.listInvoices(),
        ]);
        if (!mounted) return;
        setCourses(coursesRes.data.data ?? []);
        setAvailableCourses(availableCoursesRes.data.data ?? []);
        setTimetable(timetableRes.data.data ?? []);
        setAttendance(attendanceRes.data.data ?? []);
        setGrades(gradesRes.data.data ?? []);
        setInvoices(invoicesRes.data.data ?? []);
      } catch (err) {
        if (!mounted) return;
        setError('Could not load your dashboard data. Please try again.');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const requestCourse = async (courseId: string) => {
    try {
      await academicsService.requestCourseEnrollment(courseId);
      setAvailableCourses((current) => current.map((course) => course.id === courseId ? { ...course, enrollments: [{ id: 'local', status: 'PENDING' }] } : course));
    } catch {
      setError('Could not submit the course request. Please try again.');
    }
  };

  const courseTitleById = useMemo(() => {
    const map = new Map<string, Course>();
    courses.forEach((course) => map.set(course.id, course));
    return map;
  }, [courses]);

  const attendanceRate = useMemo(() => {
    if (attendance.length === 0) return null;
    const present = attendance.filter((record) => record.status === 'PRESENT').length;
    return Math.round((present / attendance.length) * 100);
  }, [attendance]);

  const outstandingBalance = useMemo(
    () =>
      invoices.reduce((sum, invoice) => sum + (Number(invoice.totalAmount) - Number(invoice.paidAmount)), 0),
    [invoices]
  );

  const today = new Date().getDay();
  const todaysClasses = useMemo(
    () => timetable.filter((slot) => slot.dayOfWeek === today),
    [timetable, today]
  );

  const recentGrades = useMemo(() => grades.slice(0, 6), [grades]);

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ py: 6, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        Welcome, {currentUser?.firstName ?? 'Student'}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Here is a snapshot of your courses, attendance, and grades.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' },
          gap: 3,
          mb: 4,
        }}
      >
        <MetricCard title="Enrolled Courses" value={courses.length} icon={MenuBookIcon} accent="#1976d2" />
        <MetricCard
          title="Attendance Rate"
          value={attendanceRate === null ? '—' : `${attendanceRate}%`}
          icon={EventAvailableIcon}
          accent="#2e7d32"
        />
        <MetricCard title="Recent Grades" value={grades.length} icon={GradeIcon} accent="#9c27b0" />
        <MetricCard
          title="Outstanding Fees"
          value={formatCurrency(outstandingBalance)}
          icon={ReceiptLongIcon}
          accent={outstandingBalance > 0 ? '#d32f2f' : '#2e7d32'}
        />
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.2fr 1fr' }, gap: 3, mb: 3 }}>
        <Card sx={{ border: '1px solid rgba(15, 23, 42, 0.08)' }}>
          <CardContent>
            <Typography variant="h6" fontWeight={700} gutterBottom>
              Recent Grades
            </Typography>
            {recentGrades.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No grades have been recorded yet.
              </Typography>
            ) : (
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Course</TableCell>
                      <TableCell>Period</TableCell>
                      <TableCell align="right">Score</TableCell>
                      <TableCell align="right">Grade</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {recentGrades.map((entry) => (
                      <TableRow key={entry.id} hover>
                        <TableCell>
                          {courseTitleById.get(entry.gradePeriod.courseId)?.title ?? 'Unknown course'}
                        </TableCell>
                        <TableCell>{entry.gradePeriod.name}</TableCell>
                        <TableCell align="right">{entry.score}</TableCell>
                        <TableCell align="right">
                          <Chip label={entry.letterGrade} size="small" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>

        <Card sx={{ border: '1px solid rgba(15, 23, 42, 0.08)' }}>
          <CardContent>
            <Typography variant="h6" fontWeight={700} gutterBottom>
              Today's Schedule — {DAY_NAMES[today]}
            </Typography>
            {todaysClasses.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No classes scheduled for today.
              </Typography>
            ) : (
              <Stack spacing={1.5}>
                {todaysClasses.map((slot) => (
                  <Box
                    key={slot.id}
                    sx={{ p: 1.5, borderRadius: 1.5, border: '1px solid rgba(15, 23, 42, 0.08)' }}
                  >
                    <Typography variant="subtitle2" fontWeight={700}>
                      {slot.course.title} ({slot.course.code})
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {formatTime(slot.startsAt)} – {formatTime(slot.endsAt)} · {slot.classSection.name}
                      {slot.room ? ` · Room ${slot.room}` : ''}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            )}
          </CardContent>
        </Card>
      </Box>

      <Card sx={{ border: '1px solid rgba(15, 23, 42, 0.08)', mb: 3 }}>
        <CardContent>
          <Typography variant="h6" fontWeight={700} gutterBottom>Course selection</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Request courses for teacher approval.</Typography>
          <Stack spacing={1}>
            {availableCourses.filter((course) => !course.enrollments[0] || course.enrollments[0].status === 'REJECTED').slice(0, 8).map((course) => (
              <Stack key={course.id} direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} spacing={1} sx={{ py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Box><Typography variant="subtitle2" fontWeight={700}>{course.title} ({course.code})</Typography><Typography variant="caption" color="text.secondary">{course.level ?? '100'} Level</Typography></Box>
                <Button size="small" variant="outlined" onClick={() => void requestCourse(course.id)}>Request</Button>
              </Stack>
            ))}
            {availableCourses.filter((course) => course.enrollments[0]?.status === 'PENDING').length > 0 && <Typography variant="body2" color="text.secondary">Some requests are awaiting teacher approval.</Typography>}
            {availableCourses.length === 0 && <Typography variant="body2" color="text.secondary">No courses are available.</Typography>}
          </Stack>
        </CardContent>
      </Card>

      <Card sx={{ border: '1px solid rgba(15, 23, 42, 0.08)' }}>
        <CardContent>
          <Typography variant="h6" fontWeight={700} gutterBottom>
            Fee Invoices
          </Typography>
          {invoices.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No invoices on file.
            </Typography>
          ) : (
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Reference</TableCell>
                    <TableCell>Due Date</TableCell>
                    <TableCell align="right">Total</TableCell>
                    <TableCell align="right">Paid</TableCell>
                    <TableCell align="right">Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {invoices.map((invoice) => (
                    <TableRow key={invoice.id} hover>
                      <TableCell>{invoice.reference}</TableCell>
                      <TableCell>{formatDate(invoice.dueDate)}</TableCell>
                      <TableCell align="right">{formatCurrency(invoice.totalAmount)}</TableCell>
                      <TableCell align="right">{formatCurrency(invoice.paidAmount)}</TableCell>
                      <TableCell align="right">
                        <Chip
                          label={invoice.status}
                          size="small"
                          color={invoice.status === 'PAID' ? 'success' : 'warning'}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>
    </Container>
  );
};

export default StudentDashboard;
