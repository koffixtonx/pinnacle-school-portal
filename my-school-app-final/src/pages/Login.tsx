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
} from '@mui/material';
import { authService } from '../services/api.service';

// Seeded demo accounts from backend/prisma/seed.ts. These are real accounts with
// real passwords in the database; "quick login" still goes through the normal
// /auth/login endpoint, it just fills the form for you. Only shown in local
// development builds (import.meta.env.DEV) so it never ships to production -
// a real deployment holding student records must never offer a no-password
// way to sign in as a privileged role.
const DEMO_ACCOUNTS: { label: string; role: string; email: string; password: string }[] = [
  { label: 'Super Admin', role: 'SUPER_ADMIN', email: 'admin@pinnacle.school', password: 'AdminPass!234' },
  { label: 'Teacher', role: 'TEACHER', email: 'teacher@pinnacle.school', password: 'TeacherPass!234' },
  { label: 'Student', role: 'STUDENT', email: 'student@pinnacle.school', password: 'StudentPass!234' },
];

const Login: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [quickLoginRole, setQuickLoginRole] = useState<string | null>(null);

  const performLogin = async (loginEmail: string, loginPassword: string) => {
    setError('');
    setLoading(true);
    try {
      const response = await authService.login(loginEmail, loginPassword);
      const { user, accessToken } = response.data;

      // The refresh token is set as an httpOnly cookie by the server and is
      // never exposed to JS - only the short-lived access token is stored here.
      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('user', JSON.stringify(user));
      window.dispatchEvent(new Event('pinnacle-auth-change'));

      // Redirect based on role
      if (user.role === 'SUPER_ADMIN' || user.role === 'SCHOOL_ADMIN') {
        navigate('/dashboard');
      } else {
        navigate('/');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
      setQuickLoginRole(null);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    await performLogin(email, password);
  };

  const handleQuickLogin = async (account: (typeof DEMO_ACCOUNTS)[number]) => {
    setQuickLoginRole(account.role);
    await performLogin(account.email, account.password);
  };

  return (
    <Container maxWidth="sm">
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 'calc(100vh - 72px)', py: 4 }}>
        <Card sx={{ width: '100%', boxShadow: 3 }}>
          <CardContent sx={{ p: 4 }}>
            <Typography variant="h4" sx={{ fontWeight: 700, mb: 1, textAlign: 'center' }}>
              Welcome Back
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3, textAlign: 'center' }}>
              Sign in to your Pinnacle University account
            </Typography>

            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}

            <Box component="form" onSubmit={handleLogin} noValidate>
              <TextField
                label="Email Address"
                type="email"
                fullWidth
                margin="normal"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
              <TextField
                label="Password"
                type="password"
                fullWidth
                margin="normal"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
              />
              <Button
                type="submit"
                variant="contained"
                size="large"
                fullWidth
                sx={{ mt: 3, mb: 2 }}
                disabled={loading}
              >
                {loading ? <CircularProgress size={24} /> : 'Sign In'}
              </Button>

              <Typography variant="body2" sx={{ textAlign: 'center', mt: 2 }}>
                Don't have an account?{' '}
                <Link to="/register" style={{ color: '#1976d2', textDecoration: 'none' }}>
                  Sign Up
                </Link>
              </Typography>
            </Box>

            {import.meta.env.DEV && (
              <Box sx={{ mt: 3 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mb: 1 }}>
                  Development only - sign in as a seeded demo account
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
                  {DEMO_ACCOUNTS.map((account) => (
                    <Button
                      key={account.role}
                      size="small"
                      variant="outlined"
                      disabled={loading}
                      onClick={() => handleQuickLogin(account)}
                    >
                      {loading && quickLoginRole === account.role ? (
                        <CircularProgress size={16} sx={{ mr: 1 }} />
                      ) : null}
                      {account.label}
                    </Button>
                  ))}
                </Box>
              </Box>
            )}
          </CardContent>
        </Card>
      </Box>
    </Container>
  );
};

export default Login;
