# Pinnacle University School Portal

A comprehensive full-stack school management portal using Node.js, Express, React, and Prisma with role-based access control, admin dashboard, and homepage management.

## Features

### Backend
- **REST API** built with Node.js and Express.js
- **SQL database** managed through Prisma ORM (local SQLite in development, PostgreSQL/MySQL recommended for production)
- **JWT Authentication** with access and refresh tokens
- **Role-Based Access Control** (RBAC) - Student, Lecturer, Staff, Admin
- **User Management** - registration, login, profile management
- **Admin Panel** - manage homepage content (slides and text) and user roles
- **Secure Password Hashing** with bcryptjs
- **CORS** configured for frontend

### Frontend
- **React 19** with TypeScript and Vite
- **Material-UI (MUI)** for professional design
- **React Router** for client-side navigation
- **Axios** with interceptors for API calls
- **Protected Routes** based on user roles
- **Responsive Design** for all devices
- **Dark/Light Mode** toggle
- **Admin Dashboard** with:
  - Admin profile management
  - Homepage content editor (slides and welcome text)
  - User management table
  - Role assignment controls

## Project Structure

```
my-school-app/
├── backend/                    # Express.js backend
│   ├── src/
│   │   ├── app.ts             # Express app setup
│   │   ├── server.ts          # Server entry point
│   │   ├── prisma.ts          # Prisma client setup
│   │   ├── types/             # Type augmentations
│   │   │   └── express.d.ts    # Custom request auth typing
│   │   ├── middleware/        # Auth and error handling
│   │   │   ├── authMiddleware.ts
│   │   │   └── errorHandler.ts
│   │   ├── controllers/       # API controller logic
│   │   │   ├── authController.ts
│   │   │   ├── adminController.ts
│   │   │   └── ...
│   ├── prisma/                # Prisma schema and seed scripts
│   │   ├── schema.prisma
│   │   └── seed.ts
│   ├── .env                   # Environment variables
│   ├── .env.example           # Example env file
│   └── package.json
│
├── src/                       # React frontend
│   ├── pages/
│   │   ├── Login.tsx          # Login page
│   │   ├── Register.tsx       # Registration page
│   │   ├── Home.tsx           # Home page
│   │   ├── AdminDashboard.tsx # Admin dashboard
│   │   └── ...
│   ├── components/
│   │   ├── DrawerAppBar.tsx
│   │   ├── Logo.tsx
│   │   └── ...
│   ├── services/
│   │   ├── api.ts             # Axios instance
│   │   └── api.service.ts     # API service
│   ├── context/
│   │   └── ...
│   ├── App.tsx                # Main app component
│   └── main.tsx               # Entry point
│
├── .env                       # Frontend env
├── .env.example               # Example frontend env
├── package.json               # Frontend dependencies
├── vite.config.ts             # Vite configuration
└── README.md
```

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- A SQL database (local SQLite is configured for development; PostgreSQL/MySQL is recommended for production)

## Installation

### 1. Clone and Setup Backend

```bash
cd my-school-app/backend
npm install
```

Create `.env` file in backend directory:
```env
PORT=5000
DATABASE_URL=file:./dev.db
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_REFRESH_SECRET=your-super-secret-refresh-key-change-this
CLIENT_URL=http://localhost:5173
DEFAULT_TENANT_SLUG=pinnacle-school
NODE_ENV=development
```

Run database setup and seed initial authentication users:
```bash
cd my-school-app/backend
npm run db:setup
```

For production, use a managed SQL database such as PostgreSQL or MySQL and set `DATABASE_URL` accordingly:
```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public
```

### 2. Setup Frontend

```bash
cd my-school-app
npm install
```

The `.env` file is already set up with:
```env
VITE_API_BASE_URL=http://localhost:5000/api
```

## Running the Application

### Start Backend Server

```bash
cd backend
npm run dev
```

The backend will start on `http://localhost:5000`

### Start Frontend Development Server

```bash
npm run dev
```

The frontend will start on `http://localhost:5173`

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Logout user

### Homepage
- `GET /api/home` - Get public homepage content
- `GET /api/home/admin/homepage` - Get homepage content (admin only)
- `PUT /api/home/admin/homepage` - Update homepage content (admin only)
- `GET /api/home/admin/profile` - Get admin profile (admin only)
- `PUT /api/home/admin/profile` - Update admin profile (admin only)

### User Management (Admin Only)
- `GET /api/home/admin/users` - Get all users
- `PUT /api/home/admin/users/:id/role` - Update user role
- `DELETE /api/home/admin/users/:id` - Delete user

### Health Check
- `GET /api/health` - Backend health status

## User Roles and Permissions

### Student
- View homepage
- View own profile
- Access student-specific features

### Lecturer
- View homepage
- Manage assigned courses
- Update profile

### Staff
- View homepage
- Manage administrative tasks
- Update profile

### Admin
- Full access to all features
- Manage users (create, read, update, delete)
- Edit homepage content
- Edit admin profile
- Manage user roles

## Authentication Flow

1. User registers/logs in with email and password
2. Backend returns `accessToken` (15 minutes) and `refreshToken` (7 days)
3. Tokens stored in localStorage
4. API requests include `Authorization: Bearer <accessToken>` header
5. When access token expires, refresh token is used to get new token
6. If refresh token expires, user must login again

## Axios Interceptors

The frontend automatically:
- Adds authorization header to all requests
- Refreshes token when access token expires
- Redirects to login if refresh token is invalid

## First Time Setup

1. First user registration creates an Admin account
2. Subsequent registrations create Student accounts (default)
3. Admin can change user roles from the admin dashboard
4. Admins can add slides and update homepage content

## Building for Production

### Backend
```bash
cd backend
npm install --production
# Set production environment variables
NODE_ENV=production npm start
```

### Frontend
```bash
npm run build
npm run preview
```

## Deployment

### Backend Deployment (Heroku, Railway, etc.)
- Set environment variables in the platform dashboard: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CLIENT_URL`, `NODE_ENV=production`
- Use a managed SQL database (PostgreSQL/MySQL) in production instead of SQLite
- Push code to platform and run `npm install --production` or the provider's build step

See `HOSTING.md` for more detailed backend and frontend hosting steps.

### Frontend Deployment (Vercel, Netlify, etc.)
- Set `VITE_API_BASE_URL` to the production API URL
- Push code to platform
- Platform automatically runs `npm run build`

## Hosting and production setup
- Host backend on a Node-capable service such as Railway, Render, Fly.io, or a VPS.
- Use a managed SQL database, then set `DATABASE_URL` for the production database.
- Set the following production environment variables:
  - `DATABASE_URL`
  - `JWT_SECRET`
  - `JWT_REFRESH_SECRET`
  - `CLIENT_URL` (frontend origin)
  - `NODE_ENV=production`
- Build the frontend with `npm run build` and deploy the static output to Vercel, Netlify, or any static hosting provider.
- If using a platform that supports separate backend and frontend deployments, point the frontend `VITE_API_BASE_URL` to the backend URL.

## Development Notes

### Adding New Routes
1. Create controller in `backend/src/controllers/`
2. Add route in `backend/src/routes/`
3. Import and use in `app.ts`

### Adding New API Services
1. Add method to `src/services/api.service.ts`
2. Use in React components with try-catch

### Database Schema Changes
Update the Prisma schema in `backend/prisma/schema.prisma` and run `npm run db:setup`.

## Troubleshooting

### Backend won't connect to the database
- Verify the `DATABASE_URL` environment variable is set correctly
- Check network/firewall settings for your database host
- Use a managed SQL database or ensure SQLite file permissions allow writes

### Frontend API calls returning 401
- Check if access token is in localStorage
- Clear localStorage and login again
- Verify JWT secrets match between backend and token

### CORS errors
- Check `CLIENT_URL` in backend .env
- Ensure frontend URL matches CORS origin

## Security Best Practices

- [x] JWT secrets stored in .env (never commit)
- [x] Passwords hashed with bcryptjs
- [x] Protected routes require authentication
- [x] Admin routes verify role
- [x] Refresh tokens expire after 7 days
- [x] Access tokens expire after 15 minutes
- [ ] (Recommended) Add rate limiting
- [ ] (Recommended) Add HTTPS in production
- [ ] (Recommended) Add input validation on all endpoints

## Support & Contributing

For issues or improvements, please create an issue or submit a PR.

## License

MIT License - feel free to use this for your projects!

---

**Made with ❤️ for Pinnacle University**

import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
