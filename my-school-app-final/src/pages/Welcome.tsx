import React from 'react';
import { Alert, Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import DashboardIcon from '@mui/icons-material/Dashboard';
import EventNoteIcon from '@mui/icons-material/EventNote';
import PaymentsIcon from '@mui/icons-material/Payments';
import { Link as RouterLink } from 'react-router-dom';
import { siteSettingsService } from '../services/api.service';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { resolveAssetUrl } from '../services/api';
import heroCampus from '../assets/hero-campus.svg';
import heroHall from '../assets/hero-hall.svg';
import heroLibrary from '../assets/hero-library.svg';

// Placeholder art used until an administrator adds welcome backgrounds in
// Site Customization.  Tenant-provided images always take precedence.
const fallbackBackgrounds = [heroCampus, heroHall, heroLibrary];

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
        const usableBackgrounds = configuredBackgrounds.map(resolveAssetUrl).filter(Boolean);
        if (usableBackgrounds.length) setBackgrounds(usableBackgrounds);
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
        <Box key={image} aria-hidden="true" sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', backgroundImage: `url("${image}")`, backgroundSize: 'cover', backgroundPosition: 'center', opacity: index === activeBackground ? 1 : 0, transition: 'opacity 1100ms ease-in-out' }} />
      ))}
      <Box aria-hidden="true" sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: (theme) => theme.palette.mode === 'dark' ? 'linear-gradient(105deg, rgba(4,15,30,.94), rgba(4,15,30,.55))' : 'linear-gradient(105deg, rgba(4,26,53,.89), rgba(4,26,53,.50))' }} />
      <Stack spacing={{ xs: 3, md: 5 }} sx={{ position: 'relative', zIndex: 1, minHeight: { xs: 480, md: 620 }, p: { xs: 3, sm: 5, md: 7 }, justifyContent: 'center', alignItems: 'flex-start' }}>
        <Box>
          {loading && <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: 'center' }}><CircularProgress size={18} color="inherit" /><Typography variant="body2">Loading welcome settings…</Typography></Stack>}
          {loadError && <Alert severity="warning" sx={{ mb: 2, maxWidth: 600, bgcolor: 'rgba(255,255,255,.94)' }}>Welcome settings could not be loaded. Default content is being shown; check that the API is available.</Alert>}
          <Typography variant="overline" sx={{ letterSpacing: 2, fontWeight: 700, opacity: .9 }}>PINNACLE UNIVERSITY</Typography>
          <Typography component="h1" variant="h2" sx={{ mt: 1, maxWidth: 760, fontSize: { xs: '1.9rem', sm: '2.6rem', md: '3.5rem' }, fontWeight: 900, lineHeight: 1.12, overflowWrap: 'anywhere', color: message ? messageColor : 'common.white' }}>{displayedMessage}</Typography>
          <Typography variant="h6" sx={{ mt: 2, maxWidth: 610, fontSize: { xs: '1rem', md: '1.25rem' }, color: 'rgba(255,255,255,.9)', fontWeight: 400 }}>Your learning community, tools, and progress are all within reach.</Typography>
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} useFlexGap sx={{ flexWrap: 'wrap' }}>
          {dashboardPath && <Button component={RouterLink} to={dashboardPath} variant="contained" size="large" startIcon={<DashboardIcon />} sx={{ bgcolor: 'common.white', color: 'primary.dark', '&:hover': { bgcolor: 'rgba(255,255,255,.86)' } }}>Open dashboard</Button>}
          <Button component={RouterLink} to="/timetable" variant="outlined" size="large" startIcon={<EventNoteIcon />} sx={quickLinkSx}>Timetable</Button>
          {canAccessFees(currentUser?.role) && <Button component={RouterLink} to="/fees" variant="outlined" size="large" startIcon={<PaymentsIcon />} sx={quickLinkSx}>Fees</Button>}
          <Button component={RouterLink} to="/settings" variant="outlined" size="large" startIcon={<AccountCircleIcon />} sx={quickLinkSx}>Profile & settings</Button>
        </Stack>
      </Stack>
    </Paper>
  );
};

export default Welcome;
