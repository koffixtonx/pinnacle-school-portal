import * as React from 'react';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import CssBaseline from '@mui/material/CssBaseline';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import MenuIcon from '@mui/icons-material/Menu';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import ListItemIcon from '@mui/material/ListItemIcon';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import Link from '@mui/material/Link';
import DashboardIcon from '@mui/icons-material/Dashboard';
import HomeIcon from '@mui/icons-material/Home';
import GroupIcon from '@mui/icons-material/Group';
import SchoolIcon from '@mui/icons-material/School';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import SettingsIcon from '@mui/icons-material/Settings';
import EventNoteIcon from '@mui/icons-material/EventNote';
import SearchIcon from '@mui/icons-material/Search';
import NotificationsIcon from '@mui/icons-material/Notifications';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import GradeIcon from '@mui/icons-material/Grade';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import { useCurrentUser, type Role } from '../hooks/useCurrentUser';
import EmailIcon from '@mui/icons-material/Email';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import PhoneIcon from '@mui/icons-material/Phone';
import Logo from './Logo';
import Badge from '@mui/material/Badge';
import Button from '@mui/material/Button';
import InputBase from '@mui/material/InputBase';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import Tooltip from '@mui/material/Tooltip';
import { authService, notificationsService } from '../services/api.service';
import { styled, alpha } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  category?: string;
  level?: string;
  createdAt: string;
  readBy?: string | null;
}

interface Props {
  window?: () => Window;
  children?: React.ReactNode;
  mode?: 'light' | 'dark';
  onToggleColorMode?: () => void;
}

const Search = styled('div')(({ theme }) => ({
  position: 'relative',
  borderRadius: 999,
  backgroundColor: alpha(theme.palette.common.white, 0.13),
  border: `1px solid ${alpha(theme.palette.common.white, 0.18)}`,
  '&:hover': {
    backgroundColor: alpha(theme.palette.common.white, 0.2),
  },
  marginRight: theme.spacing(2),
  marginLeft: 0,
  width: '100%',
  [theme.breakpoints.up('sm')]: {
    marginLeft: theme.spacing(3),
    width: 'auto',
  },
}));

const SearchIconWrapper = styled('div')(({ theme }) => ({
  padding: theme.spacing(0, 2),
  height: '100%',
  position: 'absolute',
  pointerEvents: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}));

const StyledInputBase = styled(InputBase)(({ theme }) => ({
  color: 'inherit',
  '& .MuiInputBase-input': {
    padding: theme.spacing(1, 1, 1, 0),
    paddingLeft: `calc(1em + ${theme.spacing(4)})`,
    transition: theme.transitions.create('width'),
    width: '100%',
    [theme.breakpoints.up('md')]: {
      width: '20ch',
    },
  },
}));

const drawerWidth = 260;
const navItems: { label: string; description: string; to: string; icon: React.ReactNode; roles?: Role[] }[] = [
  { label: 'Welcome', description: 'Open welcome page', to: '/', icon: <HomeIcon /> },
  {
    label: 'Dashboard',
    description: 'Go to dashboard',
    to: '/dashboard',
    icon: <DashboardIcon />,
    roles: ['SUPER_ADMIN', 'SCHOOL_ADMIN'],
  },
  {
    label: 'Dashboard',
    description: 'Go to your teacher dashboard',
    to: '/teacher-dashboard',
    icon: <DashboardIcon />,
    roles: ['TEACHER'],
  },
  {
    label: 'Dashboard',
    description: 'Go to your student dashboard',
    to: '/student-dashboard',
    icon: <DashboardIcon />,
    roles: ['STUDENT'],
  },
  {
    label: 'Students',
    description: 'View students',
    to: '/students',
    icon: <GroupIcon />,
    roles: ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'],
  },
  {
    label: 'Teachers',
    description: 'View teachers',
    to: '/teachers',
    icon: <SchoolIcon />,
    roles: ['SUPER_ADMIN', 'SCHOOL_ADMIN'],
  },
  {
    label: 'Departments',
    description: 'Manage faculties and departments',
    to: '/departments',
    icon: <SchoolIcon />,
    roles: ['SUPER_ADMIN', 'SCHOOL_ADMIN'],
  },
  { label: 'Timetable', description: 'Open timetable', to: '/timetable', icon: <EventNoteIcon /> },
  { label: 'Courses', description: 'Browse courses', to: '/courses', icon: <MenuBookIcon /> },
  { label: 'Course Catalogue', description: 'Browse faculty course hierarchy', to: '/course-catalog', icon: <MenuBookIcon /> },
  { label: 'Attendance', description: 'Track attendance', to: '/attendance', icon: <EventAvailableIcon /> },
  { label: 'Grades', description: 'View and enter grades', to: '/grades', icon: <GradeIcon /> },
  {
    label: 'Fees',
    description: 'Invoices and payments',
    to: '/fees',
    icon: <ReceiptLongIcon />,
    roles: ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'STUDENT'],
  },
  {
    label: 'Site Customization',
    description: 'Customize portal branding and widgets',
    to: '/site-customization',
    icon: <SettingsIcon />,
    roles: ['SUPER_ADMIN', 'SCHOOL_ADMIN'],
  },
  { label: 'Settings', description: 'App settings', to: '/settings', icon: <SettingsIcon /> },
];

const supportLinks = [
  { label: 'Help Center', to: '/settings', icon: <SettingsIcon /> },
  { label: 'Student Portal', to: '/', icon: <DashboardIcon /> },
  { label: 'Course Catalog', to: '/courses', icon: <MenuBookIcon /> },
];

export default function DrawerAppBar(props: Props) {
  const { window, children, mode = 'light', onToggleColorMode } = props;
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [profileAnchor, setProfileAnchor] = React.useState<null | HTMLElement>(null);
  const [notificationAnchor, setNotificationAnchor] = React.useState<null | HTMLElement>(null);
  const [notifications, setNotifications] = React.useState<NotificationItem[]>([]);
  const location = useLocation();
  const navigate = useNavigate();
  const currentYear = new Date().getFullYear();

  const currentUser = useCurrentUser();
  const isAuthenticated = Boolean(currentUser);
  const unreadNotifications = notifications.filter((item) => !item.readBy || item.readBy !== currentUser?.id).length;

  React.useEffect(() => {
    if (!isAuthenticated) {
      setNotifications([]);
      return;
    }

    let cancelled = false;
    const loadNotifications = async () => {
      try {
        const response = await notificationsService.list();
        if (!cancelled) {
          setNotifications(response.data?.data ?? []);
        }
      } catch (error) {
        if (!cancelled) {
          setNotifications([]);
        }
      }
    };

    void loadNotifications();
    const intervalId = globalThis.setInterval(() => {
      void loadNotifications();
    }, 30000);

    return () => {
      cancelled = true;
      globalThis.clearInterval(intervalId);
    };
  }, [isAuthenticated, currentUser?.id]);

  const handleDrawerToggle = () => {
    setMobileOpen((prevState) => !prevState);
  };

  const handleProfileMenu = (event: React.MouseEvent<HTMLElement>) => {
    setProfileAnchor(event.currentTarget);
  };

  const handleNotificationMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setNotificationAnchor(event.currentTarget);
  };

  const handleNotificationMenuClose = () => {
    setNotificationAnchor(null);
  };

  const handleProfileClose = () => {
    setProfileAnchor(null);
  };

  const handleLogout = async () => {
    try {
      await authService.logout();
    } catch (err) {
      console.error('Logout failed', err);
    } finally {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('user');
      globalThis.dispatchEvent(new Event('pinnacle-auth-change'));
      handleProfileClose();
      navigate('/login');
    }
  };

  const handleLoginClick = () => {
    handleProfileClose();
    navigate('/login');
  };

  const handleNotificationRead = async (notificationId: string) => {
    try {
      await notificationsService.markRead(notificationId);
      setNotifications((current) =>
        current.map((item) =>
          item.id === notificationId ? { ...item, readBy: currentUser?.id ?? item.readBy ?? 'read' } : item
        )
      );
    } catch (error) {
      console.error('Failed to mark notification as read', error);
    }
  };

  const handleAllNotificationsRead = async () => {
    try {
      await notificationsService.markAllRead();
      setNotifications((current) => current.map((item) => ({ ...item, readBy: currentUser?.id ?? item.readBy ?? 'read' })));
    } catch (error) {
      console.error('Failed to mark all notifications as read', error);
    }
  };

  const profileOpen = Boolean(profileAnchor);
  const notificationsOpen = Boolean(notificationAnchor);
  const visibleNavItems = React.useMemo(
    () => navItems.filter((item) => !item.roles || (currentUser && item.roles.includes(currentUser.role))),
    [currentUser]
  );

  const drawer = (
    <Box onClick={handleDrawerToggle} sx={{ textAlign: 'left', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ px: 2, py: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
        <Logo />
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700, color: 'primary.main' }}>
            Pinnacle University
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
            Where Ambition Meets Achievement
          </Typography>
        </Box>
      </Box>
      <Divider />
      <Typography variant="caption" sx={{ px: 3, pt: 2.5, pb: 1, display: 'block', fontWeight: 800, letterSpacing: 1, color: 'text.secondary' }}>
        MENU
      </Typography>
      <List sx={{ flex: 1, px: 1 }}>
        {visibleNavItems.map((item) => {
          const active = location.pathname === item.to;
          return (
          <ListItem key={item.label} disablePadding sx={{ mb: 0.5 }}>
            <ListItemButton
              component={RouterLink}
              to={item.to}
              sx={{
                borderRadius: 2,
                py: 1,
                bgcolor: active ? 'primary.main' : 'transparent',
                color: active ? 'common.white' : 'text.primary',
                '&:hover': {
                  bgcolor: active ? 'primary.main' : 'rgba(18,53,91,0.06)',
                },
              }}
            >
              <ListItemIcon sx={{ color: active ? 'common.white' : 'primary.main', minWidth: 38 }}>{item.icon}</ListItemIcon>
              <ListItemText
                primary={item.label}
                slotProps={{
                  primary: {
                    sx: { fontWeight: active ? 700 : 500, fontSize: '0.9rem' },
                  },
                }}
              />
            </ListItemButton>
          </ListItem>
          );
        })}
      </List>
      <Divider />
      <List sx={{ px: 1 }}>
        <ListItem disablePadding sx={{ mb: 0.5 }}>
          <ListItemButton sx={{ borderRadius: 2 }} component={RouterLink} to="/settings">
            <ListItemIcon sx={{ color: 'primary.main', minWidth: 38 }}><SettingsIcon /></ListItemIcon>
            <ListItemText primary="Help & Support" slotProps={{ primary: { sx: { fontSize: '0.9rem' } } }} />
          </ListItemButton>
        </ListItem>
        <ListItem disablePadding>
          <ListItemButton onClick={isAuthenticated ? handleLogout : handleLoginClick} sx={{ borderRadius: 2 }}>
            <ListItemIcon sx={{ color: 'primary.main', minWidth: 38 }}><AccountCircleIcon /></ListItemIcon>
            <ListItemText primary={isAuthenticated ? 'Log out' : 'Log in'} slotProps={{ primary: { sx: { fontSize: '0.9rem' } } }} />
          </ListItemButton>
        </ListItem>
      </List>
    </Box>
  );

  const container = window !== undefined ? () => window().document.body : undefined;

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <CssBaseline />
      <AppBar
        component="nav"
        elevation={0}
        sx={{
          background: 'linear-gradient(90deg, #08223c 0%, #12355b 62%, #1f5f8b 100%)',
          borderBottom: '1px solid rgba(255,255,255,0.16)',
          boxShadow: '0 12px 35px rgba(8,34,60,0.22)',
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          ml: { sm: `${drawerWidth}px` },
        }}
      >
        <Toolbar
          sx={{
            display: 'flex',
            flexWrap: { xs: 'nowrap', md: 'wrap' },
            gap: 1.25,
            alignItems: 'center',
            justifyContent: 'space-between',
            minHeight: { xs: 54, sm: 58 },
            py: 0.5,
            px: { xs: 1.5, sm: 2, md: 3 },
          }}
        >
          <IconButton
            color="inherit"
            aria-label="open drawer"
            edge="start"
            onClick={handleDrawerToggle}
            size="small"
            sx={{ mr: 0.5, display: { sm: 'none' } }}
          >
            <MenuIcon />
          </IconButton>
          
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexGrow: 0, minWidth: 0 }}>
            <Logo size={32} />
            <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
              <Typography
                variant="subtitle1"
                component="div"
                noWrap
                sx={{ fontWeight: 700, color: 'common.white', lineHeight: 1.1, maxWidth: { sm: 180, md: 'none' } }}
              >
                Pinnacle University
              </Typography>
              <Typography
                variant="caption"
                noWrap
                sx={{ color: 'common.white', display: 'block', opacity: 0.85, lineHeight: 1.1, maxWidth: { sm: 180, md: 'none' } }}
              >
                Where Ambition Meets Achievement
              </Typography>
              {isAuthenticated && currentUser?.firstName && (
                <Typography
                  variant="caption"
                  noWrap
                  sx={{ color: 'common.white', display: { xs: 'none', sm: 'block' }, opacity: 0.95, lineHeight: 1.1, maxWidth: { sm: 180, md: 'none' } }}
                >
                  Welcome, {currentUser.firstName}
                </Typography>
              )}
            </Box>
          </Box>

          <Search sx={{ display: { xs: 'none', lg: 'block' } }}>
            <SearchIconWrapper>
              <SearchIcon />
            </SearchIconWrapper>
            <StyledInputBase
              placeholder="Search students, courses..."
              slotProps={{ input: { 'aria-label': 'search' } }}
            />
          </Search>

          <Box sx={{ flexGrow: 1, minWidth: 0 }} />

          <IconButton
            color="inherit"
            size="small"
            sx={{ display: { xs: 'none', sm: 'flex' } }}
            aria-label="notifications"
            onClick={handleNotificationMenuOpen}
          >
            <Badge badgeContent={isAuthenticated ? unreadNotifications : 0} color="error">
              <NotificationsIcon />
            </Badge>
          </IconButton>

          <Tooltip title={mode === 'dark' ? 'Turn off dark background' : 'Turn on dark background'} arrow>
            <Box
              component="label"
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                color: 'common.white',
                cursor: 'pointer',
                borderRadius: 999,
                px: { xs: 0.25, sm: 0.75 },
                py: 0.25,
                bgcolor: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.14)',
              }}
            >
              {mode === 'dark' ? <Brightness7Icon fontSize="small" /> : <Brightness4Icon fontSize="small" />}
              <Typography variant="caption" sx={{ display: { xs: 'none', sm: 'block' }, fontWeight: 800 }}>
                Dark
              </Typography>
              <Switch
                checked={mode === 'dark'}
                onChange={onToggleColorMode}
                size="small"
                slotProps={{ input: { 'aria-label': 'toggle dark background' } }}
                sx={{
                  width: 40,
                  height: 24,
                  p: 0,
                  '& .MuiSwitch-switchBase': {
                    p: 0.35,
                    '&.Mui-checked': {
                      transform: 'translateX(16px)',
                      color: '#08223c',
                      '& + .MuiSwitch-track': {
                        bgcolor: '#f2d675',
                        opacity: 1,
                      },
                    },
                  },
                  '& .MuiSwitch-thumb': {
                    width: 17,
                    height: 17,
                  },
                  '& .MuiSwitch-track': {
                    borderRadius: 999,
                    bgcolor: 'rgba(255,255,255,0.28)',
                    opacity: 1,
                  },
                }}
              />
            </Box>
          </Tooltip>

          {isAuthenticated ? (
            <Button
              color="inherit"
              size="small"
              variant="outlined"
              onClick={handleProfileMenu}
              startIcon={<AccountCircleIcon />}
              sx={{
                borderColor: 'rgba(255,255,255,0.24)',
                color: 'common.white',
                textTransform: 'none',
                minWidth: 'auto',
                px: { xs: 1.25, sm: 1.5 },
                '&:hover': {
                  borderColor: 'rgba(255,255,255,0.4)',
                  bgcolor: 'rgba(255,255,255,0.12)',
                },
              }}
            >
              {currentUser?.firstName || 'Account'}
            </Button>
          ) : (
            <Button
              component={RouterLink}
              to="/login"
              color="inherit"
              size="small"
              variant="outlined"
              startIcon={<AccountCircleIcon />}
              sx={{
                borderColor: 'rgba(255,255,255,0.24)',
                color: 'common.white',
                textTransform: 'none',
                px: { xs: 1.25, sm: 1.5 },
                '&:hover': {
                  borderColor: 'rgba(255,255,255,0.4)',
                  bgcolor: 'rgba(255,255,255,0.12)',
                },
              }}
            >
              Login
            </Button>
          )}
        </Toolbar>
      </AppBar>

      <Menu
        anchorEl={notificationAnchor}
        id="notification-menu"
        open={notificationsOpen}
        onClose={handleNotificationMenuClose}
        slotProps={{
          paper: {
            elevation: 0,
            sx: {
              overflow: 'visible',
              filter: 'drop-shadow(0px 2px 8px rgba(0,0,0,0.32))',
              mt: 1.5,
              width: 360,
              maxHeight: 420,
              overflowY: 'auto',
            },
          },
        }}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
      >
        <Box sx={{ px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>Notifications</Typography>
          {notifications.some((item) => !item.readBy) && (
            <Button size="small" onClick={() => void handleAllNotificationsRead()}>Mark all read</Button>
          )}
        </Box>
        {!isAuthenticated ? (
          <MenuItem disabled>Sign in to view notifications.</MenuItem>
        ) : notifications.length === 0 ? (
          <MenuItem disabled>No notifications yet.</MenuItem>
        ) : (
          notifications.map((notification) => {
            const isRead = Boolean(notification.readBy);
            return (
              <MenuItem
                key={notification.id}
                onClick={() => handleNotificationRead(notification.id)}
                sx={{
                  display: 'block',
                  whiteSpace: 'normal',
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  opacity: isRead ? 0.7 : 1,
                  py: 1.25,
                }}
              >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, mb: 0.5 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    {notification.title}
                  </Typography>
                  {!isRead && (
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        bgcolor: 'error.main',
                        mt: 0.7,
                        flexShrink: 0,
                      }}
                    />
                  )}
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }}>
                  {notification.message}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                  {new Date(notification.createdAt).toLocaleString()}
                </Typography>
              </MenuItem>
            );
          })
        )}
      </Menu>

      <Menu
        anchorEl={profileAnchor}
        id="account-menu"
        open={profileOpen}
        onClose={handleProfileClose}
        onClick={handleProfileClose}
        slotProps={{
          paper: {
            elevation: 0,
            sx: {
              overflow: 'visible',
              filter: 'drop-shadow(0px 2px 8px rgba(0,0,0,0.32))',
              mt: 1.5,
            },
          },
        }}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
      >
        <MenuItem onClick={handleProfileClose}>
          <AccountCircleIcon sx={{ mr: 1 }} /> My Profile
        </MenuItem>
        <MenuItem onClick={handleProfileClose}>
          <SettingsIcon sx={{ mr: 1 }} /> Settings
        </MenuItem>
        <Divider />
        <MenuItem onClick={handleLogout}>
          Logout
        </MenuItem>
      </Menu>

      <Box component="nav" sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}>
        <Drawer
          container={container}
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{
            keepMounted: true,
          }}
          sx={{
            display: { xs: 'block', sm: 'none' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
          }}
        >
          {drawer}
        </Drawer>
        <Drawer
          variant="permanent"
          open
          sx={{
            display: { xs: 'none', sm: 'block' },
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: drawerWidth,
              borderRight: '1px solid rgba(18,53,91,0.08)',
            },
          }}
        >
          {drawer}
        </Drawer>
      </Box>

      <Box
        component="main"
        sx={{
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          overflowX: 'hidden',
          overflowY: 'auto',
          background:
            mode === 'dark'
              ? 'radial-gradient(circle at top left, rgba(31,95,139,0.18), transparent 34%), linear-gradient(180deg, #08111f 0%, #0f1c2d 100%)'
              : 'radial-gradient(circle at top left, rgba(197,155,45,0.15), transparent 32%), linear-gradient(180deg, #eef3f8 0%, #f7fafc 100%)',
        }}
      >
        <Toolbar sx={{ minHeight: { xs: 54, sm: 58 } }} />
        <Box sx={{ flex: 1, width: '100%', px: { xs: 1.5, sm: 3, lg: 4 }, py: { xs: 2, sm: 3 } }}>
          <Box sx={{ maxWidth: 1400, mx: 'auto' }}>{children}</Box>
        </Box>
        <Box
          component="footer"
          sx={{
            width: '100%',
            borderTop: '1px solid',
            borderColor: mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(76,29,149,0.14)',
            background:
              mode === 'dark'
                ? 'linear-gradient(135deg, #071021 0%, #111827 100%)'
                : 'linear-gradient(135deg, #ffffff 0%, #f5f3ff 100%)',
            color: 'text.primary',
          }}
        >
          <Box
            sx={{
              maxWidth: 1400,
              mx: 'auto',
              px: { xs: 2, sm: 3, lg: 4 },
              py: { xs: 1.25, sm: 1.5, md: 1.75 },
              display: 'grid',
              gridTemplateColumns: {
                xs: 'minmax(0, 1fr)',
                sm: '1.2fr 0.8fr 0.8fr',
                lg: 'minmax(280px, 1.5fr) minmax(170px, 0.75fr) minmax(140px, 0.65fr) minmax(260px, 1.1fr)',
              },
              gap: { xs: 1.25, sm: 1.5, md: 2 },
              alignItems: 'start',
            }}
          >
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, minWidth: 0 }}>
                <Logo size={28} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="subtitle2" sx={{ color: 'primary.main', fontWeight: 800, lineHeight: 1.15 }}>
                    Pinnacle University
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                    Where Ambition Meets Achievement
                  </Typography>
                </Box>
              </Box>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', maxWidth: { xs: '100%', lg: 360 }, lineHeight: 1.35 }}>
                Supporting students, teachers, courses, and campus planning from one simple school management app.
              </Typography>
            </Box>

            <Box>
              <Typography variant="caption" sx={{ mb: 0.5, fontWeight: 800, color: 'primary.main', lineHeight: 1.2, display: 'block' }}>
                Quick Links
              </Typography>
              <Box component="nav" sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                {visibleNavItems.slice(0, 5).map((item) => (
                  <Tooltip key={item.label} title={item.label}>
                    <IconButton
                      component={RouterLink}
                      to={item.to}
                      aria-label={item.description}
                      size="small"
                      sx={{
                        color: 'text.secondary',
                        bgcolor: mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(18,53,91,0.06)',
                        border: '1px solid',
                        borderColor: mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(18,53,91,0.08)',
                        '&:hover': {
                          color: 'primary.main',
                          bgcolor: mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(18,53,91,0.1)',
                        },
                        '& .MuiSvgIcon-root': {
                          fontSize: 19,
                        },
                      }}
                    >
                      {item.icon}
                    </IconButton>
                  </Tooltip>
                ))}
              </Box>
            </Box>

            <Box>
              <Typography variant="caption" sx={{ mb: 0.5, fontWeight: 800, color: 'primary.main', lineHeight: 1.2, display: 'block' }}>
                Support
              </Typography>
              <Box component="nav" sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                {supportLinks.map((item) => (
                  <Tooltip key={item.label} title={item.label}>
                    <IconButton
                      component={RouterLink}
                      to={item.to}
                      aria-label={item.label}
                      size="small"
                      sx={{
                        color: 'text.secondary',
                        bgcolor: mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(18,53,91,0.06)',
                        border: '1px solid',
                        borderColor: mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(18,53,91,0.08)',
                        '&:hover': {
                          color: 'primary.main',
                          bgcolor: mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(18,53,91,0.1)',
                        },
                        '& .MuiSvgIcon-root': {
                          fontSize: 19,
                        },
                      }}
                    >
                      {item.icon}
                    </IconButton>
                  </Tooltip>
                ))}
              </Box>
            </Box>

            <Box>
              <Typography variant="caption" sx={{ mb: 0.5, fontWeight: 800, color: 'primary.main', lineHeight: 1.2, display: 'block' }}>
                Contact
              </Typography>
              <Box sx={{ display: 'grid', gap: 0.4, color: 'text.secondary' }}>
                <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-start', minWidth: 0 }}>
                  <LocationOnIcon color="primary" sx={{ fontSize: 16 }} />
                  <Typography variant="caption" sx={{ overflowWrap: 'anywhere', lineHeight: 1.25 }}>Pinnacle Campus, Lagos, Nigeria</Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-start', minWidth: 0 }}>
                  <PhoneIcon color="primary" sx={{ fontSize: 16 }} />
                  <Typography variant="caption" sx={{ overflowWrap: 'anywhere', lineHeight: 1.25 }}>+234 800 000 0000</Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-start', minWidth: 0 }}>
                  <EmailIcon color="primary" sx={{ fontSize: 16 }} />
                  <Typography variant="caption" sx={{ overflowWrap: 'anywhere', lineHeight: 1.25 }}>info@pinnacleuniversity.edu</Typography>
                </Box>
              </Box>
            </Box>
          </Box>

          <Box
            sx={{
              borderTop: '1px solid',
              borderColor: mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(76,29,149,0.12)',
            }}
          >
            <Box
              sx={{
                maxWidth: 1400,
                mx: 'auto',
                px: { xs: 2, sm: 3, lg: 4 },
                py: 0.75,
                display: 'flex',
                flexDirection: { xs: 'column', sm: 'row' },
                gap: { xs: 0.5, sm: 1.5 },
                justifyContent: 'space-between',
                alignItems: { xs: 'flex-start', sm: 'center' },
              }}
            >
              <Typography variant="caption" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>
                Copyright {currentYear} Pinnacle University. All rights reserved.
              </Typography>
              <Box sx={{ display: 'flex', gap: { xs: 1.25, sm: 1.5 }, flexWrap: 'wrap' }}>
                <Link component={RouterLink} to="/settings" underline="hover" sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
                  Privacy
                </Link>
                <Link component={RouterLink} to="/settings" underline="hover" sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
                  Terms
                </Link>
                <Link component={RouterLink} to="/login" underline="hover" sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
                  Staff Login
                </Link>
              </Box>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
