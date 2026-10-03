import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from '@mui/material/styles';
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

function App() {
  const currentUser = useCurrentUser();
  const canAccessProtectedSiteSettings = !!currentUser && ['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(currentUser.role);
  const getRoleDashboardPath = (role?: Role) => {
    // Keep the welcome page as the landing destination after login, while preserving direct dashboard routes.
    return '/';
  };

  const [authVersion, setAuthVersion] = React.useState(0);
  React.useEffect(() => {
    const syncAuth = () => setAuthVersion((value) => value + 1);
    window.addEventListener('pinnacle-auth-change', syncAuth);
    return () => window.removeEventListener('pinnacle-auth-change', syncAuth);
  }, []);
  const isAuthenticated = React.useMemo(
    () => !!currentUser && !!localStorage.getItem('accessToken'),
    [currentUser, authVersion]
  );
  const [mode, setMode] = React.useState<'light' | 'dark'>(() => {
    const savedMode = window.localStorage.getItem('pinnacle-color-mode');
    return savedMode === 'dark' || savedMode === 'light' ? savedMode : 'light';
  });

  const theme = React.useMemo(() => getTheme(mode), [mode]);

  const [siteSettings, setSiteSettings] = React.useState<any>(null);

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
      } catch (e) {
        // ignore
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
        {isAuthenticated ? (
          <DrawerAppBar mode={mode} onToggleColorMode={toggleColorMode}>
            <React.Suspense fallback={<div>Loading page...</div>}>
              <Routes>
              <Route path="/" element={<Welcome />} />
              <Route path="/login" element={<Navigate to="/" replace />} />
              <Route path="/register" element={<Navigate to="/" replace />} />
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
                path="/fees"
                element={
                  <ProtectedRoute roles={['SUPER_ADMIN', 'SCHOOL_ADMIN', 'STUDENT']}>
                    <Fees />
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
          <React.Suspense fallback={<div>Loading page...</div>}>
            <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
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
