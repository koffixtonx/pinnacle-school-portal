import React from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  TextField,
  Typography,
} from '@mui/material';
import ShieldIcon from '@mui/icons-material/Shield';
import { mfaService } from '../services/api.service';

type MfaStatus = { enrolled: boolean; awaitingConfirmation: boolean; factorId: string | null };
type MfaEnrolment = { factorId: string; secret: string; qrCode: string };

/**
 * Two-factor authentication for the signed-in account. The factor lives in
 * GoTrue and nowhere in the portal's tables, so this card only ever reports what
 * the auth server agrees to.
 *
 * An enrolment is not usable until a code from the app has been confirmed, which
 * is why the setup step ends with a verification rather than a saved flag.
 */
const TwoFactorCard: React.FC = () => {
  const [status, setStatus] = React.useState<MfaStatus | null>(null);
  const [enrolment, setEnrolment] = React.useState<MfaEnrolment | null>(null);
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');

  const loadStatus = React.useCallback(async () => {
    try {
      const response = await mfaService.status();
      setStatus(response.data.data);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Two-factor status is unavailable.');
      setStatus({ enrolled: false, awaitingConfirmation: false, factorId: null });
    }
  }, []);

  React.useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const startEnrolment = async () => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const response = await mfaService.enrol();
      setEnrolment(response.data.data);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Two-factor could not be set up. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const confirmEnrolment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!enrolment) return;
    setError('');
    setBusy(true);
    try {
      await mfaService.confirm(enrolment.factorId, code);
      setEnrolment(null);
      setCode('');
      setNotice('Two-factor is on. You will be asked for a code each time you sign in.');
      await loadStatus();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'That code did not match. Check your app and try again.');
    } finally {
      setBusy(false);
    }
  };

  const cancelEnrolment = () => {
    setEnrolment(null);
    setCode('');
    setError('');
  };

  const disable = async () => {
    if (!status?.factorId) return;
    setError('');
    setBusy(true);
    try {
      await mfaService.disable(status.factorId);
      setNotice('Two-factor has been turned off for this account.');
      await loadStatus();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Two-factor could not be turned off.');
    } finally {
      setBusy(false);
    }
  };

  if (!status) {
    return <CircularProgress size={22} />;
  }

  return (
    <Box>
      {error && (
        <Alert severity="error" sx={{ mb: 1 }} role="alert">
          {error}
        </Alert>
      )}
      {notice && (
        <Alert severity="success" sx={{ mb: 1 }} role="status">
          {notice}
        </Alert>
      )}

      {enrolment ? (
        <Box component="form" onSubmit={confirmEnrolment}>
          <Typography variant="body2" sx={{ mb: 1 }}>
            Scan this code with Google Authenticator, Authy or 1Password, then enter the 6-digit
            code it shows to finish.
          </Typography>
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
            {/* Supabase hands back the QR as SVG markup; the data: prefix is what turns
                it into something an <img> can draw. */}
            <Box
              component="img"
              alt="Two-factor setup QR code"
              src={enrolment.qrCode.startsWith('data:') ? enrolment.qrCode : `data:image/svg+xml;utf-8,${enrolment.qrCode}`}
              sx={{ width: 180, height: 180, bgcolor: 'common.white' }}
            />
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, wordBreak: 'break-all' }}>
            Cannot scan it? Type this key into your app instead: {enrolment.secret}
          </Typography>
          <TextField
            autoFocus
            fullWidth
            label="6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            disabled={busy}
            margin="normal"
          />
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button type="submit" variant="contained" disabled={busy || code.replace(/\D/g, '').length !== 6}>
              {busy ? <CircularProgress size={20} /> : 'Confirm and turn on'}
            </Button>
            <Button onClick={cancelEnrolment} disabled={busy} color="inherit">
              Cancel
            </Button>
          </Box>
        </Box>
      ) : status.enrolled ? (
        <Box>
          <Alert severity="success" sx={{ mb: 1 }}>
            Two-factor authentication is on for this account.
          </Alert>
          <Button variant="outlined" color="error" onClick={() => void disable()} disabled={busy}>
            {busy ? <CircularProgress size={20} /> : 'Turn off two-factor'}
          </Button>
        </Box>
      ) : (
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {status.awaitingConfirmation
              ? 'A setup was started but never confirmed, so it is not protecting this account yet.'
              : 'Add an authenticator app so a stolen password alone cannot open your account.'}
          </Typography>
          <Button variant="outlined" startIcon={<ShieldIcon />} onClick={() => void startEnrolment()} disabled={busy}>
            {busy ? <CircularProgress size={20} /> : 'Set up two-factor'}
          </Button>
        </Box>
      )}
    </Box>
  );
};

export default TwoFactorCard;
