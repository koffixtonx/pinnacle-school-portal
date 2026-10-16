import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from '@mui/material/styles';
import { Box, CircularProgress } from '@mui/material';
import { SpeedInsights } from '@vercel/speed-insights/react';
import DrawerAppBar from "./components/DrawerAppBar";
import getTheme from "./theme";
import { useCurrentUser, type Role } from './hooks/useCurrentUser';

const AdminDashboard = React.lazy(() => import('./pages/AdminDashboard'));
const TeacherDashboard = React.lazy(() => import('./pages/TeacherDashboard'));
const StudentDashboard = React.lazy(() => import('./pages/StudentDashboard'));
const Home = React.lazy(() => import('./pages/Home'));
const Welcome = React.lazy(() => import('./pages/Welcome'));
const Students = React.lazy(() => import('./pages/Students'));
const Teachers = React.lazy(() => import('./pages/Teachers'));
const Courses = React.lazy(() => import('./pages/Courses'));
const Settings = React.lazy(() => import('./pages/Settings'));
const SiteCustomization = React.lazy(() => import('./pages/SiteCustomization'));
const Login = React.lazy(() => import('./pages/Login'));
const Register = React.lazy(() => import('./pages/Register'));
const Timetable = React.lazy(() => import('./pages/Timetable'));
const Attendance = React.lazy(() => import('./pages/Attendance'));
const Grades = React.lazy(() => import('./pages/Grades'));
const Fees = React.lazy(() => import('./pages/Fees'));
const Departments = React.lazy(() => import('./pages/Departments'));
const CourseCatalog = React.lazy(() => import('./pages/CourseCatalog'));
const AcademicCalendar = React.lazy(() => import('./pages/AcademicCalendar'));
const CourseRegistration = React.lazy(() => import('./pages/CourseRegistration'));
const CourseRegistrationReview = React.lazy(() => import('./pages/CourseRegistrationReview'));
const Announcements = React.lazy(() => import('./pages/Announcements'));
const AnnouncementReview = React.lazy(() => import('./pages/AnnouncementReview'));
const Results = React.lazy(() => import('./pages/Results'));
const Assignments = React.lazy(() => import('./pages/Assignments'));
const AssignmentReview = React.lazy(() => import('./pages/AssignmentReview'));
const Materials = React.lazy(() => import('./pages/Materials'));
const IdCard = React.lazy(() => import('./pages/IdCard'));
const AuditLog = React.lazy(() => import('./pages/AuditLog'));
const ForgotPassword = React.lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = React.lazy(() => import('./pages/ResetPassword'));
const VerifyTotp = React.lazy(() => import('./pages/VerifyTotp'));

// Protected Route Component: requires login, and (if roles is given) requires
// the current user's role to be one of the allowed roles.
const ProtectedRoute: React.FC<{ children: React.ReactNode; roles?: Role[] }> = ({ children, roles }) => {
  const user = useCurrentUser();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

function PageFallback() {
  return (
    <Box sx={{ minHeight: '50dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <CircularProgress size={28} />
    </Box>
  );
}

function App() {
  const currentUser = useCurrentUser();
  const canAccessProtectedSiteSettings = !!currentUser && ['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(currentUser.role);
  const [, bumpAuthVersion] = React.useState(0);
  React.useEffect(() => {
    const syncAuth = () => bumpAuthVersion((value) => value + 1);
    window.addEventListener('pinnacle-auth-change', syncAuth);
    return () => window.removeEventListener('pinnacle-auth-change', syncAuth);
  }, []);
  const isAuthenticated = !!currentUser && !!localStorage.getItem('accessToken');
  const [mode, setMode] = React.useState<'light' | 'dark'>(() => {
    const savedMode = window.localStorage.getItem('pinnacle-color-mode');
    return savedMode === 'dark' || savedMode === 'light' ? savedMode : 'light';
  });

  const [siteSettings, setSiteSettings] = React.useState<any>(null);

  // A student with a confirmed authenticator must prove it before the portal
  // opens. The answer comes from GoTrue (`auth.mfa`), never from a column we
  // keep ourselves, so it cannot drift from what the auth server believes.
  const [needsSecondFactor, setNeedsSecondFactor] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    if (!isAuthenticated) {
      setNeedsSecondFactor(null);
      return;
    }
    let cancelled = false;
    const check = async () => {
      try {
        const service = await import('./services/api.service');
        const status = await service.mfaService.status();
        const verified = status.data.data.enrolled ? await service.mfaService.isVerified() : true;
        if (!cancelled) setNeedsSecondFactor(status.data.data.enrolled && !verified);
      } catch {
        // A failure to read the factor list must not lock anyone out of a portal
        // they are already signed into; it also must not pretend the check
        // passed silently, so it is logged.
        console.error('Two-factor status unavailable');
        if (!cancelled) setNeedsSecondFactor(false);
      }
    };
    void check();
    return () => { cancelled = true; };
  }, [isAuthenticated]);

  // load site settings (public or protected) and listen for updates
  React.useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const service = await import('./services/api.service');
        const res = canAccessProtectedSiteSettings
          ? await service.siteSettingsService.get()
          : await service.siteSettingsService.getPublic();
        if (!mounted) return;
        setSiteSettings(res.data.data);
      } catch {
        // Branding is cosmetic; fall back to the default theme when it can't be read.
      }
    };
    load();
    const onUpdate = (e: any) => setSiteSettings(e.detail ?? e);
    window.addEventListener('site-settings-updated', onUpdate as EventListener);
    return () => { mounted = false; window.removeEventListener('site-settings-updated', onUpdate as EventListener); };
  }, [canAccessProtectedSiteSettings, isAuthenticated]);

  const themeWithOverrides = React.useMemo(() => getTheme(mode, { primary: siteSettings?.primaryColor, secondary: siteSettings?.secondaryColor }), [mode, siteSettings]);

  const toggleColorMode = () => {
    setMode((currentMode) => {
      const nextMode = currentMode === 'light' ? 'dark' : 'light';
      window.localStorage.setItem('pinnacle-color-mode', nextMode);
      return nextMode;
    });
  };

  return (
    <ThemeProvider theme={themeWithOverrides}>
      <BrowserRouter>
        {/* Signed in but the factor check has not answered yet (null) or has not
            cleared (true): neither state may show the portal's pages. */}
        {isAuthenticated && needsSecondFactor !== false ? (
          needsSecondFactor === null ? (
            <PageFallback />
          ) : (
            <React.Suspense fallback={<PageFallback />}>
              <Routes>
                <Route path="*" element={<VerifyTotp onVerified={() => setNeedsSecondFactor(false)} />} />
              </Routes>
            </React.Suspense>
          )
        ) : isAuthenticated ? (
          <DrawerAppBar mode={mode} onToggleColorMode={toggleColorMode}>
            <React.Suspense fallback={<PageFallback />}>
              <Routes>
              <Route path="/" element={<Welcome />} />
              <Route path="/login" element={<Navigate to="/" replace />} />
              <Route path="/register" element={<Navigate to="/" replace />} />
              {/* A reset link opened while already signed in still has to land
                  somewhere; the page refuses to change a password without the
                  code it was sent with. */}
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute roles={['SUPER_ADMIN', 'SCHOOL_ADMIN']}>
                    <AdminDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/teacher-dashboard"
                element={
                  <ProtectedRoute roles={['TEACHER']}>
                    <TeacherDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/student-dashboard"
                element={
                  <ProtectedRoute roles={['STUDENT']}>
                    <StudentDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/students"
                element={
                  <ProtectedRoute roles={['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']}>
                    <Students />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/teachers"
                element={
                  <ProtectedRoute roles={['SUPER_ADMIN', 'SCHOOL_ADMIN']}>
                    <Teachers />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/departments"
                element={
                  <ProtectedRoute roles={['SUPER_ADMIN', 'SCHOOL_ADMIN']}>
                    <Departments />
                  </ProtectedRoute>
                }
              />
              <Route path="/courses" element={<Courses />} />
              <Route path="/course-catalog" element={<CourseCatalog />} />
              <Route path="/timetable" element={<Timetable />} />
              <Route
                path="/attendance"
                element={
                  <ProtectedRoute roles={['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'STUDENT']}>
                    <Attendance />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/grades"
                element={
                  <ProtectedRoute roles={['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'STUDENT']}>
                    <Grades />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/academic-calendar"
                element={
                  <ProtectedRoute roles={['SUPER_ADMIN', 'SCHOOL_ADMIN']}>
                    <AcademicCalendar />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/course-registration"
                element={
                  <ProtectedRoute roles={['STUDENT']}>
                    <CourseRegistration />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/course-registration-review"
                element={
                  <ProtectedRoute roles={['SUPER_ADMIN', 'SCHOOL_ADMIN']}>
                    <CourseRegistrationReview />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/results"
                element={
                  <ProtectedRoute roles={['STUDENT']}>
                    <Results />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/fees"
                element={
                  <ProtectedRoute roles={['SUPER_ADMIN', 'SCHOOL_ADMIN', 'STUDENT']}>
                    <Fees />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/assignments"
                element={
                  <ProtectedRoute roles={['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'STUDENT']}>
                    <Assignments />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/assignment-review"
                element={
                  <ProtectedRoute roles={['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']}>
                    <AssignmentReview />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/materials"
                element={
                  <ProtectedRoute roles={['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'STUDENT']}>
                    <Materials />
                  </ProtectedRoute>
                }
              />
              {/* A card is held by a student or an office member and issued by the
                  office; a lecturer has neither job here, and the page has nothing to
                  show them. */}
              <Route
                path="/id-card"
                element={
                  <ProtectedRoute roles={['SUPER_ADMIN', 'SCHOOL_ADMIN', 'STUDENT', 'NON_ACADEMIC_STAFF']}>
                    <IdCard />
                  </ProtectedRoute>
                }
              />
              {/* Every signed-in person has an audience of their own, parents
                  included, so the feed is open to the whole portal. */}
              <Route path="/announcements" element={<Announcements />} />
              <Route
                path="/announcement-review"
                element={
                  <ProtectedRoute roles={['SUPER_ADMIN', 'SCHOOL_ADMIN']}>
                    <AnnouncementReview />
                  </ProtectedRoute>
                }
              />
              {/* audit_logs_read (0003) hands the trail to a school's own
                  administrators, so a teacher routed here would get an empty
                  page rather than an answer. */}
              <Route
                path="/audit-log"
                element={
                  <ProtectedRoute roles={['SUPER_ADMIN', 'SCHOOL_ADMIN']}>
                    <AuditLog />
                  </ProtectedRoute>
                }
              />
              <Route path="/settings" element={<Settings />} />
              <Route
                path="/site-customization"
                element={
                  <ProtectedRoute roles={["SUPER_ADMIN", "SCHOOL_ADMIN"]}>
                    <SiteCustomization />
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </React.Suspense>
          </DrawerAppBar>
        ) : (
          <React.Suspense fallback={<PageFallback />}>
            <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
          </React.Suspense>
        )}
        <SpeedInsights />
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
