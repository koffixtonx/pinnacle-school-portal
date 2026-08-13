import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Divider,
  LinearProgress,
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
import {
  AdminPanelSettings,
  Download,
  PeopleAlt,
  ReceiptLong,
  Refresh,
  School,
  Search,
  Security,
  TrendingUp,
} from '@mui/icons-material';
import { adminService, siteSettingsService } from '../services/api.service';

interface Student {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  active: boolean;
  createdAt: string;
}

interface AuditLogEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  summary: string;
  createdAt: string;
  actorId: string | null;
}

interface EnrollmentAnalytics {
  enrollmentTrend: Array<{ createdAt: string; _count: { id: number } }>;
  totals: { totalStudents: number; totalTeachers: number };
}

interface FeeAnalytics {
  monthlyCollection: Array<{ paidAt: string; _sum: { amount: string | number | null } }>;
}

interface AttendanceAnalytics {
  attendanceTotals: Array<{ status: string; _count: { status: number } }>;
}

interface MetricCardProps {
  title: string;
  value: string | number;
  caption: string;
  icon: React.ElementType;
  accent: string;
}

const TABS = ['overview', 'students', 'audit'] as const;
type Tab = (typeof TABS)[number];

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

const formatCurrency = (value: number | string | null | undefined) =>
  `$${Number(value ?? 0).toFixed(2)}`;

const MetricCard: React.FC<MetricCardProps> = ({ title, value, caption, icon: Icon, accent }) => (
  <Card sx={{ height: '100%', border: '1px solid rgba(15, 23, 42, 0.08)', boxShadow: '0 12px 30px rgba(15, 23, 42, 0.06)' }}>
    <CardContent>
      <Stack direction="row" spacing={2} alignItems="center">
        <Avatar sx={{ bgcolor: accent, width: 48, height: 48 }}>
          <Icon />
        </Avatar>
        <Box>
          <Typography variant="body2" color="text.secondary">
            {title}
          </Typography>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            {value}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {caption}
          </Typography>
        </Box>
      </Stack>
    </CardContent>
  </Card>
);

const AdminDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [enrollment, setEnrollment] = useState<EnrollmentAnalytics | null>(null);
  const [fees, setFees] = useState<FeeAnalytics | null>(null);
  const [attendance, setAttendance] = useState<AttendanceAnalytics | null>(null);
  const [overviewLoaded, setOverviewLoaded] = useState(false);
  const [widgetConfig, setWidgetConfig] = useState<{ announcements?: boolean; calendar?: boolean; quickLinks?: boolean } | null>(null);

  const [students, setStudents] = useState<Student[]>([]);
  const [studentsCursor, setStudentsCursor] = useState<string | null>(null);
  const [studentsLoaded, setStudentsLoaded] = useState(false);
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [logsCursor, setLogsCursor] = useState<string | null>(null);
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [auditSearchTerm, setAuditSearchTerm] = useState('');

  const showSuccess = (message: string) => {
    setSuccess(message);
    setTimeout(() => setSuccess(''), 3000);
  };

  const fetchOverview = async () => {
    try {
      setLoading(true);
      setError('');
      const [enrollmentRes, feesRes, attendanceRes] = await Promise.all([
        adminService.getEnrollmentAnalytics(),
        adminService.getFeeCollectionAnalytics(),
        adminService.getAttendanceAnalytics(),
      ]);
      setEnrollment(enrollmentRes.data.data);
      setFees(feesRes.data.data);
      setAttendance(attendanceRes.data.data);
      setOverviewLoaded(true);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  };

  const fetchStudents = async (cursor?: string | null) => {
    try {
      setLoading(true);
      setError('');
      const response = await adminService.listStudents({ limit: 25, cursor: cursor ?? undefined });
      setStudents((prev) => (cursor ? [...prev, ...response.data.data] : response.data.data));
      setStudentsCursor(response.data.paging.nextCursor);
      setStudentsLoaded(true);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load students');
    } finally {
      setLoading(false);
    }
  };

  const fetchLogs = async (cursor?: string | null) => {
    try {
      setLoading(true);
      setError('');
      const response = await adminService.getAuditLogs({ limit: 25, cursor: cursor ?? undefined });
      setLogs((prev) => (cursor ? [...prev, ...response.data.data] : response.data.data));
      setLogsCursor(response.data.paging.nextCursor);
      setLogsLoaded(true);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'overview' && !overviewLoaded) {
      void fetchOverview();
    }
    if (activeTab === 'students' && !studentsLoaded) {
      void fetchStudents();
    }
    if (activeTab === 'audit' && !logsLoaded) {
      void fetchLogs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Load site settings to determine which widgets should be shown
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await siteSettingsService.get();
        if (!mounted) return;
        setWidgetConfig(res.data.data?.widgetConfig ?? { announcements: true, calendar: true, quickLinks: true });
      } catch {
        // default to showing widgets
        if (mounted) setWidgetConfig({ announcements: true, calendar: true, quickLinks: true });
      }
    })();
    return () => { mounted = false; };
  }, []);

  const overviewStats = useMemo(() => {
    const totalStudents = enrollment?.totals.totalStudents ?? 0;
    const totalTeachers = enrollment?.totals.totalTeachers ?? 0;
    const attendanceTotals = attendance?.attendanceTotals ?? [];
    const totalAttendanceRecords = attendanceTotals.reduce((sum, row) => sum + row._count.status, 0);
    const presentCount = attendanceTotals.find((row) => row.status.toLowerCase().includes('present'))?._count.status ?? 0;
    const attendanceRate = totalAttendanceRecords > 0 ? Math.round((presentCount / totalAttendanceRecords) * 100) : 0;
    const totalCollected = fees?.monthlyCollection.reduce((sum, row) => sum + Number(row._sum.amount ?? 0), 0) ?? 0;

    return {
      totalStudents,
      totalTeachers,
      attendanceRate,
      totalCollected,
      totalAttendanceRecords,
      enrollmentEvents: enrollment?.enrollmentTrend.length ?? 0,
    };
  }, [attendance, enrollment, fees]);

  const filteredStudents = useMemo(() => {
    const query = searchTerm.toLowerCase();
    if (!query) return students;
    return students.filter((student) =>
      `${student.firstName} ${student.lastName} ${student.email}`.toLowerCase().includes(query),
    );
  }, [searchTerm, students]);

  const filteredLogs = useMemo(() => {
    const query = auditSearchTerm.toLowerCase();
    if (!query) return logs;
    return logs.filter((log) =>
      `${log.action} ${log.entity} ${log.summary}`.toLowerCase().includes(query),
    );
  }, [auditSearchTerm, logs]);

  const handleBulkImport = async () => {
    const lines = importText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [email, firstName, lastName] = line.split(',').map((part) => part.trim());
        return { email, firstName: firstName || '', lastName: lastName || '' };
      })
      .filter((line) => line.email);

    if (lines.length === 0) {
      setError('Enter at least one line as: email,firstName,lastName');
      return;
    }

    try {
      setImporting(true);
      setError('');
      await adminService.bulkImportStudents('admin-dashboard-paste', lines);
      showSuccess(`Import started for ${lines.length} student${lines.length === 1 ? '' : 's'}.`);
      setImportText('');
      setStudentsCursor(null);
      setStudents([]);
      setStudentsLoaded(false);
      void fetchStudents();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to start import');
    } finally {
      setImporting(false);
    }
  };

  const refreshDashboard = async () => {
    if (activeTab === 'overview') {
      await fetchOverview();
    }
    if (activeTab === 'students') {
      await fetchStudents();
    }
    if (activeTab === 'audit') {
      await fetchLogs();
    }
  };

  return (
    <Container maxWidth="xl" sx={{ py: 4, minHeight: '100vh' }}>
      <Card
        sx={{
          mb: 4,
          background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)',
          color: 'white',
          borderRadius: 4,
          boxShadow: '0 20px 45px rgba(15, 23, 42, 0.22)',
        }}
      >
        <CardContent>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }}>
            <Box>
              <Typography variant="overline" sx={{ letterSpacing: 1.8, opacity: 0.8 }}>
                School administration
              </Typography>
              <Typography variant="h3" sx={{ fontWeight: 700, mb: 1 }}>
                Command Center
              </Typography>
              <Typography variant="body1" sx={{ maxWidth: 640, opacity: 0.9 }}>
                Monitor student growth, attendance, fee collections, and system activity from one polished workspace.
              </Typography>
            </Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <Button
                variant="contained"
                color="secondary"
                startIcon={<Refresh />}
                onClick={() => void refreshDashboard()}
                disabled={loading}
              >
                Refresh
              </Button>
              <Button
                variant="outlined"
                sx={{ color: 'white', borderColor: 'rgba(255,255,255,0.35)', '&:hover': { borderColor: 'white', backgroundColor: 'rgba(255,255,255,0.12)' } }}
                startIcon={<Download />}
                onClick={() => setActiveTab('students')}
              >
                Quick actions
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}

      <Card sx={{ mb: 3, borderRadius: 3, border: '1px solid rgba(15, 23, 42, 0.08)' }}>
        <CardContent>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ xs: 'stretch', md: 'center' }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                Dashboard navigation
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Switch between overview, learners, and audit history as needed.
              </Typography>
            </Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              {TABS.map((tab) => (
                <Button
                  key={tab}
                  variant={activeTab === tab ? 'contained' : 'outlined'}
                  onClick={() => setActiveTab(tab)}
                  sx={{ minWidth: 120, textTransform: 'capitalize' }}
                >
                  {tab}
                </Button>
              ))}
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {loading && <CircularProgress sx={{ mb: 2 }} />}

      {activeTab === 'overview' && (
        <Box sx={{ display: 'grid', gap: 3 }}>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(4, 1fr)' } }}>
            <MetricCard title="Students" value={overviewStats.totalStudents} caption="Registered learners" icon={PeopleAlt} accent="#1976d2" />
            <MetricCard title="Teachers" value={overviewStats.totalTeachers} caption="Active staff" icon={School} accent="#2e7d32" />
            <MetricCard title="Attendance" value={`${overviewStats.attendanceRate}%`} caption="Present rate" icon={TrendingUp} accent="#ed6c02" />
            <MetricCard title="Collections" value={formatCurrency(overviewStats.totalCollected)} caption="All recorded payments" icon={ReceiptLong} accent="#7b1fa2" />
          </Box>

          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
            {widgetConfig?.announcements && (
              <Card sx={{ borderRadius: 3 }}>
                <CardContent>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>Announcements</Typography>
                  <Typography variant="body2" color="text.secondary">No new announcements.</Typography>
                </CardContent>
              </Card>
            )}

            {widgetConfig?.calendar && (
              <Card sx={{ borderRadius: 3 }}>
                <CardContent>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>Calendar</Typography>
                  <Typography variant="body2" color="text.secondary">No upcoming events.</Typography>
                </CardContent>
              </Card>
            )}
          </Box>

          <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', lg: '1.2fr 0.8fr' } }}>
            <Card sx={{ borderRadius: 3, border: '1px solid rgba(15, 23, 42, 0.08)' }}>
              <CardContent>
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
                  <Avatar sx={{ bgcolor: '#e3f2fd', color: '#1565c0' }}>
                    <AdminPanelSettings />
                  </Avatar>
                  <Box>
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                      School health snapshot
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Enrollment activity and growth momentum
                    </Typography>
                  </Box>
                </Stack>
                {enrollment ? (
                  <>
                    <Typography variant="body1" sx={{ mb: 1 }}>
                      <strong>{overviewStats.totalStudents}</strong> students and <strong>{overviewStats.totalTeachers}</strong> teachers are currently on record.
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {overviewStats.enrollmentEvents} enrollment events were logged, giving leadership a steady view of growth.
                    </Typography>
                    <Divider sx={{ my: 2 }} />
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="subtitle2" sx={{ mb: 1 }}>
                          Enrollment momentum
                        </Typography>
                        <LinearProgress variant="determinate" value={Math.min(100, overviewStats.enrollmentEvents * 10)} sx={{ height: 8, borderRadius: 999 }} />
                      </Box>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="subtitle2" sx={{ mb: 1 }}>
                          Active records
                        </Typography>
                        <LinearProgress variant="determinate" value={Math.min(100, overviewStats.totalStudents)} sx={{ height: 8, borderRadius: 999, '& .MuiLinearProgress-bar': { backgroundColor: '#2e7d32' } }} />
                      </Box>
                    </Stack>
                  </>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No data yet.
                  </Typography>
                )}
              </CardContent>
            </Card>

            <Card sx={{ borderRadius: 3, border: '1px solid rgba(15, 23, 42, 0.08)' }}>
              <CardContent>
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
                  <Avatar sx={{ bgcolor: '#e8f5e9', color: '#2e7d32' }}>
                    <Security />
                  </Avatar>
                  <Box>
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                      Attendance pulse
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Live status overview
                    </Typography>
                  </Box>
                </Stack>
                {attendance && attendance.attendanceTotals.length > 0 ? (
                  <>
                    <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
                      {overviewStats.attendanceRate}%
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      Based on {overviewStats.totalAttendanceRecords} attendance records.
                    </Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap">
                      {attendance.attendanceTotals.map((row) => (
                        <Chip key={row.status} label={`${row.status}: ${row._count.status}`} color={row.status.toLowerCase().includes('present') ? 'success' : 'default'} />
                      ))}
                    </Stack>
                  </>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No attendance records yet.
                  </Typography>
                )}
              </CardContent>
            </Card>
          </Box>

          <Card sx={{ borderRadius: 3, border: '1px solid rgba(15, 23, 42, 0.08)' }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2, fontWeight: 700 }}>
                Fee collection activity
              </Typography>
              {fees && fees.monthlyCollection.length > 0 ? (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Date</TableCell>
                        <TableCell align="right">Amount collected</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {fees.monthlyCollection.map((row, index) => (
                        <TableRow key={index}>
                          <TableCell>{formatDate(row.paidAt)}</TableCell>
                          <TableCell align="right">{formatCurrency(row._sum.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No payments recorded yet.
                </Typography>
              )}
            </CardContent>
          </Card>
        </Box>
      )}

      {activeTab === 'students' && (
        <Box sx={{ display: 'grid', gap: 3 }}>
          <Card sx={{ borderRadius: 3, border: '1px solid rgba(15, 23, 42, 0.08)' }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1, fontWeight: 700 }}>
                Bulk import learners
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Add multiple accounts at once by pasting each student on a new line as email,firstName,lastName.
              </Typography>
              <TextField
                fullWidth
                multiline
                rows={4}
                placeholder={'jane.doe@pinnacle.school,Jane,Doe\njohn.smith@pinnacle.school,John,Smith'}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
              />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 2 }}>
                <Button variant="contained" onClick={handleBulkImport} disabled={importing}>
                  {importing ? <CircularProgress size={20} /> : 'Import students'}
                </Button>
                <Button variant="outlined" onClick={() => setImportText('')}>
                  Clear
                </Button>
              </Stack>
            </CardContent>
          </Card>

          <Card sx={{ borderRadius: 3, border: '1px solid rgba(15, 23, 42, 0.08)' }}>
            <CardContent>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ mb: 2 }}>
                <Box>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    Student roster
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Search and review learners quickly.
                  </Typography>
                </Box>
                <TextField
                  size="small"
                  placeholder="Search students"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  InputProps={{ startAdornment: <Search sx={{ mr: 1, color: 'text.secondary' }} /> }}
                />
              </Stack>
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell>Email</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Joined</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredStudents.map((student) => (
                      <TableRow key={student.id}>
                        <TableCell>{`${student.firstName} ${student.lastName}`}</TableCell>
                        <TableCell>{student.email}</TableCell>
                        <TableCell>
                          <Chip size="small" label={student.active ? 'Active' : 'Inactive'} color={student.active ? 'success' : 'default'} />
                        </TableCell>
                        <TableCell>{formatDate(student.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                    {filteredStudents.length === 0 && !loading && (
                      <TableRow>
                        <TableCell colSpan={4}>
                          <Typography variant="body2" color="text.secondary">
                            No students match the current search.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              {studentsCursor && (
                <Button variant="outlined" sx={{ mt: 2 }} onClick={() => void fetchStudents(studentsCursor)} disabled={loading}>
                  Load more
                </Button>
              )}
            </CardContent>
          </Card>
        </Box>
      )}

      {activeTab === 'audit' && (
        <Box sx={{ display: 'grid', gap: 3 }}>
          <Card sx={{ borderRadius: 3, border: '1px solid rgba(15, 23, 42, 0.08)' }}>
            <CardContent>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ mb: 2 }}>
                <Box>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    Audit trail
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Review recent changes and administrative actions.
                  </Typography>
                </Box>
                <TextField
                  size="small"
                  placeholder="Search log entries"
                  value={auditSearchTerm}
                  onChange={(e) => setAuditSearchTerm(e.target.value)}
                  InputProps={{ startAdornment: <Search sx={{ mr: 1, color: 'text.secondary' }} /> }}
                />
              </Stack>
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>When</TableCell>
                      <TableCell>Action</TableCell>
                      <TableCell>Entity</TableCell>
                      <TableCell>Summary</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredLogs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell>{formatDate(log.createdAt)}</TableCell>
                        <TableCell>{log.action}</TableCell>
                        <TableCell>{log.entity}</TableCell>
                        <TableCell>{log.summary}</TableCell>
                      </TableRow>
                    ))}
                    {filteredLogs.length === 0 && !loading && (
                      <TableRow>
                        <TableCell colSpan={4}>
                          <Typography variant="body2" color="text.secondary">
                            No audit log entries match the current search.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              {logsCursor && (
                <Button variant="outlined" sx={{ mt: 2 }} onClick={() => void fetchLogs(logsCursor)} disabled={loading}>
                  Load more
                </Button>
              )}
            </CardContent>
          </Card>
        </Box>
      )}
    </Container>
  );
};

export default AdminDashboard;
