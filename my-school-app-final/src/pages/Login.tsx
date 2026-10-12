import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
  Alert,
  CircularProgress,
  Container,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import { authService } from '../services/api.service';

const Login: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Matric numbers are issued by the registry, so this is a second way to reach
  // the same account, not a second kind of account.
  const [useMatric, setUseMatric] = useState(false);
  const [matric, setMatric] = useState('');
  const [surname, setSurname] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = useMatric
        ? await authService.loginByMatric(matric, surname, password)
        : await authService.login(email, password);
      const { user, accessToken } = response.data;

      // supabase-js keeps and refreshes the session itself; this copy is only
      // what App.tsx reads to decide whether to render the signed-in shell.
      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('user', JSON.stringify(user));
      window.dispatchEvent(new Event('pinnacle-auth-change'));

      // Land on the welcome page; the role-specific dashboards stay reachable
      // from its quick links rather than being used as a post-login redirect.
      // An account with an authenticator is stopped at the two-factor gate first.
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Login failed. Please try again.');
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
              Welcome Back
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3, textAlign: 'center' }}>
              Sign in to your Pinnacle University account
            </Typography>

            {error && (
              <Alert severity="error" sx={{ mb: 2 }} role="alert">
                {error}
              </Alert>
            )}

            <ToggleButtonGroup
              value={useMatric ? 'matric' : 'email'}
              exclusive
              onChange={(_event, next) => {
                if (next) setUseMatric(next === 'matric');
              }}
              size="small"
              fullWidth
              sx={{ mb: 2 }}
            >
              <ToggleButton value="email">Email</ToggleButton>
              <ToggleButton value="matric">Matric number</ToggleButton>
            </ToggleButtonGroup>

            <Box component="form" onSubmit={handleLogin} noValidate>
              {useMatric ? (
                <>
                  <TextField
                    label="Matric number"
                    fullWidth
                    margin="normal"
                    value={matric}
                    onChange={(e) => setMatric(e.target.value)}
                    required
                    disabled={loading}
                    placeholder="PIN/2026/0042"
                    autoComplete="username"
                  />
                  <TextField
                    label="Surname"
                    fullWidth
                    margin="normal"
                    value={surname}
                    onChange={(e) => setSurname(e.target.value)}
                    required
                    disabled={loading}
                    autoComplete="family-name"
                  />
                </>
              ) : (
                <TextField
                  label="Email Address"
                  type="email"
                  fullWidth
                  margin="normal"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                  autoComplete="email"
                />
              )}
              <TextField
                label="Password"
                type="password"
                fullWidth
                margin="normal"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
                autoComplete="current-password"
              />
              <Button
                type="submit"
                variant="contained"
                size="large"
                fullWidth
                sx={{ mt: 3, mb: 1 }}
                disabled={loading}
              >
                {loading ? <CircularProgress size={24} /> : 'Sign In'}
              </Button>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2">
                  Don't have an account?{' '}
                  <Link to="/register" style={{ color: '#1976d2', textDecoration: 'none' }}>
                    Sign Up
                  </Link>
                </Typography>
                <Typography variant="body2">
                  <Link to="/forgot-password" style={{ color: '#1976d2', textDecoration: 'none' }}>
                    Forgotten password?
                  </Link>
                </Typography>
              </Box>
            </Box>
          </CardContent>
        </Card>
      </Box>
    </Container>
  );
};

export default Login;
