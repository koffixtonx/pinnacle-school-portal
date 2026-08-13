import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from '@mui/material/styles';
import AdminDashboard from "./pages/AdminDashboard";
import Home from "./pages/Home";
import Students from "./pages/Students";
import Teachers from "./pages/Teachers";
import Courses from "./pages/Courses";
import Settings from "./pages/Settings";
import SiteCustomization from './pages/SiteCustomization';
import Login from "./pages/Login";
import Register from "./pages/Register";
import DrawerAppBar from "./components/DrawerAppBar";
import getTheme from "./theme";
import Timetable from './pages/Timetable';
import Attendance from './pages/Attendance';
import Grades from './pages/Grades';
import Fees from './pages/Fees';
import { useCurrentUser, type Role } from './hooks/useCurrentUser';

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
  const [isAuthenticated, setIsAuthenticated] = React.useState(
    () => !!localStorage.getItem('user') && !!localStorage.getItem('accessToken')
  );
  React.useEffect(() => {
    const syncAuth = () => setIsAuthenticated(!!localStorage.getItem('user') && !!localStorage.getItem('accessToken'));
    window.addEventListener('pinnacle-auth-change', syncAuth);
    return () => window.removeEventListener('pinnacle-auth-change', syncAuth);
  }, []);
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
        const res = isAuthenticated ? await (await import('./services/api.service')).siteSettingsService.get() : await (await import('./services/api.service')).siteSettingsService.getPublic();
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
  }, [isAuthenticated]);

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
            <Routes>
              <Route path="/" element={<Home />} />
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
              <Route path="/courses" element={<Courses />} />
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
          </DrawerAppBar>
        ) : (
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        )}
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
