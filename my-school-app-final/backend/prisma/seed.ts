import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'pinnacle-school' },
    update: {},
    create: {
      name: 'Pinnacle School',
      slug: 'pinnacle-school',
      status: 'ACTIVE',
    },
  });

  const adminPassword = await bcrypt.hash('AdminPass!234', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@pinnacle.school' },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'admin@pinnacle.school',
      passwordHash: adminPassword,
      role: 'SUPER_ADMIN',
      firstName: 'Admin',
      lastName: 'Pinnacle',
      active: true,
    },
  });

  const teacherPassword = await bcrypt.hash('TeacherPass!234', 12);
  const teacher = await prisma.user.upsert({
    where: { email: 'teacher@pinnacle.school' },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'teacher@pinnacle.school',
      passwordHash: teacherPassword,
      role: 'TEACHER',
      firstName: 'Jordan',
      lastName: 'Smith',
      active: true,
    },
  });

  const studentPassword = await bcrypt.hash('StudentPass!234', 12);
  const student = await prisma.user.upsert({
    where: { email: 'student@pinnacle.school' },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'student@pinnacle.school',
      passwordHash: studentPassword,
      role: 'STUDENT',
      firstName: 'Avery',
      lastName: 'Lee',
      active: true,
    },
  });

  const course = await prisma.course.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'MATH101' } },
    update: {},
    create: {
      tenantId: tenant.id,
      title: 'Foundations of Mathematics',
      code: 'MATH101',
      description: 'Core math concepts for middle school learners.',
      teachers: { connect: { id: teacher.id } },
    },
  });

  const classSection = await prisma.classSection.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: '7A' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: '7A',
      grade: '7',
      homeroomTeacherId: teacher.id,
    },
  });

  await prisma.enrollment.upsert({
    where: { studentId_courseId: { studentId: student.id, courseId: course.id } },
    update: {},
    create: {
      tenantId: tenant.id,
      studentId: student.id,
      courseId: course.id,
      status: 'ACTIVE',
    },
  });
  // Create a timetable slot if it doesn't already exist (avoid complex compound upsert)
  const existingSlot = await prisma.timetableSlot.findFirst({
    where: {
      tenantId: tenant.id,
      courseId: course.id,
      classSectionId: classSection.id,
      dayOfWeek: 1,
      startsAt: new Date('2026-09-01T08:00:00.000Z'),
      endsAt: new Date('2026-09-01T09:00:00.000Z'),
    },
  });

  if (!existingSlot) {
    await prisma.timetableSlot.create({
      data: {
        tenantId: tenant.id,
        courseId: course.id,
        classSectionId: classSection.id,
        teacherId: teacher.id,
        dayOfWeek: 1,
        startsAt: new Date('2026-09-01T08:00:00.000Z'),
        endsAt: new Date('2026-09-01T09:00:00.000Z'),
        room: 'B201',
      },
    });
  }

  // Create default site settings for the tenant
  await prisma.siteSettings.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: {
      tenantId: tenant.id,
      logoPath: null,
      heroImagePath: null,
      primaryColor: '#1976D2',
      secondaryColor: '#DC004E',
      widgetConfig: JSON.stringify({ announcements: true, calendar: true, quickLinks: true }),
    },
  });

  const demoPasswordPlain = 'DemoPass!234';
  const demoPassword = await bcrypt.hash(demoPasswordPlain, 12);
  const demoUsers = [
    { email: 'superadmin1@pinnacle.test', role: 'SUPER_ADMIN', firstName: 'Super', lastName: 'Admin1' },
    { email: 'superadmin2@pinnacle.test', role: 'SUPER_ADMIN', firstName: 'Super', lastName: 'Admin2' },
    { email: 'teacher1@pinnacle.test', role: 'TEACHER', firstName: 'Teacher', lastName: 'One' },
    { email: 'teacher2@pinnacle.test', role: 'TEACHER', firstName: 'Teacher', lastName: 'Two' },
    { email: 'student1@pinnacle.test', role: 'STUDENT', firstName: 'Student', lastName: 'One' },
    { email: 'student2@pinnacle.test', role: 'STUDENT', firstName: 'Student', lastName: 'Two' },
    { email: 'staff1@pinnacle.test', role: 'NON_ACADEMIC_STAFF', firstName: 'Staff', lastName: 'One' },
    { email: 'staff2@pinnacle.test', role: 'NON_ACADEMIC_STAFF', firstName: 'Staff', lastName: 'Two' },
  ];

  const createdDemo = [];
  for (const u of demoUsers) {
    const res = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        tenantId: tenant.id,
        email: u.email,
        passwordHash: demoPassword,
        role: u.role,
        firstName: u.firstName,
        lastName: u.lastName,
        active: true,
      },
    });
    createdDemo.push({ email: u.email, password: demoPasswordPlain, role: u.role });
  }

  console.log('Seed data created: tenant id=', tenant.id);
  console.log('Pre-existing accounts:', { admin: admin.email, teacher: teacher.email, student: student.email });
  console.log('Demo credentials (email / password):');
  for (const d of createdDemo) console.log(`${d.email} / ${d.password}  (${d.role})`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
