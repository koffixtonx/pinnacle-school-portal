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
import { useNavigate } from 'react-router-dom';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import GroupsIcon from '@mui/icons-material/Groups';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import GradeIcon from '@mui/icons-material/Grade';
import { academicsService } from '../services/api.service';
import { useCurrentUser } from '../hooks/useCurrentUser';

interface Course {
  id: string;
  title: string;
  code: string;
  description?: string;
  teachers: { id: string; firstName: string; lastName: string }[];
  _count?: { enrollments: number };
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

interface PendingEnrollment {
  id: string;
  course: { title: string; code: string; level: string };
  student: { firstName: string; lastName: string; email: string };
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const formatTime = (value: string) =>
  new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

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

const TeacherDashboard: React.FC = () => {
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const [courses, setCourses] = useState<Course[]>([]);
  const [timetable, setTimetable] = useState<TimetableSlot[]>([]);
  const [pendingEnrollments, setPendingEnrollments] = useState<PendingEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [coursesRes, timetableRes, pendingRes] = await Promise.all([
          academicsService.listCourses(),
          academicsService.listTimetable(),
          academicsService.listPendingEnrollments(),
        ]);
        if (!mounted) return;
        setCourses(coursesRes.data.data ?? []);
        setTimetable(timetableRes.data.data ?? []);
        setPendingEnrollments(pendingRes.data.data ?? []);
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

  const reviewEnrollment = async (id: string, status: 'ACTIVE' | 'REJECTED') => {
    try {
      await academicsService.reviewEnrollment(id, status);
      setPendingEnrollments((current) => current.filter((enrollment) => enrollment.id !== id));
    } catch {
      setError('Could not update the course request. Please try again.');
    }
  };

  const totalStudents = useMemo(
    () => courses.reduce((sum, course) => sum + (course._count?.enrollments ?? 0), 0),
    [courses]
  );

  const today = new Date().getDay();
  const todaysClasses = useMemo(
    () => timetable.filter((slot) => slot.dayOfWeek === today),
    [timetable, today]
  );

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
        Welcome, {currentUser?.firstName ?? 'Teacher'}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Here is what's happening with your courses today.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
          gap: 3,
          mb: 4,
        }}
      >
        <MetricCard title="My Courses" value={courses.length} icon={MenuBookIcon} accent="#1976d2" />
        <MetricCard title="Total Students" value={totalStudents} icon={GroupsIcon} accent="#2e7d32" />
        <MetricCard title="Classes Today" value={todaysClasses.length} icon={EventAvailableIcon} accent="#ed6c02" />
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.2fr 1fr' }, gap: 3 }}>
        <Card sx={{ border: '1px solid rgba(15, 23, 42, 0.08)' }}>
          <CardContent>
            <Typography variant="h6" fontWeight={700} gutterBottom>
              My Courses
            </Typography>
            {courses.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                You are not assigned to any courses yet.
              </Typography>
            ) : (
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Course</TableCell>
                      <TableCell>Code</TableCell>
                      <TableCell align="right">Students</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {courses.map((course) => (
                      <TableRow key={course.id} hover>
                        <TableCell>{course.title}</TableCell>
                        <TableCell>
                          <Chip label={course.code} size="small" />
                        </TableCell>
                        <TableCell align="right">{course._count?.enrollments ?? 0}</TableCell>
                        <TableCell align="right">
                          <Stack direction="row" spacing={1} justifyContent="flex-end">
                            <Chip
                              label="Grades"
                              size="small"
                              icon={<GradeIcon />}
                              onClick={() => navigate('/grades')}
                              clickable
                            />
                            <Chip
                              label="Attendance"
                              size="small"
                              icon={<EventAvailableIcon />}
                              onClick={() => navigate('/attendance')}
                              clickable
                            />
                          </Stack>
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
                    sx={{
                      p: 1.5,
                      borderRadius: 1.5,
                      border: '1px solid rgba(15, 23, 42, 0.08)',
                    }}
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
      <Card sx={{ border: '1px solid rgba(15, 23, 42, 0.08)', mt: 3 }}>
        <CardContent>
          <Typography variant="h6" fontWeight={700} gutterBottom>Course requests</Typography>
          {pendingEnrollments.length === 0 ? <Typography variant="body2" color="text.secondary">No pending course requests.</Typography> : <Stack spacing={1}>
            {pendingEnrollments.map((enrollment) => <Stack key={enrollment.id} direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} spacing={1} sx={{ py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Box><Typography variant="subtitle2" fontWeight={700}>{enrollment.student.firstName} {enrollment.student.lastName}</Typography><Typography variant="body2" color="text.secondary">{enrollment.course.code} - {enrollment.course.title}</Typography></Box>
              <Stack direction="row" spacing={1}><Button size="small" variant="contained" color="success" onClick={() => void reviewEnrollment(enrollment.id, 'ACTIVE')}>Approve</Button><Button size="small" variant="outlined" color="error" onClick={() => void reviewEnrollment(enrollment.id, 'REJECTED')}>Reject</Button></Stack>
            </Stack>)}
          </Stack>}
        </CardContent>
      </Card>
    </Container>
  );
};

export default TeacherDashboard;
