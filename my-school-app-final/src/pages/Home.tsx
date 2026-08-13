import React from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  MobileStepper,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import KeyboardArrowLeftIcon from '@mui/icons-material/KeyboardArrowLeft';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import SchoolIcon from '@mui/icons-material/School';
import GroupsIcon from '@mui/icons-material/Groups';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import EventNoteIcon from '@mui/icons-material/EventNote';
import pinnacleLogo from '../assets/pinnacle-logo.png';
import { siteSettingsService } from '../services/api.service';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { authService } from '../services/api.service';

const slides = [
  {
    title: 'A Campus Built For Ambition',
    caption: 'Modern learning spaces, active student life, and a culture of achievement.',
    image: 'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?auto=format&fit=crop&w=1400&q=80',
  },
  {
    title: 'Learning That Feels Alive',
    caption: 'Practical classes, engaged teachers, and programs shaped around real progress.',
    image: 'https://images.unsplash.com/photo-1509062522246-3755977927d7?auto=format&fit=crop&w=1400&q=80',
  },
  {
    title: 'Resources For Every Peak',
    caption: 'Libraries, labs, schedules, and support systems working together for students.',
    image: 'https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?auto=format&fit=crop&w=1400&q=80',
  },
];

const highlights = [
  { label: 'Students', value: '320+', icon: <GroupsIcon /> },
  { label: 'Teachers', value: '28', icon: <SchoolIcon /> },
  { label: 'Courses', value: '12', icon: <MenuBookIcon /> },
  { label: 'Events', value: 'Weekly', icon: <EventNoteIcon /> },
];

const Home: React.FC = () => {
  const [activeSlide, setActiveSlide] = React.useState(0);
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const isAuthenticated = Boolean(currentUser);

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveSlide((current) => (current + 1) % slides.length);
    }, 5000);

    return () => window.clearInterval(timer);
  }, []);

  const handleNext = () => {
    setActiveSlide((current) => (current + 1) % slides.length);
  };

  const handleBack = () => {
    setActiveSlide((current) => (current - 1 + slides.length) % slides.length);
  };

  const handleLogout = async () => {
    try {
      await authService.logout();
    } catch (err) {
      console.error('Logout failed', err);
    } finally {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('user');
      window.dispatchEvent(new Event('pinnacle-auth-change'));
      navigate('/login');
    }
  };

  const currentSlide = slides[activeSlide];
  const [logoSrc, setLogoSrc] = React.useState<string | null>(pinnacleLogo);
  const [heroOverride, setHeroOverride] = React.useState<string | null>(null);
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ? String(import.meta.env.VITE_API_BASE_URL).replace(/\/api$/, '') : 'http://localhost:5000';

  const resolveAssetUrl = (path: string) => {
    if (!path) return path;
    return path.startsWith('/uploads') ? `${apiBaseUrl}${path}` : path;
  };

  React.useEffect(() => {
    let mounted = true;
    siteSettingsService.getPublic().then((res) => {
      if (!mounted) return;
      const data = res.data.data;
      if (data?.logoPath) setLogoSrc(data.logoPath);
      if (data?.heroImagePath) setHeroOverride(data.heroImagePath);
    }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  return (
    <Box sx={{ pb: 5 }}>
      <Paper
        elevation={0}
        sx={{
          position: 'relative',
          minHeight: { xs: 560, md: 640 },
          overflow: 'hidden',
          borderRadius: 1,
          color: 'common.white',
          border: '1px solid rgba(255,255,255,0.18)',
          boxShadow: '0 28px 70px rgba(8,34,60,0.22)',
          backgroundImage: `linear-gradient(90deg, rgba(8, 34, 60, 0.92), rgba(18, 53, 91, 0.64) 54%, rgba(8, 34, 60, 0.3)), url(${resolveAssetUrl(heroOverride || currentSlide.image)})`,
          backgroundPosition: 'center',
          backgroundSize: 'cover',
          transition: 'background-image 450ms ease',
        }}
      >
        <Box
          sx={{
            minHeight: { xs: 560, md: 640 },
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            p: { xs: 3, sm: 5, md: 7 },
          }}
        >
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{ alignItems: { xs: 'flex-start', sm: 'center' } }}
          >
            <Box
              component="img"
              src={resolveAssetUrl(logoSrc ?? pinnacleLogo)}
              alt="Pinnacle University"
              sx={{
                width: { xs: 86, sm: 104 },
                height: { xs: 86, sm: 104 },
                objectFit: 'contain',
                bgcolor: 'rgba(255,255,255,0.94)',
                borderRadius: 1,
                p: 1,
                boxShadow: '0 16px 35px rgba(0,0,0,0.22)',
              }}
            />
            <Box>
              <Chip
                label="Reach Your Peak"
                sx={{
                  mb: 1,
                  color: '#08223c',
                  bgcolor: '#f2d675',
                  fontWeight: 700,
                }}
              />
              <Typography variant="h3" component="h1" sx={{ fontWeight: 900, lineHeight: 1.05, maxWidth: 720, letterSpacing: 0 }}>
                Welcome to Pinnacle University
              </Typography>
            </Box>
          </Stack>

          <Box sx={{ maxWidth: 720 }}>
            <Typography variant="h4" component="h2" sx={{ fontWeight: 900, mb: 1, letterSpacing: 0 }}>
              {currentSlide.title}
            </Typography>
            <Typography variant="h6" sx={{ color: 'rgba(255,255,255,0.86)', maxWidth: 640, mb: 3 }}>
              {currentSlide.caption}
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <Button component={RouterLink} to={isAuthenticated ? '/dashboard' : '/login'} variant="contained" color="secondary" size="large" sx={{ color: '#08223c' }}>
                {isAuthenticated ? 'Open Dashboard' : 'Get Started'}
              </Button>
              {isAuthenticated ? (
                <Button variant="outlined" size="large" onClick={handleLogout} sx={{ color: 'common.white', borderColor: 'rgba(255,255,255,0.72)' }}>
                  Sign Out
                </Button>
              ) : (
                <Button
                  component={RouterLink}
                  to="/login"
                  variant="outlined"
                  size="large"
                  sx={{ color: 'common.white', borderColor: 'rgba(255,255,255,0.72)' }}
                >
                  Sign In
                </Button>
              )}
            </Stack>
          </Box>

          <MobileStepper
            variant="dots"
            steps={slides.length}
            position="static"
            activeStep={activeSlide}
            nextButton={
              <Button size="small" onClick={handleNext} sx={{ color: 'common.white' }}>
                Next <KeyboardArrowRightIcon />
              </Button>
            }
            backButton={
              <Button size="small" onClick={handleBack} sx={{ color: 'common.white' }}>
                <KeyboardArrowLeftIcon /> Back
              </Button>
            }
            sx={{
              alignSelf: { xs: 'stretch', sm: 'flex-end' },
              width: { xs: '100%', sm: 320 },
              bgcolor: 'rgba(0,0,0,0.24)',
              borderRadius: 1,
              '& .MuiMobileStepper-dot': { bgcolor: 'rgba(255,255,255,0.42)' },
              '& .MuiMobileStepper-dotActive': { bgcolor: '#f2d675' },
            }}
          />
        </Box>
      </Paper>

      <Grid container spacing={3} sx={{ mt: 3 }}>
        {highlights.map((item) => (
          <Grid key={item.label} item xs={12} sm={6} md={3}>
            <Card sx={{ height: '100%', borderTop: '3px solid', borderColor: 'secondary.main' }}>
              <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box
                  sx={{
                    color: 'primary.main',
                    bgcolor: 'rgba(18,53,91,0.08)',
                    display: 'flex',
                    p: 1.25,
                    borderRadius: 1,
                  }}
                >
                  {item.icon}
                </Box>
                <Box>
                  <Typography variant="h5" sx={{ fontWeight: 800 }}>
                    {item.value}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {item.label}
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={3} sx={{ mt: 1 }}>
        <Grid item xs={12} md={7}>
          <Card sx={{ height: '100%' }}>
            <CardContent sx={{ p: { xs: 3, md: 4 } }}>
              <Typography variant="h5" sx={{ fontWeight: 800, mb: 2 }}>
                About Pinnacle University
              </Typography>
              <Typography color="text.secondary" sx={{ lineHeight: 1.8 }}>
                Pinnacle University is a focused academic community designed to help students build confidence,
                discipline, and practical skill. Our portal brings key school activities into one place, from
                students and courses to timetables, announcements, and administrative updates.
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={5}>
          <Card sx={{ height: '100%' }}>
            <CardContent sx={{ p: { xs: 3, md: 4 } }}>
              <Typography variant="h5" sx={{ fontWeight: 800, mb: 2 }}>
                Quick Bio
              </Typography>
              <Typography color="text.secondary" sx={{ lineHeight: 1.8 }}>
                Motto: Reach Your Peak.
              </Typography>
              <Typography color="text.secondary" sx={{ lineHeight: 1.8 }}>
                Focus: strong academics, clear communication, student growth, and everyday excellence.
              </Typography>
              <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 2, flexWrap: 'wrap' }}>
                {['Academic Excellence', 'Leadership', 'Innovation', 'Community'].map((value) => (
                  <Chip key={value} label={value} size="small" />
                ))}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Home;
