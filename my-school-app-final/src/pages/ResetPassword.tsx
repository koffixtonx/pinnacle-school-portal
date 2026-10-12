import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
import { authService } from '../services/api.service';

/**
 * The second half of a password reset. Supabase's link carries a single-use PKCE
 * `code`, which this client exchanges by hand because `detectSessionInUrl` is
 * off for the whole app.
 */
const ResetPassword: React.FC = () => {
  const [params] = useSearchParams();
  const code = useMemo(() => params.get('code') ?? '', [params]);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await authService.completePasswordReset(password, code || undefined);
      setDone(true);
      // The app reads the session through supabase-js, so an already-open tab
      // picks the new session up on its own; this only refreshes this tab.
      window.dispatchEvent(new Event('pinnacle-auth-change'));
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Your password could not be changed. Request a new reset link.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="sm">
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 'calc(100dvh - 72px)', py: 4 }}>
        <Card sx={{ width: '100%', boxShadow: 3 }}>
          <CardContent sx={{ p: 4 }}>
            <Typography variant="h4" sx={{ fontWeight: 700, mb: 1, textAlign: 'center' }}>
              Choose a new password
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3, textAlign: 'center' }}>
              At least 8 characters. You will stay signed in on this device afterwards.
            </Typography>

            {error && (
              <Alert severity="error" sx={{ mb: 2 }} role="alert">
                {error}
              </Alert>
            )}

            {!code && !done && (
              <Alert severity="info" sx={{ mb: 2 }}>
                You reached this page without a reset link. Open the link from your email, or
                request another one.
              </Alert>
            )}

            {done ? (
              <Alert severity="success" sx={{ mb: 2 }} role="status">
                Your password has been changed.{' '}
                <Link to="/login" style={{ color: '#1976d2' }}>
                  Sign in
                </Link>{' '}
                with the new one.
              </Alert>
            ) : (
              <Box component="form" onSubmit={handleSubmit} noValidate>
                <TextField
                  label="New password"
                  type="password"
                  fullWidth
                  margin="normal"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  disabled={loading}
                  autoComplete="new-password"
                />
                <TextField
                  label="Confirm new password"
                  type="password"
                  fullWidth
                  margin="normal"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  required
                  disabled={loading}
                  autoComplete="new-password"
                />
                <Button type="submit" variant="contained" size="large" fullWidth sx={{ mt: 3, mb: 2 }} disabled={loading}>
                  {loading ? <CircularProgress size={24} /> : 'Change password'}
                </Button>
              </Box>
            )}

            <Typography variant="body2" sx={{ textAlign: 'center', mt: 2 }}>
              Remembered it?{' '}
              <Link to="/login" style={{ color: '#1976d2', textDecoration: 'none' }}>
                Back to sign in
              </Link>
            </Typography>
          </CardContent>
        </Card>
      </Box>
    </Container>
  );
};

export default ResetPassword;
