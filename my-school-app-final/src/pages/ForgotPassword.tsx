import React, { useState } from 'react';
import { Link } from 'react-router-dom';
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
 * Asks Supabase to email a reset link. The answer is deliberately the same
 * whether the address has an account here or not, so this page cannot be used
 * to find out who is enrolled.
 */
const ForgotPassword: React.FC = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await authService.requestPasswordReset(email);
      setSent(true);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'The reset email could not be sent. Please try again.');
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
              Forgotten password
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3, textAlign: 'center' }}>
              Tell us the address you signed up with and we will send a reset link.
            </Typography>

            {error && (
              <Alert severity="error" sx={{ mb: 2 }} role="alert">
                {error}
              </Alert>
            )}

            {sent ? (
              <Alert severity="success" sx={{ mb: 2 }} role="status">
                Check your inbox for a reset link. It expires within an hour. If nothing arrives,
                the address may not have an account here.
              </Alert>
            ) : (
              <Box component="form" onSubmit={handleSubmit} noValidate>
                <TextField
                  label="Email address"
                  type="email"
                  fullWidth
                  margin="normal"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  disabled={loading}
                  autoComplete="email"
                />
                <Button type="submit" variant="contained" size="large" fullWidth sx={{ mt: 3, mb: 2 }} disabled={loading}>
                  {loading ? <CircularProgress size={24} /> : 'Send reset link'}
                </Button>
              </Box>
            )}

            <Typography variant="body2" sx={{ textAlign: 'center', mt: 2 }}>
              Remembered it?{' '}
              <Link to="/login" style={{ color: '#1976d2', textDecoration: 'none' }}>
                Sign in
              </Link>
            </Typography>
          </CardContent>
        </Card>
      </Box>
    </Container>
  );
};

export default ForgotPassword;
