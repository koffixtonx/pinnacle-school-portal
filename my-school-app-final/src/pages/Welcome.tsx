import React from 'react';
import { Alert, Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import DashboardIcon from '@mui/icons-material/Dashboard';
import EventNoteIcon from '@mui/icons-material/EventNote';
import PaymentsIcon from '@mui/icons-material/Payments';
import { Link as RouterLink } from 'react-router-dom';
import { siteSettingsService } from '../services/api.service';
import { useCurrentUser } from '../hooks/useCurrentUser';

// These are only used until an administrator adds welcome backgrounds in
// Site Customization.  Tenant-provided images always take precedence.
const fallbackBackgrounds = [
  'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?auto=format&fit=crop&w=1800&q=85',
  'https://images.unsplash.com/photo-1509062522246-3755977927d7?auto=format&fit=crop&w=1800&q=85',
  'https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?auto=format&fit=crop&w=1800&q=85',
];

const apiOrigin = (import.meta.env.VITE_API_BASE_URL
  ? String(import.meta.env.VITE_API_BASE_URL).replace(/\/api\/?$/, '')
  : 'http://localhost:5000');

const resolveAssetUrl = (path: string) => path.startsWith('/uploads') ? `${apiOrigin}${path}` : path;

const getDashboardPath = (role?: string) => {
  if (role === 'SUPER_ADMIN' || role === 'SCHOOL_ADMIN') return '/dashboard';
  if (role === 'TEACHER') return '/teacher-dashboard';
  if (role === 'STUDENT') return '/student-dashboard';
  return null;
};

const canAccessFees = (role?: string) => ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'STUDENT'].includes(role ?? '');

const Welcome: React.FC = () => {
  const currentUser = useCurrentUser();
  const [backgrounds, setBackgrounds] = React.useState<string[]>(fallbackBackgrounds);
  const [message, setMessage] = React.useState<string | null>(null);
  const [messageColor, setMessageColor] = React.useState('#f2d675');
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false);
  const [activeBackground, setActiveBackground] = React.useState(0);

  React.useEffect(() => {
    let mounted = true;
    const loadWelcomeSettings = async () => {
      try {
        const response = await siteSettingsService.getPublic();
        if (!mounted) return;
        const settings = response.data.data;
        const configuredBackgrounds = Array.isArray(settings?.welcomeBackgroundImages)
          ? settings.welcomeBackgroundImages.filter((image: unknown): image is string => typeof image === 'string' && image.length > 0)
          : [];
        if (configuredBackgrounds.length) setBackgrounds(configuredBackgrounds.map(resolveAssetUrl));
        setMessage(typeof settings?.welcomeMessage === 'string' && settings.welcomeMessage.trim() ? settings.welcomeMessage.trim() : null);
        setMessageColor(settings?.welcomeMessageColor || '#f2d675');
      } catch {
        if (mounted) setLoadError(true);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void loadWelcomeSettings();
    return () => { mounted = false; };
  }, []);

  React.useEffect(() => {
    if (backgrounds.length < 2) return undefined;
    const delay = 5000 + Math.floor(Math.random() * 5001);
    const timer = window.setTimeout(() => {
      setActiveBackground((current) => (current + 1) % backgrounds.length);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [activeBackground, backgrounds]);

  React.useEffect(() => {
    setActiveBackground((current) => current % backgrounds.length);
  }, [backgrounds.length]);

  const dashboardPath = getDashboardPath(currentUser?.role);
  const displayedMessage = message || (currentUser?.firstName ? `Welcome, ${currentUser.firstName}` : 'Welcome to Pinnacle');
  const quickLinkSx = { color: 'common.white', borderColor: 'rgba(255,255,255,.65)', '&:hover': { borderColor: 'common.white', bgcolor: 'rgba(255,255,255,.12)' } };

  return (
    <Paper
      elevation={0}
      sx={{ position: 'relative', minHeight: { xs: 480, md: 620 }, overflow: 'hidden', borderRadius: 2, bgcolor: 'primary.dark', color: 'common.white' }}
    >
      {backgrounds.map((image, index) => (
        <Box key={image} aria-hidden="true" sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', backgroundImage: `url(${image})`, backgroundSize: 'cover', backgroundPosition: 'center', opacity: index === activeBackground ? 1 : 0, transition: 'opacity 1100ms ease-in-out' }} />
      ))}
      <Box aria-hidden="true" sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: (theme) => theme.palette.mode === 'dark' ? 'linear-gradient(105deg, rgba(4,15,30,.94), rgba(4,15,30,.63))' : 'linear-gradient(105deg, rgba(4,26,53,.89), rgba(4,26,53,.50))' }} />
      <Stack sx={{ position: 'relative', zIndex: 1, minHeight: { xs: 480, md: 620 }, p: { xs: 3, sm: 5, md: 7 }, justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box>
          {loading && <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}><CircularProgress size={18} color="inherit" /><Typography variant="body2">Loading welcome settings…</Typography></Stack>}
          {loadError && <Alert severity="warning" sx={{ mb: 2, maxWidth: 600, bgcolor: 'rgba(255,255,255,.94)' }}>Welcome settings could not be loaded. Default content is being shown; check that the API is available.</Alert>}
          <Typography variant="overline" sx={{ letterSpacing: 2, fontWeight: 700, opacity: .9 }}>PINNACLE UNIVERSITY</Typography>
          <Typography component="h1" variant="h2" sx={{ mt: 1, maxWidth: 760, fontWeight: 900, lineHeight: 1.06, color: message ? messageColor : 'common.white' }}>{displayedMessage}</Typography>
          <Typography variant="h6" sx={{ mt: 2, maxWidth: 610, color: 'rgba(255,255,255,.9)', fontWeight: 400 }}>Your learning community, tools, and progress are all within reach.</Typography>
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} useFlexGap flexWrap="wrap">
          {dashboardPath && <Button component={RouterLink} to={dashboardPath} variant="contained" color="secondary" size="large" startIcon={<DashboardIcon />} sx={{ color: 'primary.dark' }}>Open dashboard</Button>}
          <Button component={RouterLink} to="/timetable" variant="outlined" size="large" startIcon={<EventNoteIcon />} sx={quickLinkSx}>Timetable</Button>
          {canAccessFees(currentUser?.role) && <Button component={RouterLink} to="/fees" variant="outlined" size="large" startIcon={<PaymentsIcon />} sx={quickLinkSx}>Fees</Button>}
          <Button component={RouterLink} to="/settings" variant="outlined" size="large" startIcon={<AccountCircleIcon />} sx={quickLinkSx}>Profile & settings</Button>
        </Stack>
      </Stack>
    </Paper>
  );
};

export default Welcome;
