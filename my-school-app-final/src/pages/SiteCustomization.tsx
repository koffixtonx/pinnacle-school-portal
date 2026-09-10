import React from 'react';
import { Alert, Avatar, Box, Button, Card, CardContent, CardHeader, FormControlLabel, Grid, IconButton, Stack, Switch, TextField, Typography } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import { siteSettingsService } from '../services/api.service';
import { useCurrentUser } from '../hooks/useCurrentUser';

interface WidgetConfig { announcements: boolean; calendar: boolean; quickLinks: boolean; }
interface SiteSettings { logoPath?: string | null; heroImagePath?: string | null; primaryColor?: string | null; secondaryColor?: string | null; widgetConfig?: Partial<WidgetConfig> | null; }

const defaultWidgets: WidgetConfig = { announcements: true, calendar: true, quickLinks: true };
const cardSx = { borderRadius: 3, boxShadow: '0 12px 30px rgba(15, 23, 42, 0.10)', height: '100%' };
const uploadButtonSx = { px: 2, py: 1, borderRadius: 2, color: 'common.white', bgcolor: 'primary.main', '&:hover': { bgcolor: 'primary.dark' } };

const getAssetUrl = (path: string) => {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ? String(import.meta.env.VITE_API_BASE_URL).replace(/\/api$/, '') : 'http://localhost:5000';
  return path.startsWith('/uploads') ? `${apiBaseUrl}${path}` : path;
};

const SiteCustomization: React.FC = () => {
  const currentUser = useCurrentUser();
  const [loading, setLoading] = React.useState(true);
  const [settings, setSettings] = React.useState<SiteSettings>({});
  const [logoFile, setLogoFile] = React.useState<File | null>(null);
  const [heroFile, setHeroFile] = React.useState<File | null>(null);
  const [logoPreview, setLogoPreview] = React.useState<string | null>(null);
  const [heroPreview, setHeroPreview] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState('');
  const [error, setError] = React.useState('');
  const [welcomeMessage, setWelcomeMessage] = React.useState<string | null>(null);
  const [welcomeMessageColor, setWelcomeMessageColor] = React.useState('#FFFFFF');
  const [welcomeDraft, setWelcomeDraft] = React.useState('');
  const [editingWelcome, setEditingWelcome] = React.useState(false);
  const [savingWelcome, setSavingWelcome] = React.useState(false);
  const [backgroundImages, setBackgroundImages] = React.useState<string[]>([]);

  React.useEffect(() => {
    let mounted = true;
    siteSettingsService.get().then((response) => { if (mounted) setSettings(response.data.data ?? {}); }).catch(() => { if (mounted) setError('Unable to load site settings.'); }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  React.useEffect(() => {
    siteSettingsService.getWelcomeBackgrounds().then((response) => setBackgroundImages(response.data.data.images ?? [])).catch(() => undefined);
  }, []);

  React.useEffect(() => {
    let mounted = true;
    siteSettingsService.getWelcomeMessage().then((response) => {
      if (mounted) {
        setWelcomeMessage(response.data.data.welcomeMessage);
        setWelcomeMessageColor(response.data.data.welcomeMessageColor ?? '#FFFFFF');
      }
    }).catch(() => {
      if (mounted) setError('Unable to load the welcome message.');
    });
    return () => { mounted = false; };
  }, []);

  React.useEffect(() => {
    if (!logoFile) return undefined;
    const url = URL.createObjectURL(logoFile); setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile]);

  React.useEffect(() => {
    if (!heroFile) return undefined;
    const url = URL.createObjectURL(heroFile); setHeroPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [heroFile]);

  const updateWidget = (key: keyof WidgetConfig, checked: boolean) => setSettings((current) => ({ ...current, widgetConfig: { ...defaultWidgets, ...current.widgetConfig, [key]: checked } }));

  const handleSave = async () => {
    const formData = new FormData();
    if (logoFile) formData.append('logo', logoFile);
    if (heroFile) formData.append('hero', heroFile);
    formData.append('primaryColor', settings.primaryColor ?? '#1976D2');
    formData.append('secondaryColor', settings.secondaryColor ?? '#DC004E');
    formData.append('widgetConfig', JSON.stringify({ ...defaultWidgets, ...settings.widgetConfig }));
    try {
      const response = await siteSettingsService.update(formData);
      const updated = response.data.data as SiteSettings;
      window.dispatchEvent(new CustomEvent('site-settings-updated', { detail: updated }));
      setSettings(updated); setLogoFile(null); setHeroFile(null); setLogoPreview(null); setHeroPreview(null); setSuccess('Site customization saved.');
    } catch { setError('Unable to save site customization.'); }
  };

  const saveWelcomeMessage = async () => {
    try {
      setSavingWelcome(true);
      const response = await siteSettingsService.updateWelcomeMessage(welcomeDraft, welcomeMessageColor);
      setWelcomeMessage(response.data.data.welcomeMessage);
      setWelcomeMessageColor(response.data.data.welcomeMessageColor);
      setEditingWelcome(false);
      setSuccess('Welcome message saved.');
    } catch {
      setError('Unable to save the welcome message.');
    } finally {
      setSavingWelcome(false);
    }
  };

  const startWelcomeEdit = () => {
    setWelcomeDraft(welcomeMessage ?? 'Welcome, Admin');
    setEditingWelcome(true);
  };

  const updateWelcomeBackgrounds = async (files?: FileList, removePath?: string) => {
    const formData = new FormData();
    if (files) Array.from(files).forEach((file) => formData.append('images', file));
    if (removePath) formData.append('removePaths', JSON.stringify([removePath]));
    try {
      const response = await siteSettingsService.updateWelcomeBackgrounds(formData);
      setBackgroundImages(response.data.data.images);
      setSuccess('Welcome page background updated.');
    } catch (requestError: unknown) {
      const message = requestError && typeof requestError === 'object' && 'response' in requestError ? (requestError as { response?: { data?: { message?: string } } }).response?.data?.message : undefined;
      setError(message ?? 'Unable to update the welcome page background.');
    }
  };

  const primaryColor = settings.primaryColor ?? '#1976D2';
  const secondaryColor = settings.secondaryColor ?? '#DC004E';
  const logoSource = logoPreview ?? (settings.logoPath ? getAssetUrl(settings.logoPath) : undefined);
  const heroSource = heroPreview ?? (settings.heroImagePath ? getAssetUrl(settings.heroImagePath) : undefined);
  const canEditWelcome = currentUser?.role === 'SUPER_ADMIN';
  if (loading) return <Typography>Loading…</Typography>;

  return <Box>
    <Typography variant="h4" sx={{ mb: 3, fontWeight: 700 }}>Site Customization</Typography>
    {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
    {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}
    <Grid container spacing={3}>
      <Grid xs={12} md={6}><Card sx={cardSx}><CardHeader title="Branding" sx={{ px: 3, pt: 3 }} /><CardContent sx={{ px: 3, pb: 3 }}><Stack spacing={3}>
        <Box><Typography variant="subtitle2" sx={{ mb: 1 }}>Logo (recommended 200x200px)</Typography><Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'flex-start', sm: 'center' }}><Avatar variant="rounded" src={logoSource} sx={{ width: 128, height: 128, bgcolor: 'background.default', border: '1px solid', borderColor: 'divider' }} /><Button component="label" variant="contained" sx={uploadButtonSx}>Upload Logo<input hidden type="file" accept="image/*" onChange={(event) => setLogoFile(event.target.files?.[0] ?? null)} /></Button></Stack></Box>
        <Box><Typography variant="subtitle2" sx={{ mb: 1 }}>Hero Image (recommended 1600x400px)</Typography><Box sx={{ aspectRatio: '4 / 1', overflow: 'hidden', borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'background.default', mb: 1.5 }}>{heroSource ? <Box component="img" src={heroSource} alt="Hero preview" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Typography color="text.secondary" sx={{ height: '100%', display: 'grid', placeItems: 'center' }}>Hero image preview</Typography>}</Box><Button component="label" variant="contained" sx={uploadButtonSx}>Upload Hero<input hidden type="file" accept="image/*" onChange={(event) => setHeroFile(event.target.files?.[0] ?? null)} /></Button></Box>
      </Stack></CardContent></Card></Grid>
      <Grid xs={12} md={6}><Card sx={cardSx}><CardHeader title="Theme Colors" sx={{ px: 3, pt: 3 }} /><CardContent sx={{ px: 3, pb: 3 }}><Stack spacing={4}>
        <Box><Stack direction="row" spacing={3} sx={{ mb: 2 }}><Box><TextField type="color" value={primaryColor} onChange={(event) => setSettings((current) => ({ ...current, primaryColor: event.target.value }))} inputProps={{ 'aria-label': 'Primary Color' }} sx={{ width: 84, '& input': { height: 50, p: 0.5 } }} /><Typography variant="body2" sx={{ mt: 0.75 }}>Primary Color</Typography></Box><Box><TextField type="color" value={secondaryColor} onChange={(event) => setSettings((current) => ({ ...current, secondaryColor: event.target.value }))} inputProps={{ 'aria-label': 'Secondary Color' }} sx={{ width: 84, '& input': { height: 50, p: 0.5 } }} /><Typography variant="body2" sx={{ mt: 0.75 }}>Secondary Color</Typography></Box></Stack><Box aria-label="Theme color preview" sx={{ height: 34, borderRadius: 2, display: 'grid', gridTemplateColumns: '1fr 1fr', overflow: 'hidden', border: '1px solid', borderColor: 'divider' }}><Box sx={{ bgcolor: primaryColor }} /><Box sx={{ bgcolor: secondaryColor }} /></Box></Box>
        <Box><Typography variant="subtitle2" sx={{ mb: 1.5 }}>Dashboard Widgets</Typography><Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>Visible on Dashboard</Typography><Stack spacing={1.25}>{Object.keys(defaultWidgets).map((key) => <FormControlLabel key={key} sx={{ m: 0, gap: 1 }} control={<Switch checked={settings.widgetConfig?.[key as keyof WidgetConfig] ?? true} onChange={(event) => updateWidget(key as keyof WidgetConfig, event.target.checked)} />} label={key === 'quickLinks' ? 'Quick Links' : `${key.charAt(0).toUpperCase()}${key.slice(1)}`} />)}</Stack></Box>
        <Button variant="contained" onClick={() => void handleSave()} sx={{ alignSelf: { xs: 'stretch', sm: 'flex-start' }, width: { xs: '100%', sm: 150 } }}>Save Changes</Button>
      </Stack></CardContent></Card></Grid>
      <Grid xs={12}><Card sx={cardSx}><CardHeader title="Dashboard Welcome Message" sx={{ px: 3, pt: 3 }} action={canEditWelcome && !editingWelcome ? <IconButton aria-label="Edit welcome message" onClick={startWelcomeEdit}><EditIcon /></IconButton> : undefined} /><CardContent sx={{ px: 3, pb: 3 }}>
        {editingWelcome ? <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}><TextField id="welcome-message-input" fullWidth size="small" label="Welcome message" value={welcomeDraft} onChange={(event) => setWelcomeDraft(event.target.value)} slotProps={{ htmlInput: { maxLength: 160, 'aria-label': 'Welcome message' } }} /><Box><TextField type="color" id="welcome-message-color" value={welcomeMessageColor} onChange={(event) => setWelcomeMessageColor(event.target.value)} inputProps={{ 'aria-label': 'Welcome message color' }} sx={{ width: 72, '& input': { height: 38, p: 0.5 } }} /><Typography variant="caption" display="block">Text color</Typography></Box><Stack direction="row" spacing={1}><Button variant="contained" onClick={() => void saveWelcomeMessage()} disabled={savingWelcome}>Save</Button><Button variant="outlined" onClick={() => setEditingWelcome(false)}>Cancel</Button></Stack></Stack> : <Typography variant="h6" sx={{ fontWeight: 700, color: welcomeMessageColor }}>{welcomeMessage || 'Welcome, Admin'}</Typography>}
        {!canEditWelcome && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Only Super Admins can edit this message.</Typography>}
      </CardContent></Card></Grid>
      <Grid xs={12}><Card sx={cardSx}><CardHeader title="Welcome Page Background" sx={{ px: 3, pt: 3 }} /><CardContent sx={{ px: 3, pb: 3 }}><Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">Add up to 8 images. They fade between one another on the Welcome page.</Typography>
        <Stack direction="row" spacing={1.5} flexWrap="wrap">{backgroundImages.map((image) => <Box key={image} sx={{ position: 'relative', width: 148, height: 84, borderRadius: 1.5, overflow: 'hidden', border: '1px solid', borderColor: 'divider' }}><Box component="img" src={getAssetUrl(image)} alt="Welcome background" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />{canEditWelcome && <IconButton aria-label="Remove background image" size="small" onClick={() => void updateWelcomeBackgrounds(undefined, image)} sx={{ position: 'absolute', top: 4, right: 4, bgcolor: 'rgba(15,23,42,0.72)', color: 'common.white', '&:hover': { bgcolor: 'rgba(15,23,42,0.9)' } }}>×</IconButton>}</Box>)}</Stack>
        {canEditWelcome && <Button component="label" variant="contained" sx={{ alignSelf: 'flex-start' }} disabled={backgroundImages.length >= 8}>Add Background Images<input hidden type="file" accept="image/*" multiple onChange={(event) => { if (event.target.files?.length) void updateWelcomeBackgrounds(event.target.files); event.target.value = ''; }} /></Button>}
        {!canEditWelcome && <Typography variant="body2" color="text.secondary">Only Super Admins can manage background images.</Typography>}
      </Stack></CardContent></Card></Grid>
    </Grid>
  </Box>;
};

export default SiteCustomization;
