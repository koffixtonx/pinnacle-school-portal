import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { faker } from '@faker-js/faker';

const prisma = new PrismaClient();

const GRADE_LEVELS = ['JSS1', 'JSS2', 'JSS3', 'SS1', 'SS2', 'SS3'];
const NIGERIAN_FIRST_NAMES = ['Chinedu', 'Amina', 'Tunde', 'Ngozi', 'Emeka', 'Zainab', 'Oluwaseun', 'Ifeoma', 'Yusuf', 'Adaeze', 'Musa', 'Folake'];
const NIGERIAN_LAST_NAMES = ['Okafor', 'Bello', 'Adeyemi', 'Eze', 'Ibrahim', 'Balogun', 'Nwosu', 'Abubakar', 'Ogunleye', 'Obi', 'Sani', 'Adebayo'];

function nigerianName(index: number) {
  return {
    firstName: NIGERIAN_FIRST_NAMES[index % NIGERIAN_FIRST_NAMES.length],
    lastName: NIGERIAN_LAST_NAMES[index % NIGERIAN_LAST_NAMES.length],
  };
}

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'pinnacle-school' },
    update: {},
    create: { name: 'Pinnacle School', slug: 'pinnacle-school', status: 'ACTIVE' },
  });

  // create core admin
  const adminPasswordHash = await bcrypt.hash('AdminPass!234', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@pinnacle.school' },
    update: {
      tenantId: tenant.id,
      passwordHash: adminPasswordHash,
      role: 'SUPER_ADMIN',
      firstName: 'Chinedu',
      lastName: 'Okafor',
      active: true,
    },
    create: { tenantId: tenant.id, email: 'admin@pinnacle.school', passwordHash: adminPasswordHash, role: 'SUPER_ADMIN', firstName: 'Chinedu', lastName: 'Okafor', active: true },
  });

  const demoTeacher = await prisma.user.upsert({
    where: { email: 'teacher@pinnacle.school' },
    update: {
      tenantId: tenant.id,
      passwordHash: await bcrypt.hash('TeacherPass!234', 12),
      role: 'TEACHER',
      firstName: 'Amina',
      lastName: 'Bello',
      active: true,
    },
    create: {
      tenantId: tenant.id,
      email: 'teacher@pinnacle.school',
      passwordHash: await bcrypt.hash('TeacherPass!234', 12),
      role: 'TEACHER',
      firstName: 'Amina',
      lastName: 'Bello',
      active: true
    }
  });

  const demoStudent = await prisma.user.upsert({
    where: { email: 'student@pinnacle.school' },
    update: {
      tenantId: tenant.id,
      passwordHash: await bcrypt.hash('StudentPass!234', 12),
      role: 'STUDENT',
      firstName: 'Tunde',
      lastName: 'Adeyemi',
      active: true,
    },
    create: {
      tenantId: tenant.id,
      email: 'student@pinnacle.school',
      passwordHash: await bcrypt.hash('StudentPass!234', 12),
      role: 'STUDENT',
      firstName: 'Tunde',
      lastName: 'Adeyemi',
      active: true
    }
  });

  // teachers
  const teachers: any[] = [demoTeacher];
  for (let i = 1; i <= 12; i++) {
    const email = `teacher${i}@pinnacle.test`;
    const name = nigerianName(i + 2);
    const user = await prisma.user.upsert({ where: { email }, update: { ...name }, create: { tenantId: tenant.id, email, passwordHash: await bcrypt.hash('TeacherPass!234', 12), role: 'TEACHER', ...name, active: true } });
    teachers.push(user);
  }

  // non-academic staff
  const staff: any[] = [];
  for (let i = 1; i <= 8; i++) {
    const email = `staff${i}@pinnacle.test`;
    const name = nigerianName(i + 14);
    const user = await prisma.user.upsert({
      where: { email },
      update: {
        tenantId: tenant.id,
        passwordHash: await bcrypt.hash('StaffPass!234', 12),
        role: 'NON_ACADEMIC_STAFF',
        ...name,
        active: true,
      },
      create: { tenantId: tenant.id, email, passwordHash: await bcrypt.hash('StaffPass!234', 12), role: 'NON_ACADEMIC_STAFF', ...name, active: true },
    });
    staff.push(user);
  }

  // classes
  const classSections: any[] = [];
  for (const grade of GRADE_LEVELS) {
    for (let s = 1; s <= 3; s++) {
      const name = `${grade}-${String.fromCharCode(64 + s)}`;
      const homeroomTeacher = teachers[randInt(0, teachers.length - 1)];
      const cs = await prisma.classSection.upsert({ where: { tenantId_name: { tenantId: tenant.id, name } }, update: {}, create: { tenantId: tenant.id, name, grade, homeroomTeacherId: homeroomTeacher.id } });
      classSections.push(cs);
    }
  }

  // courses
  const departments = ['Mathematics', 'English', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Computer Science'];
  const courses: any[] = [];
  for (let i = 1; i <= 30; i++) {
    const dept = departments[i % departments.length];
    const code = `${dept.slice(0,3).toUpperCase()}${100 + i}`;
    const teacher = teachers[randInt(0, teachers.length - 1)];
    let c = await prisma.course.findFirst({ where: { tenantId: tenant.id, departmentId: null, code } });
    if (!c) {
      c = await prisma.course.create({ data: { tenantId: tenant.id, title: `${dept} ${i}`, code, description: `Introductory ${dept} course`, teachers: { connect: { id: teacher.id } } } });
    }
    courses.push(c);
  }

  // students
  const students: any[] = [{ user: demoStudent, classSection: classSections[0] }];
  for (let i = 1; i <= 120; i++) {
    const { firstName, lastName } = nigerianName(i + 22);
    const email = `stu${i}@pinnacle.test`;
    const classSection = classSections[randInt(0, classSections.length - 1)];
    const user = await prisma.user.upsert({ where: { email }, update: { firstName, lastName }, create: { tenantId: tenant.id, email, passwordHash: await bcrypt.hash('StudentPass!234', 12), role: 'STUDENT', firstName, lastName, active: true } });
    await prisma.classSection.update({ where: { id: classSection.id }, data: { students: { connect: { id: user.id } } } });
    students.push({ user, classSection });
  }

  // enrollments - 4 courses each
  for (const s of students) {
    const chosen = new Set<number>();
    while (chosen.size < 4) chosen.add(randInt(0, courses.length - 1));
    for (const idx of chosen) {
      const course = courses[idx];
      await prisma.enrollment.upsert({ where: { studentId_courseId: { studentId: s.user.id, courseId: course.id } }, update: {}, create: { tenantId: tenant.id, studentId: s.user.id, courseId: course.id, status: 'ACTIVE' } });
    }
  }

  // fee structures
  const feeStructures: any[] = [];
  for (const grade of GRADE_LEVELS) {
    const amount = Math.round(5000 + Math.random() * 5000);
    let fs = await prisma.feeStructure.findFirst({ where: { tenantId: tenant.id, name: `${grade} Tuition` } });
    if (!fs) {
      fs = await prisma.feeStructure.create({ data: { tenantId: tenant.id, name: `${grade} Tuition`, amount: amount.toString(), frequency: 'ANNUAL', active: true } });
    }
    feeStructures.push({ grade, fs });
  }

  // invoices/payments
  let invoiceCount = 0;
  for (const s of students) {
    const grade = s.classSection.grade;
    const fs = feeStructures.find((f) => f.grade === grade)?.fs ?? feeStructures[0].fs;
    const totalAmount = Number((fs.amount as any));
    const invoice = await prisma.invoice.create({ data: { tenantId: tenant.id, studentId: s.user.id, issuedById: admin.id, status: 'ISSUED', dueDate: faker.date.soon(60), totalAmount: totalAmount.toString(), paidAmount: (Math.random() > 0.3 ? (totalAmount * 0.7).toFixed(2) : '0.00'), reference: `INV-${Date.now()}-${++invoiceCount}`, lines: { create: [{ description: `${grade} annual tuition`, amount: totalAmount.toString() }] } } });
    if (Math.random() > 0.3) {
      await prisma.payment.create({ data: { tenantId: tenant.id, invoiceId: invoice.id, studentId: s.user.id, amount: (Number(invoice.paidAmount)).toString(), method: 'CARD' } });
    }
  }

  // timetable
  const periodStarts = [ '08:30', '09:40', '10:50', '12:00', '13:30', '14:40' ];
  for (const cs of classSections) {
    for (let day = 1; day <= 5; day++) {
      for (let p = 0; p < periodStarts.length; p++) {
        const start = periodStarts[p];
        const [h, m] = start.split(':').map(Number);
        const startsAt = new Date();
        startsAt.setHours(h, m, 0, 0);
        const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
        const course = courses[randInt(0, courses.length - 1)];
        const teacher = teachers[randInt(0, teachers.length - 1)];
        const exists = await prisma.timetableSlot.findFirst({ where: { tenantId: tenant.id, classSectionId: cs.id, dayOfWeek: day, startsAt } });
        if (!exists) {
          await prisma.timetableSlot.create({ data: { tenantId: tenant.id, courseId: course.id, classSectionId: cs.id, teacherId: teacher.id, dayOfWeek: day, startsAt, endsAt, room: `R-${randInt(100,299)}` } });
        }
      }
    }
  }

  // attendance
  for (const s of students.slice(0, 200)) {
    await prisma.attendanceRecord.create({ data: { tenantId: tenant.id, studentId: s.user.id, classSectionId: s.classSection.id, status: Math.random() > 0.1 ? 'Present' : 'Absent', recordedAt: faker.date.recent(30) } });
  }

  // site settings
  await prisma.siteSettings.upsert({ where: { tenantId: tenant.id }, update: {}, create: { tenantId: tenant.id, logoPath: null, heroImagePath: null, primaryColor: '#1976D2', secondaryColor: '#DC004E', widgetConfig: JSON.stringify({ announcements: true, calendar: true, quickLinks: true }) } });

  console.log('Seed summary:', { teachers: teachers.length, staff: staff.length, students: students.length, courses: courses.length, classes: classSections.length });
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
