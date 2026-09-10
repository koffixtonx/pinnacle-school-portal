import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';

const prisma = new PrismaClient();

type SeedCourse = {
  code: string;
  title: string;
  creditUnits: number;
  level: number;
  semester: number;
  elective?: boolean;
};

type SeedDepartment = {
  name: string;
  confidence: 'confirmed' | 'reference' | 'unresearched';
  source?: string;
  courses: SeedCourse[];
};

type SeedFaculty = { name: string; departments: SeedDepartment[] };
type SeedData = { faculties: SeedFaculty[] };

function departmentCode(facultyIndex: number, departmentIndex: number) {
  return `UNIJOS-${String(facultyIndex + 1).padStart(2, '0')}-${String(departmentIndex + 1).padStart(2, '0')}`;
}

async function main() {
  const raw = fs.readFileSync(path.join(process.cwd(), 'prisma', 'seed_data.json'), 'utf8');
  const data = JSON.parse(raw) as SeedData;
  const tenant = await prisma.tenant.findUnique({ where: { slug: 'pinnacle-school' } });

  if (!tenant) {
    throw new Error('The Pinnacle tenant (slug: pinnacle-school) was not found. Run the main seed first.');
  }

  let departmentCount = 0;
  let courseCount = 0;

  for (const [facultyIndex, facultyData] of data.faculties.entries()) {
    const faculty = await prisma.faculty.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: facultyData.name } },
      update: {},
      create: { tenantId: tenant.id, name: facultyData.name },
    });

    for (const [departmentIndex, departmentData] of facultyData.departments.entries()) {
      const code = departmentCode(facultyIndex, departmentIndex);
      const existingDepartment = await prisma.department.findFirst({
        where: { tenantId: tenant.id, facultyId: faculty.id, name: departmentData.name },
      });
      const department = existingDepartment
        ? await prisma.department.update({
            where: { id: existingDepartment.id },
            data: { confidence: departmentData.confidence, source: departmentData.source ?? null },
          })
        : await prisma.department.create({
            data: {
              tenantId: tenant.id,
              facultyId: faculty.id,
              name: departmentData.name,
              code,
              confidence: departmentData.confidence,
              source: departmentData.source ?? null,
            },
          });
      departmentCount += 1;

      for (const courseData of departmentData.courses ?? []) {
        await prisma.course.upsert({
          where: {
            tenantId_departmentId_code: {
              tenantId: tenant.id,
              departmentId: department.id,
              code: courseData.code,
            },
          },
          update: {
            title: courseData.title,
            description: '',
            level: String(courseData.level),
            creditUnits: courseData.creditUnits,
            semester: courseData.semester,
            elective: Boolean(courseData.elective),
          },
          create: {
            tenantId: tenant.id,
            departmentId: department.id,
            title: courseData.title,
            code: courseData.code,
            description: '',
            level: String(courseData.level),
            creditUnits: courseData.creditUnits,
            semester: courseData.semester,
            elective: Boolean(courseData.elective),
          },
        });
        courseCount += 1;
      }
    }
  }

  console.log('Faculty/Department/Course seed complete.', {
    faculties: data.faculties.length,
    departments: departmentCount,
    courses: courseCount,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
