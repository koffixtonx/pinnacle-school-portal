# Quick Start Guide - Pinnacle University School Portal

## ⚡ Quick Setup (5 Minutes)

### Step 1: Install Backend Dependencies
```bash
cd backend
npm install
```

### Step 2: Install Frontend Dependencies
```bash
cd ..
npm install
```

### Step 3: Start MongoDB
**Local Setup:**
```bash
# Make sure MongoDB is running
mongod
```

**Or use MongoDB Atlas (Cloud):**
- Create account at mongodb.com/cloud/atlas
- Get connection string
- Update `MONGODB_URI` in `backend/.env`

### Step 4: Start Backend
```bash
cd backend
npm run dev
# Server runs on http://localhost:5000
```

### Step 5: Start Frontend (New Terminal)
```bash
cd my-school-app
npm run dev
# App opens at http://localhost:5173
```

## 📝 First Time User Flow

1. **Register as Admin** - First registration creates Admin account
   - Go to http://localhost:5173/register
   - Fill in your details
   - You're now Admin!

2. **Admin Dashboard** - Access at `/dashboard`
   - Manage your profile
   - Edit homepage slides and content
   - View all users and change their roles

3. **Invite Users**
   - Share registration link
   - They register as Students by default
   - You can change their role in admin dashboard

## 🔑 Environmental Variables

**Backend (.env)**
```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/pinnacle-school
JWT_SECRET=change-this-to-random-string
JWT_REFRESH_SECRET=change-this-to-another-random-string
CLIENT_URL=http://localhost:5173
NODE_ENV=development
```

**Frontend (.env)**
```env
VITE_API_BASE_URL=http://localhost:5000/api
```

## 🎯 API Testing Quick Reference

### Register
```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "password": "password123"
  }'
```

### Login
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "password123"
  }'
```

### Get Homepage Content
```bash
curl http://localhost:5000/api/home
```

### Get Admin Profile (Requires token)
```bash
curl http://localhost:5000/api/home/admin/profile \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## 🛠️ Common Commands

**Backend Development:**
```bash
cd backend
npm run dev      # Start with hot reload
npm start        # Start production
```

**Frontend Development:**
```bash
npm run dev      # Start Vite dev server
npm run build    # Build for production
npm run preview  # Preview production build
npm run lint     # Run ESLint
```

## 📚 Project Features

### ✅ Completed
- [x] User registration & JWT authentication
- [x] Role-based access control (RBAC)
- [x] Admin dashboard
- [x] Homepage content management
- [x] User management
- [x] Protected routes
- [x] Dark/Light mode

### 🚀 Ready to Add
- [ ] Email verification
- [ ] Password reset
- [ ] File uploads for profile photos
- [ ] Real-time notifications
- [ ] Student grades/marks system
- [ ] Course enrollment
- [ ] Attendance tracking

## 🔐 Security Checklist

- [x] Passwords hashed with bcryptjs
- [x] JWT tokens with expiration
- [x] Protected admin routes
- [x] CORS configured
- [x] Environment variables for secrets
- [ ] Input validation (can add express-validator)
- [ ] Rate limiting (can add express-rate-limit)
- [ ] HTTPS in production

## 🐛 Troubleshooting

### Port Already in Use
```bash
# Kill process on port 5000
lsof -ti:5000 | xargs kill -9

# Or change port in backend/.env and frontend/.env
```

### MongoDB Connection Failed
```bash
# Check MongoDB is running
mongosh

# Or verify connection string in .env
mongodb://localhost:27017/pinnacle-school
```

### CORS Errors
- Verify `CLIENT_URL` matches frontend URL
- Check backend .env has correct `CLIENT_URL`

### Can't Login
- Clear localStorage: `localStorage.clear()` in browser console
- Verify backend is running
- Check `.env` values match

## 📞 Support

- Check README.md for detailed documentation
- Review API endpoints in backend routes
- Check browser console for errors
- Check backend terminal for server errors

## 🎉 You're All Set!

Your full-stack MERN school portal is ready to use. Start building amazing features!

---
**Happy Coding! 🚀**
