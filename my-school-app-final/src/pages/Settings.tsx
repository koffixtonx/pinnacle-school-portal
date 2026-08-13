import React from 'react';
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Grid,
  Typography,
  TextField,
  Button,
  Switch,
  FormControlLabel,
  Avatar,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import PasswordIcon from '@mui/icons-material/Password';
import BugReportIcon from '@mui/icons-material/BugReport';
import HelpIcon from '@mui/icons-material/Help';

const Settings: React.FC = () => {
  const [editMode, setEditMode] = React.useState(false);
  const [passwordDialog, setPasswordDialog] = React.useState(false);
  const [formData, setFormData] = React.useState({
    fullName: 'Adeola Ogunleye',
    email: 'admin@pinnacleuniversity.edu',
    phone: '+234 803 000 1234',
    schoolName: 'Pinnacle University',
    position: 'Administrative Head',
  });

  const [settings, setSettings] = React.useState({
    emailNotifications: true,
    smsNotifications: false,
    announcements: true,
    weeklyReports: true,
    twoFactorAuth: false,
    darkMode: false,
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSettingChange = (key: keyof typeof settings) => {
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 3 }}>
        Settings
      </Typography>

      <Grid container spacing={3}>
        {/* Profile Section */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardHeader
              title="Profile Information"
              action={
                <IconButton
                  onClick={() => setEditMode(!editMode)}
                  color={editMode ? 'success' : 'primary'}
                  size="small"
                >
                  {editMode ? <SaveIcon /> : <EditIcon />}
                </IconButton>
              }
            />
            <Divider />
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
                <Avatar
                  sx={{ width: 100, height: 100, bgcolor: 'primary.main', background: 'linear-gradient(135deg, #08223c 0%, #1f5f8b 100%)' }}
                >
                  {formData.fullName.charAt(0)}
                </Avatar>
              </Box>

              <TextField
                fullWidth
                label="Full Name"
                name="fullName"
                value={formData.fullName}
                onChange={handleInputChange}
                disabled={!editMode}
                margin="normal"
                variant={editMode ? 'outlined' : 'filled'}
              />

              <TextField
                fullWidth
                label="Email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleInputChange}
                disabled={!editMode}
                margin="normal"
                variant={editMode ? 'outlined' : 'filled'}
              />

              <TextField
                fullWidth
                label="Phone"
                name="phone"
                value={formData.phone}
                onChange={handleInputChange}
                disabled={!editMode}
                margin="normal"
                variant={editMode ? 'outlined' : 'filled'}
              />

              <TextField
                fullWidth
                label="Position"
                name="position"
                value={formData.position}
                onChange={handleInputChange}
                disabled={!editMode}
                margin="normal"
                variant={editMode ? 'outlined' : 'filled'}
              />

              <TextField
                fullWidth
                label="School Name"
                name="schoolName"
                value={formData.schoolName}
                onChange={handleInputChange}
                disabled={!editMode}
                margin="normal"
                variant={editMode ? 'outlined' : 'filled'}
              />

              {editMode && (
                <Button
                  variant="contained"
                  fullWidth
                  sx={{ mt: 3 }}
                >
                  Save Changes
                </Button>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Security & Preferences */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardHeader title="Security & Preferences" />
            <Divider />
            <CardContent>
              <Box sx={{ mb: 3 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 2 }}>
                  Password & Security
                </Typography>
                <Button
                  variant="outlined"
                  startIcon={<PasswordIcon />}
                  fullWidth
                  onClick={() => setPasswordDialog(true)}
                  sx={{ mb: 1 }}
                >
                  Change Password
                </Button>
                <FormControlLabel
                  control={
                    <Switch
                      checked={settings.twoFactorAuth}
                      onChange={() => handleSettingChange('twoFactorAuth')}
                    />
                  }
                  label="Enable Two-Factor Authentication"
                />
              </Box>

              <Divider sx={{ my: 2 }} />

              <Box sx={{ mb: 3 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 2 }}>
                  Notifications
                </Typography>
                <FormControlLabel
                  control={
                    <Switch
                      checked={settings.emailNotifications}
                      onChange={() => handleSettingChange('emailNotifications')}
                    />
                  }
                  label="Email Notifications"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={settings.smsNotifications}
                      onChange={() => handleSettingChange('smsNotifications')}
                    />
                  }
                  label="SMS Notifications"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={settings.announcements}
                      onChange={() => handleSettingChange('announcements')}
                    />
                  }
                  label="Announcements"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={settings.weeklyReports}
                      onChange={() => handleSettingChange('weeklyReports')}
                    />
                  }
                  label="Weekly Reports"
                />
              </Box>

              <Divider sx={{ my: 2 }} />

              <FormControlLabel
                control={
                  <Switch
                    checked={settings.darkMode}
                    onChange={() => handleSettingChange('darkMode')}
                  />
                }
                label="Dark Mode (Coming Soon)"
              />
            </CardContent>
          </Card>
        </Grid>

        {/* Support & Help */}
        <Grid item xs={12}>
          <Card>
            <CardHeader title="Support & Help" />
            <Divider />
            <CardContent>
              <List>
                <ListItem disablePadding>
                  <ListItemButton sx={{ borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}>
                    <ListItemIcon>
                      <HelpIcon color="primary" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Help Center"
                      secondary="Get answers to common questions"
                    />
                  </ListItemButton>
                </ListItem>
                <ListItem disablePadding>
                  <ListItemButton sx={{ borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}>
                    <ListItemIcon>
                      <BugReportIcon color="warning" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Report an Issue"
                      secondary="Help us improve by reporting bugs"
                    />
                  </ListItemButton>
                </ListItem>
                <ListItem disablePadding>
                  <ListItemButton sx={{ borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}>
                    <ListItemIcon>
                      <PasswordIcon color="info" />
                    </ListItemIcon>
                    <ListItemText
                      primary="API Documentation"
                      secondary="Integrate with your applications"
                    />
                  </ListItemButton>
                </ListItem>
              </List>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Password Change Dialog */}
      <Dialog open={passwordDialog} onClose={() => setPasswordDialog(false)}>
        <DialogTitle>Change Password</DialogTitle>
        <DialogContent sx={{ minWidth: 400 }}>
          <TextField
            fullWidth
            label="Current Password"
            type="password"
            margin="normal"
          />
          <TextField
            fullWidth
            label="New Password"
            type="password"
            margin="normal"
          />
          <TextField
            fullWidth
            label="Confirm Password"
            type="password"
            margin="normal"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPasswordDialog(false)}>Cancel</Button>
          <Button
            onClick={() => setPasswordDialog(false)}
            variant="contained"
            color="secondary"
            sx={{ color: '#08223c' }}
          >
            Update Password
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Settings;
