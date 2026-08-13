import { createTheme } from '@mui/material/styles';

export default function getTheme(mode: 'light' | 'dark' = 'light', overrides?: { primary?: string; secondary?: string }) {
  const isDark = mode === 'dark';
  const primaryMain = overrides?.primary ?? '#12355b';
  const secondaryMain = overrides?.secondary ?? '#c59b2d';

  return createTheme({
    palette: {
      mode,
      primary: {
        main: primaryMain,
        light: primaryMain,
        dark: primaryMain,
      },
      secondary: {
        main: secondaryMain,
        light: secondaryMain,
        dark: secondaryMain,
      },
      success: {
        main: '#0f9f6e',
        light: '#a7f3d0',
        dark: '#06734f',
      },
      background: {
        default: isDark ? '#08111f' : '#eef3f8',
        paper: isDark ? '#0f1c2d' : '#ffffff',
      },
      text: {
        primary: isDark ? '#edf5ff' : '#142033',
        secondary: isDark ? '#a8b9cf' : '#5b6b80',
      },
    },
    shape: {
      borderRadius: 12,
    },
    typography: {
      fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      h4: {
        fontWeight: 800,
        fontSize: '1.875rem',
        letterSpacing: 0,
      },
      h5: {
        fontWeight: 800,
        fontSize: '1.25rem',
        letterSpacing: 0,
      },
      h6: {
        fontWeight: 700,
        fontSize: '1rem',
        letterSpacing: 0,
      },
    },
    components: {
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: 700,
            borderRadius: 8,
            boxShadow: 'none',
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            border: isDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(18,53,91,0.1)',
            boxShadow: isDark ? '0 18px 50px rgba(0,0,0,0.28)' : '0 18px 45px rgba(18,53,91,0.08)',
            '&:hover': {
              boxShadow: isDark ? '0 22px 60px rgba(0,0,0,0.34)' : '0 22px 55px rgba(18,53,91,0.12)',
            },
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
          },
        },
      },
      MuiTableHead: {
        styleOverrides: {
          root: {
            backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#f5f8fb',
          },
        },
      },
      MuiTextField: {
        defaultProps: {
          variant: 'outlined',
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#ffffff',
          },
        },
      },
    },
  });
}
