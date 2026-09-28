import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function snapshot(email: string) {
  const student = await prisma.user.findUnique({
    where: { email },
    include: {
      studentInvoices: { include: { lines: true, payments: true } },
      enrollments: { include: { course: true } },
      classSections: true,
      attendanceRecords: true,
    },
  });
  console.log(JSON.stringify(student, null, 2));
}

const email = process.argv[2] || 'stu1@pinnacle.test';
snapshot(email).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
