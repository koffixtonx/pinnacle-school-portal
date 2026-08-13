import React from 'react';
import { Box, Typography, Grid, Card, CardHeader, CardContent, TextField, Button, Avatar, FormControlLabel, Switch } from '@mui/material';
import { siteSettingsService } from '../services/api.service';

const SiteCustomization: React.FC = () => {
  const [loading, setLoading] = React.useState(true);
  const [settings, setSettings] = React.useState<any>(null);
  const [logoFile, setLogoFile] = React.useState<File | null>(null);
  const [heroFile, setHeroFile] = React.useState<File | null>(null);
  const [logoPreview, setLogoPreview] = React.useState<string | null>(null);
  const [heroPreview, setHeroPreview] = React.useState<string | null>(null);

  React.useEffect(() => {
    let mounted = true;
    siteSettingsService.get().then((res) => {
      if (!mounted) return;
      setSettings(res.data.data);
      setLoading(false);
    }).catch(() => setLoading(false));
    return () => { mounted = false; };
  }, []);

  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ? String(import.meta.env.VITE_API_BASE_URL).replace(/\/api$/, '') : 'http://localhost:5000';
  const resolveAssetUrl = (path: string) => {
    if (!path) return path;
    return path.startsWith('/uploads') ? `${apiBaseUrl}${path}` : path;
  };

  React.useEffect(() => {
    // create previews when new files are selected
    if (logoFile) {
      const url = URL.createObjectURL(logoFile);
      setLogoPreview(url);
      return () => URL.revokeObjectURL(url);
    }
    setLogoPreview(null);
  }, [logoFile]);

  React.useEffect(() => {
    if (heroFile) {
      const url = URL.createObjectURL(heroFile);
      setHeroPreview(url);
      return () => URL.revokeObjectURL(url);
    }
    setHeroPreview(null);
  }, [heroFile]);

  const handleSave = async () => {
    const fd = new FormData();
    if (logoFile) fd.append('logo', logoFile);
    if (heroFile) fd.append('hero', heroFile);
    if (settings?.primaryColor) fd.append('primaryColor', settings.primaryColor);
    if (settings?.secondaryColor) fd.append('secondaryColor', settings.secondaryColor);
    if (settings?.widgetConfig) fd.append('widgetConfig', JSON.stringify(settings.widgetConfig));
    const res = await siteSettingsService.update(fd);
    const updated = res.data.data;
    // notify app to re-theme and update UI without reload
    window.dispatchEvent(new CustomEvent('site-settings-updated', { detail: updated }));
    setSettings(updated);
    // clear previews after saving
    setLogoFile(null);
    setHeroFile(null);
    setLogoPreview(null);
    setHeroPreview(null);
    window.alert('Saved');
  };

  if (loading) return <Typography>Loading…</Typography>;

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3, fontWeight: 700 }}>Site Customization</Typography>
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardHeader title="Branding" />
            <CardContent>
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2 }}>
                {logoPreview ? (
                  <img src={logoPreview} alt="logo-preview" style={{ width: 80, height: 80, objectFit: 'contain', borderRadius: 6 }} />
                ) : (
                  <Avatar src={settings?.logoPath ? resolveAssetUrl(settings.logoPath) : undefined} sx={{ width: 80, height: 80 }} />
                )}
                <Button variant="outlined" component="label">Upload Logo<input hidden type="file" accept="image/*" onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)} /></Button>
              </Box>

              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2">Hero Image</Typography>
                {heroPreview ? (
                  <img src={heroPreview} alt="hero-preview" style={{ maxWidth: '100%', marginBottom: 8 }} />
                ) : (
                  settings?.heroImagePath && <img src={resolveAssetUrl(settings.heroImagePath)} alt="hero" style={{ maxWidth: '100%', marginBottom: 8 }} />
                )}
                <Button variant="outlined" component="label">Upload Hero<input hidden type="file" accept="image/*" onChange={(e) => setHeroFile(e.target.files?.[0] ?? null)} /></Button>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card>
            <CardHeader title="Theme Colors" />
            <CardContent>
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2 }}>
                <TextField type="color" label="Primary" value={settings?.primaryColor ?? '#1976D2'} onChange={(e) => setSettings((s: any) => ({ ...s, primaryColor: e.target.value }))} />
                <TextField type="color" label="Secondary" value={settings?.secondaryColor ?? '#DC004E'} onChange={(e) => setSettings((s: any) => ({ ...s, secondaryColor: e.target.value }))} />
              </Box>

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Dashboard Widgets</Typography>
                <FormControlLabel control={<Switch checked={settings?.widgetConfig?.announcements ?? true} onChange={(e) => setSettings((s: any) => ({ ...s, widgetConfig: { ...s.widgetConfig, announcements: e.target.checked } }))} />} label="Announcements" />
                <FormControlLabel control={<Switch checked={settings?.widgetConfig?.calendar ?? true} onChange={(e) => setSettings((s: any) => ({ ...s, widgetConfig: { ...s.widgetConfig, calendar: e.target.checked } }))} />} label="Calendar" />
                <FormControlLabel control={<Switch checked={settings?.widgetConfig?.quickLinks ?? true} onChange={(e) => setSettings((s: any) => ({ ...s, widgetConfig: { ...s.widgetConfig, quickLinks: e.target.checked } }))} />} label="Quick Links" />
              </Box>

              <Box sx={{ mt: 2 }}>
                <Button variant="contained" onClick={handleSave}>Save</Button>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default SiteCustomization;
