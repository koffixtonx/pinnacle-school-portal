import React from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  TextField,
  Typography,
} from '@mui/material';
import { authService, mfaService } from '../services/api.service';

/**
 * The second half of signing in for an account that has an authenticator
 * attached. App.tsx renders this in place of the whole portal until the code
 * matches, so there is no route to type your way past it.
 */
type Props = {
  onVerified: () => void;
};

const VerifyTotp: React.FC<Props> = ({ onVerified }) => {
  const [factorId, setFactorId] = React.useState<string | null>(null);
  const [code, setCode] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const status = await mfaService.status();
        if (cancelled) return;
        if (!status.data.data.enrolled) {
          // Nothing to prove - the gate was opened by a stale check.
          onVerified();
          return;
        }
        setFactorId(status.data.data.factorId);
      } catch (err: any) {
        if (!cancelled) setError(err?.response?.data?.message || 'Two-factor is unavailable right now.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [onVerified]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!factorId) return;
    setError('');
    setSubmitting(true);
    try {
      await mfaService.confirm(factorId, code);
      onVerified();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'That code did not match. Check your app and try again.');
      setCode('');
    } finally {
      setSubmitting(false);
    }
  };

  const signOut = async () => {
    try {
      await authService.logout();
    } catch (err) {
      console.error('Logout failed', err);
    } finally {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('user');
      globalThis.dispatchEvent(new Event('pinnacle-auth-change'));
    }
  };

  return (
    <Container maxWidth="sm">
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100dvh', py: 4 }}>
        <Card sx={{ width: '100%', boxShadow: 3 }}>
          <CardContent sx={{ p: 4 }}>
            <Typography variant="h5" sx={{ fontWeight: 700, mb: 1, textAlign: 'center' }}>
              Confirm it is you
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3, textAlign: 'center' }}>
              Enter the 6-digit code from your authenticator app to open the portal.
            </Typography>

            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                <CircularProgress size={26} />
              </Box>
            ) : (
              <>
                {error && (
                  <Alert severity="error" sx={{ mb: 2 }} role="alert">
                    {error}
                  </Alert>
                )}

                <Box component="form" onSubmit={handleSubmit} noValidate>
                  <TextField
                    autoFocus
                    fullWidth
                    label="6-digit code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    disabled={submitting}
                    margin="normal"
                  />
                  <Button
                    type="submit"
                    variant="contained"
                    size="large"
                    fullWidth
                    sx={{ mt: 3, mb: 2 }}
                    disabled={submitting || !factorId || code.replace(/\D/g, '').length !== 6}
                  >
                    {submitting ? <CircularProgress size={24} /> : 'Verify and continue'}
                  </Button>
                </Box>
              </>
            )}

            <Typography variant="body2" sx={{ textAlign: 'center', mt: 2 }} color="text.secondary">
              No longer have the app? An administrator can remove the authenticator from your
              account in Supabase. &nbsp;
              <Button size="small" color="inherit" onClick={() => void signOut()}>
                Sign out
              </Button>
            </Typography>
          </CardContent>
        </Card>
      </Box>
    </Container>
  );
};

export default VerifyTotp;
