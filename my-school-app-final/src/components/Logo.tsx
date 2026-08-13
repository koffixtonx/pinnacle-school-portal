import Box from '@mui/material/Box';
import pinnacleLogo from '../assets/pinnacle-logo.png';

interface LogoProps {
  size?: number;
}

const Logo: React.FC<LogoProps> = ({ size = 46 }) => (
  <Box
    component="img"
    src={pinnacleLogo}
    alt="Pinnacle University"
    sx={{
      width: size,
      height: size,
      display: 'block',
      objectFit: 'contain',
      flexShrink: 0,
    }}
  />
);

export default Logo;
