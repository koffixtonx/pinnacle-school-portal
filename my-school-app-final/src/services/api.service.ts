import {
  ServiceError,
  camel,
  getCurrentUserId,
  paged,
  person,
  supabase,
  toServiceError,
  unwrap,
} from './api';

const PROFILE_COLUMNS = 'id, email, first_name, last_name, phone, role';

const NIGERIAN_PHONE_PATTERN = /^(?:\+234|234|0)(?:7|8|9)\d{9}$/;
const STUDENT_STATUSES = ['ACTIVE', 'INACTIVE', 'ON_PROBATION'];
const STUDENT_LEVELS = ['100', '200', '300', '400', '500'];
const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'];
const PAYMENT_METHODS = ['CARD', 'BANK_TRANSFER', 'CASH'];
const MAX_WELCOME_BACKGROUNDS = 8;

const normalizePhone = (phone: string) => phone.replace(/[\s().-]/g, '');

const asArray = <T,>(value: T[] | null | undefined): T[] => value ?? [];

/**
 * `{ data: { success, data } }` mirrors the envelope the pages already unwrap
 * with `response.data.data`, so migrating the transport did not require
 * touching a single page component.
 */
const envelope = <T,>(data: T) => ({ data: { success: true, data } });

async function profileOf(userId: string) {
  const row = unwrap(
    await supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle(),
    'Could not read your profile.',
  );
  if (!row) {
    // handle_new_auth_user() creates this row inside GoTrue's own insert, so its
    // absence means 0002 or 0005 has not reached the database - naming that here
    // is the difference between a diagnosable failure and a mysterious one.
    throw new ServiceError(
      'Your account has no profile yet: the database migrations are not fully applied.',
    );
  }
  return camel(row);
}

export const authService = {
  async register(firstName: string, lastName: string, email: string, password: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      // handle_new_auth_user() turns this metadata into the profiles row. The
      // role is not sent here: public sign-ups are students by construction.
      options: { data: { firstName, lastName } },
    });
    if (error) throw toServiceError(error, 'Registration failed.');
    if (!data.user) throw new ServiceError('Registration failed. Please try again.');

    // With "Confirm email" enabled - the default in a new Supabase project -
    // signUp creates the account and returns no session. That is the success
    // path, so it must not reach the page as an error: handle_new_auth_user()
    // has already written the profile, and the only step left is the inbox.
    if (!data.session) {
      return { data: { success: true, accessToken: null, pendingConfirmation: true, user: null } };
    }

    return {
      data: {
        success: true,
        accessToken: data.session.access_token,
        pendingConfirmation: false,
        user: await profileOf(data.user.id),
      },
    };
  },

  async login(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw toServiceError(error, 'Invalid credentials');
    if (!data.session || !data.user) throw new ServiceError('Invalid credentials');

    const user = await profileOf(data.user.id);
    if (user.active === false) {
      await supabase.auth.signOut();
      throw new ServiceError('This account has been deactivated.');
    }

    return { data: { success: true, accessToken: data.session.access_token, user } };
  },

  async logout() {
    const { error } = await supabase.auth.signOut();
    if (error) throw toServiceError(error, 'Logout failed.');
    return { data: { success: true, message: 'Logged out' } };
  },

  async updateProfile(fullName: string, phone: string) {
    const normalizedName = fullName?.trim().replace(/\s+/g, ' ');
    const normalizedPhone = phone === undefined ? null : normalizePhone(String(phone).trim());

    if (!normalizedName || normalizedName.split(' ').length < 2) {
      throw new ServiceError('Please enter your first and last name.');
    }
    if (normalizedPhone && !NIGERIAN_PHONE_PATTERN.test(normalizedPhone)) {
      throw new ServiceError('Please enter a valid Nigerian phone number, such as +234 803 000 1234.');
    }

    const nameParts = normalizedName.split(' ');
    const firstName = nameParts.shift() as string;
    const lastName = nameParts.join(' ');
    const userId = await getCurrentUserId();

    unwrap(
      await supabase
        .from('profiles')
        .update({ first_name: firstName, last_name: lastName, phone: normalizedPhone || null })
        .eq('id', userId)
        .select(PROFILE_COLUMNS)
        .single(),
      'Unable to update your profile.',
    );

    return { data: { success: true, user: await profileOf(userId) } };
  },

  async changePassword(newPassword: string) {
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      throw new ServiceError('Your new password must be at least 8 characters.');
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw toServiceError(error, 'Your password could not be changed.');
    return { data: { success: true } };
  },
};

export const adminService = {
  async getEnrollmentAnalytics() {
    const [trend, totals] = await Promise.all([
      unwrap<any[]>(await supabase.rpc('enrollment_analytics'), 'Analytics unavailable.'),
      unwrap<Record<string, number | string | null>>(await supabase.rpc('dashboard_totals'), 'Analytics unavailable.'),
    ]);
    return envelope({
      enrollmentTrend: asArray(trend).map((row: any) => ({ createdAt: `${row.month}-01T00:00:00.000Z`, _count: { id: Number(row.count) } })),
      totals: {
        totalStudents: Number(totals?.totalStudents ?? 0),
        totalTeachers: Number(totals?.totalTeachers ?? 0),
        averageScore: totals?.averageScore == null ? null : Number(totals.averageScore),
        averageLetter: totals?.averageLetter == null ? null : String(totals.averageLetter),
      },
    });
  },

  async getFeeCollectionAnalytics() {
    const rows = unwrap<any[]>(await supabase.rpc('fee_collection_analytics'), 'Analytics unavailable.');
    return envelope({
      monthlyCollection: asArray(rows).map((row: any) => ({ paidAt: `${row.month}-01T00:00:00.000Z`, _sum: { amount: Number(row.total) } })),
    });
  },

  async getAttendanceAnalytics() {
    const rows = unwrap<any[]>(await supabase.rpc('attendance_analytics'), 'Analytics unavailable.');
    return envelope({
      attendanceTotals: asArray(rows).map((row: any) => ({ status: row.status, _count: { status: Number(row.count) } })),
    });
  },

  async listStudents(params?: { limit?: number; cursor?: string }) {
    const limit = Math.min(Number(params?.limit) || 25, 100);
    let query = supabase
      .from('profiles')
      .select(`${PROFILE_COLUMNS}, active, student_status, admitted_year, student_level, created_at, department:departments(id, name, code)`)
      .eq('role', 'STUDENT')
      .order('created_at', { ascending: false })
      .limit(limit + 1);
    if (params?.cursor) query = query.lt('created_at', params.cursor);

    const rows = camel(asArray(unwrap(await query, 'Failed to load students.')));
    const hasNext = rows.length > limit;
    if (hasNext) rows.pop();
    return paged(rows, hasNext ? new Date(rows[rows.length - 1].createdAt).toISOString() : null);
  },

  async createStudent(firstName: string, lastName: string, email: string) {
    const id = unwrap(
      await supabase.rpc('create_school_user', { p_first_name: firstName, p_last_name: lastName, p_email: email, p_role: 'STUDENT' }),
      'Could not create the student.',
    );
    return envelope({ id, firstName, lastName, email, active: true });
  },

  async updateStudent(
    id: string,
    data: Partial<{
      firstName: string;
      lastName: string;
      email: string;
      active: boolean;
      studentStatus: 'ACTIVE' | 'INACTIVE' | 'ON_PROBATION';
      admittedYear: number | null;
      studentLevel: string;
      departmentId: string | null;
    }>,
  ) {
    if (data.studentStatus !== undefined && !STUDENT_STATUSES.includes(data.studentStatus)) {
      throw new ServiceError('Student status must be ACTIVE, INACTIVE, or ON_PROBATION.');
    }
    if (data.studentLevel !== undefined && !STUDENT_LEVELS.includes(data.studentLevel)) {
      throw new ServiceError('Student level must be 100, 200, 300, 400, or 500.');
    }
    if (data.departmentId) {
      const found = unwrap(
        await supabase.from('departments').select('id').eq('id', data.departmentId).maybeSingle(),
        'Department lookup failed.',
      );
      if (!found) throw new ServiceError('Department not found.');
    }

    const patch: Record<string, unknown> = {};
    if (data.firstName !== undefined) patch.first_name = data.firstName;
    if (data.lastName !== undefined) patch.last_name = data.lastName;
    if (data.email !== undefined) patch.email = data.email;
    if (data.studentStatus !== undefined) {
      patch.student_status = data.studentStatus;
      patch.active = data.studentStatus !== 'INACTIVE';
    } else if (data.active !== undefined) patch.active = data.active;
    if (data.admittedYear !== undefined) patch.admitted_year = data.admittedYear;
    if (data.studentLevel !== undefined) patch.student_level = data.studentLevel;
    if (data.departmentId !== undefined) patch.department_id = data.departmentId;

    const row = unwrap(
      await supabase
        .from('profiles')
        .update(patch)
        .eq('id', id)
        .eq('role', 'STUDENT')
        .select(`${PROFILE_COLUMNS}, active, student_status, admitted_year, student_level, created_at, department:departments(id, name, code)`)
        .maybeSingle(),
      'Could not update the student.',
    );
    if (!row) throw new ServiceError('Student not found.');
    return envelope(camel(row));
  },

  async deleteStudent(id: string) {
    unwrap(await supabase.from('profiles').delete().eq('id', id).eq('role', 'STUDENT'), 'Could not remove the student.');
    return { data: { success: true } };
  },

  async listTeachers() {
    const rows = camel(asArray(
      unwrap(
        await supabase
          .from('profiles')
          .select(`${PROFILE_COLUMNS}, active`)
          .eq('role', 'TEACHER')
          .order('first_name', { ascending: true }),
        'Failed to load teachers.',
      ),
    ));
    return envelope(rows);
  },

  async createTeacher(firstName: string, lastName: string, email: string) {
    const id = unwrap(
      await supabase.rpc('create_school_user', { p_first_name: firstName, p_last_name: lastName, p_email: email, p_role: 'TEACHER' }),
      'Could not create the teacher.',
    );
    return envelope({ id, firstName, lastName, email, active: true });
  },

  async updateTeacher(id: string, data: Partial<{ firstName: string; lastName: string; email: string; active: boolean }>) {
    const patch: Record<string, unknown> = {};
    if (data.firstName !== undefined) patch.first_name = data.firstName;
    if (data.lastName !== undefined) patch.last_name = data.lastName;
    if (data.email !== undefined) patch.email = data.email;
    if (data.active !== undefined) patch.active = data.active;

    const row = unwrap(
      await supabase.from('profiles').update(patch).eq('id', id).eq('role', 'TEACHER').select(`${PROFILE_COLUMNS}, active`).maybeSingle(),
      'Could not update the teacher.',
    );
    if (!row) throw new ServiceError('Teacher not found.');
    return envelope(camel(row));
  },

  async deleteTeacher(id: string) {
    unwrap(await supabase.from('profiles').delete().eq('id', id).eq('role', 'TEACHER'), 'Could not remove the teacher.');
    return { data: { success: true } };
  },

  async bulkImportStudents(sourceName: string, lines: Array<{ email: string; firstName: string; lastName: string }>) {
    const userId = await getCurrentUserId();
    const job = unwrap(
      await supabase
        .from('bulk_import_jobs')
        .insert({ type: 'STUDENT_IMPORT', source_name: sourceName, status: 'PROCESSING', requested_by_id: userId, summary: '{"imported":0,"failed":0}' })
        .select('id')
        .single(),
      'Could not start the import.',
    );

    let imported = 0;
    for (const line of lines) {
      const { error } = await supabase.rpc('create_school_user', {
        p_first_name: line.firstName,
        p_last_name: line.lastName,
        p_email: line.email,
        p_role: 'STUDENT',
      });
      if (error) continue;
      imported += 1;
    }

    unwrap(
      await supabase
        .from('bulk_import_jobs')
        .update({ status: 'COMPLETED', summary: JSON.stringify({ imported, failed: lines.length - imported }) })
        .eq('id', job.id),
      'Import finished but its status could not be saved.',
    );

    return { data: { success: true, jobId: job.id } };
  },

  async getAuditLogs(params?: { limit?: number; cursor?: string }) {
    const limit = Math.min(Number(params?.limit) || 25, 100);
    let query = supabase
      .from('audit_logs')
      .select('id, action, entity, entity_id, summary, created_at, actor_id')
      .order('created_at', { ascending: false })
      .limit(limit + 1);
    if (params?.cursor) query = query.lt('created_at', params.cursor);

    const rows = camel(asArray(unwrap(await query, 'Failed to load the audit log.')));
    const hasNext = rows.length > limit;
    if (hasNext) rows.pop();
    return paged(rows, hasNext ? new Date(rows[rows.length - 1].createdAt).toISOString() : null);
  },

  async listFaculties() {
    const rows = camel(
      asArray(
        unwrap(
          await supabase.from('faculties').select('id, name, created_at, departments(count)').order('name', { ascending: true }),
          'Failed to load faculties.',
        ),
      ),
    ).map((row: any) => ({ ...row, _count: { departments: Number(row.departments?.[0]?.count ?? 0) }, departments: undefined }));
    return envelope(rows);
  },

  async createFaculty(name: string) {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) throw new ServiceError('Faculty name is required.');
    const row = unwrap(
      await supabase.from('faculties').insert({ name: trimmed }).select('id, name, created_at, updated_at').single(),
      'Could not create the faculty.',
    );
    return envelope(camel(row));
  },

  async listDepartments() {
    const rows = camel(
      asArray(
        unwrap(
          await supabase
            .from('departments')
            .select('id, name, code, confidence, created_at, faculty:faculties(id, name), students:profiles(id), courses(count)')
            .order('name', { ascending: true }),
          'Failed to load departments.',
        ),
      ),
    ).map((row: any) => ({
      ...row,
      _count: { students: asArray(row.students).length, courses: Number(row.courses?.[0]?.count ?? 0) },
      students: undefined,
      courses: undefined,
    }));
    return envelope(rows);
  },

  async createDepartment(name: string, code: string, facultyId: string) {
    const trimmedName = String(name ?? '').trim();
    const trimmedCode = String(code ?? '').trim().toUpperCase();
    if (!trimmedName || !trimmedCode || !facultyId) throw new ServiceError('Name, code, and faculty are required.');
    const row = unwrap(
      await supabase
        .from('departments')
        .insert({ name: trimmedName, code: trimmedCode, faculty_id: facultyId })
        .select('id, name, code, confidence, faculty:faculties(id, name)')
        .single(),
      'Could not create the department.',
    );
    return envelope(camel(row));
  },
};

const COURSE_TEACHERS = 'teachers:course_teachers(teacher:profiles(id, first_name, last_name))';

/** PostgREST returns aggregate embeds as `[{ count }]`; pages expect `_count`. */
const aggregateCount = (value: unknown): number => Number(asArray(value as any[])[0]?.count ?? 0);

const flattenTeachers = (row: any) => ({
  ...row,
  teachers: asArray(row.teachers).map((link: any) => person(link.teacher)).filter(Boolean),
});

export const academicsService = {
  async listCourses() {
    const rows = camel(asArray(
      unwrap(
        await supabase
          .from('courses')
          .select(`id, title, code, description, level, created_at, ${COURSE_TEACHERS}, enrollments(count)`)
          .order('title', { ascending: true }),
        'Failed to load courses.',
      ),
    )).map((row: any) => {
      const count = aggregateCount(row.enrollments);
      const { enrollments, ...rest } = row;
      return { ...flattenTeachers(rest), _count: { enrollments: count } };
    });
    return envelope(rows);
  },

  async getCourseHierarchy() {
    const faculties = camel(asArray(
      unwrap(
        await supabase
          .from('faculties')
          .select(`id, name, departments:departments(id, name, code, confidence, source, courses:courses(id, code, title, level, credit_units, semester))`)
          .order('name', { ascending: true }),
        'Failed to load the course hierarchy.',
      ),
    ));
    return envelope(faculties);
  },

  async createCourse(title: string, code: string, description: string, teacherIds?: string[], level?: string) {
    if (!title || !code) throw new ServiceError('title and code are required.');
    const row = unwrap(
      await supabase
        .from('courses')
        .insert({ title, code, description: description ?? '', level: level ?? '100' })
        .select(`id, title, code, description, level, ${COURSE_TEACHERS}`)
        .single(),
      'Could not create the course.',
    );
    if (teacherIds?.length) {
      unwrap(
        await supabase
          .from('course_teachers')
          .insert(teacherIds.map((teacherId) => ({ course_id: row.id, teacher_id: teacherId }))),
        'The course was created but its teachers could not be attached.',
      );
    }
    const reloaded = unwrap(
      await supabase.from('courses').select(`id, title, code, description, level, ${COURSE_TEACHERS}`).eq('id', row.id).single(),
      'Could not read the course back.',
    );
    return envelope(flattenTeachers(camel(reloaded)));
  },

  async updateCourse(
    id: string,
    data: Partial<{ title: string; code: string; description: string; teacherIds: string[]; level: string; departmentId: string | null }>,
  ) {
    const patch: Record<string, unknown> = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.code !== undefined) patch.code = data.code;
    if (data.description !== undefined) patch.description = data.description;
    if (data.level !== undefined) patch.level = data.level;
    if (data.departmentId !== undefined) patch.department_id = data.departmentId;

    if (Object.keys(patch).length) {
      unwrap(await supabase.from('courses').update(patch).eq('id', id), 'Could not update the course.');
    }
    if (data.teacherIds) {
      unwrap(await supabase.from('course_teachers').delete().eq('course_id', id), 'Could not clear course teachers.');
      if (data.teacherIds.length) {
        unwrap(
          await supabase
            .from('course_teachers')
            .insert(data.teacherIds.map((teacherId) => ({ course_id: id, teacher_id: teacherId }))),
          'Could not assign course teachers.',
        );
      }
    }

    const row = unwrap(
      await supabase.from('courses').select(`id, title, code, description, level, ${COURSE_TEACHERS}`).eq('id', id).single(),
      'Could not read the course back.',
    );
    return envelope(flattenTeachers(camel(row)));
  },

  async deleteCourse(id: string) {
    unwrap(await supabase.from('courses').delete().eq('id', id), 'Could not delete the course.');
    return { data: { success: true } };
  },

  async enrollStudent(courseId: string, studentId: string) {
    const row = unwrap(
      await supabase
        .from('enrollments')
        .upsert({ course_id: courseId, student_id: studentId, status: 'ACTIVE' }, { onConflict: 'student_id,course_id' })
        .select('id, status, enrolled_at')
        .single(),
      'Could not enrol the student.',
    );
    return envelope(camel(row));
  },

  async listCourseEnrollments(courseId: string) {
    const rows = camel(asArray(
      unwrap(
        await supabase
          .from('enrollments')
          .select('id, status, enrolled_at, student:profiles(id, first_name, last_name)')
          .eq('course_id', courseId)
          .eq('status', 'ACTIVE'),
        'Failed to load the class list.',
      ),
    )).map((row: any) => ({ ...row, student: person(row.student) }));
    return envelope(rows);
  },

  async listAvailableCourses() {
    const userId = await getCurrentUserId();
    const rows = camel(asArray(
      unwrap(
        await supabase
          .from('courses')
          .select(`id, title, code, description, level, ${COURSE_TEACHERS}, enrollments(id, status, student_id)`)
          .eq('enrollments.student_id', userId)
          .order('level', { ascending: true })
          .order('title', { ascending: true }),
        'Failed to load available courses.',
      ),
    )).map((row: any) => ({
      ...flattenTeachers(row),
      // An outer-joined embed survives the dotted filter as [] when the
      // student has no request for that course yet.
      enrollments: asArray(row.enrollments).map((entry: any) => ({ id: entry.id, status: entry.status })),
    }));
    return envelope(rows);
  },

  async requestCourseEnrollment(courseId: string) {
    const userId = await getCurrentUserId();
    const course = unwrap(
      await supabase.from('courses').select('id').eq('id', courseId).maybeSingle(),
      'Course lookup failed.',
    );
    if (!course) throw new ServiceError('Course not found.');

    const row = unwrap(
      await supabase
        .from('enrollments')
        .upsert({ course_id: courseId, student_id: userId, status: 'PENDING' }, { onConflict: 'student_id,course_id' })
        .select('id, status, enrolled_at')
        .single(),
      'Could not send the enrolment request.',
    );
    return envelope(camel(row));
  },

  async listPendingEnrollments() {
    const userId = await getCurrentUserId();
    const myCourses = asArray(
      unwrap(
        await supabase.from('course_teachers').select('course_id').eq('teacher_id', userId),
        'Could not read your courses.',
      ),
    ).map((row: any) => row.course_id);
    if (!myCourses.length) return envelope([]);

    const rows = camel(asArray(
      unwrap(
        await supabase
          .from('enrollments')
          .select('id, status, created_at, course:courses(id, title, code, level), student:profiles(id, first_name, last_name, email)')
          .eq('status', 'PENDING')
          .in('course_id', myCourses)
          .order('created_at', { ascending: true }),
        'Failed to load enrolment requests.',
      ),
    )).map((row: any) => ({ ...row, student: { ...row.student } }));
    return envelope(rows);
  },

  async reviewEnrollment(enrollmentId: string, status: 'ACTIVE' | 'REJECTED') {
    if (!['ACTIVE', 'REJECTED'].includes(status)) throw new ServiceError('Status must be ACTIVE or REJECTED.');
    const row = unwrap(
      await supabase.from('enrollments').update({ status }).eq('id', enrollmentId).eq('status', 'PENDING').select('id, status').maybeSingle(),
      'Could not review the enrolment.',
    );
    if (!row) throw new ServiceError('Pending enrollment not found.');
    return envelope(camel(row));
  },

  async listClassSections() {
    const rows = camel(asArray(
      unwrap(
        await supabase
          .from('class_sections')
          .select('id, name, grade, homeroomTeacher:profiles(id, first_name, last_name), students:class_section_students(student_id)')
          .order('name', { ascending: true }),
        'Failed to load class sections.',
      ),
    )).map((row: any) => ({
      ...row,
      homeroomTeacher: person(row.homeroomTeacher),
      _count: { students: asArray(row.students).length },
      students: undefined,
    }));
    return envelope(rows);
  },

  async createClassSection(name: string, grade: string, homeroomTeacherId?: string) {
    if (!name || !grade) throw new ServiceError('name and grade are required.');
    const row = unwrap(
      await supabase
        .from('class_sections')
        .insert({ name, grade, homeroom_teacher_id: homeroomTeacherId ?? null })
        .select('id, name, grade, homeroom_teacher_id')
        .single(),
      'Could not create the class section.',
    );
    return envelope(camel(row));
  },

  async listClassSectionStudents(id: string) {
    const section = unwrap(
      await supabase.from('class_sections').select('id').eq('id', id).maybeSingle(),
      'Class section lookup failed.',
    );
    if (!section) throw new ServiceError('Class section not found.');

    const rows = asArray(
      unwrap(
        await supabase
          .from('class_section_students')
          .select('student:profiles(id, first_name, last_name, email)')
          .eq('section_id', id),
        'Failed to load the roster.',
      ),
    ).map((link: any) => camel(link.student));
    return envelope(rows);
  },

  async addStudentToClassSection(id: string, studentId: string) {
    if (!studentId) throw new ServiceError('studentId is required.');
    unwrap(
      await supabase.from('class_section_students').insert({ section_id: id, student_id: studentId }),
      'Could not add the student to the class.',
    );
    const students = await academicsService.listClassSectionStudents(id);
    return envelope({ id, students: students.data.data });
  },

  async listTimetable(params?: { classSectionId?: string; courseId?: string }) {
    let query = supabase
      .from('timetable_slots')
      .select('id, day_of_week, starts_at, ends_at, room, course:courses(id, title, code), classSection:class_sections(id, name), teacher:profiles(id, first_name, last_name)')
      .order('day_of_week', { ascending: true })
      .order('starts_at', { ascending: true });
    if (params?.classSectionId) query = query.eq('class_section_id', params.classSectionId);
    if (params?.courseId) query = query.eq('course_id', params.courseId);

    const rows = camel(asArray(unwrap(await query, 'Failed to load the timetable.')));
    return envelope(rows);
  },

  async createTimetableSlot(data: {
    courseId: string;
    classSectionId: string;
    teacherId: string;
    dayOfWeek: number;
    startsAt: string;
    endsAt: string;
    room: string;
  }) {
    const { courseId, classSectionId, teacherId, dayOfWeek, startsAt, endsAt } = data;
    if (!courseId || !classSectionId || !teacherId || dayOfWeek === undefined || !startsAt || !endsAt) {
      throw new ServiceError('courseId, classSectionId, teacherId, dayOfWeek, startsAt and endsAt are required.');
    }
    const row = unwrap(
      await supabase
        .from('timetable_slots')
        .insert({
          course_id: courseId,
          class_section_id: classSectionId,
          teacher_id: teacherId,
          day_of_week: dayOfWeek,
          starts_at: startsAt,
          ends_at: endsAt,
          room: data.room ?? '',
        })
        .select('id, day_of_week, starts_at, ends_at, room')
        .single(),
      'Could not create the timetable slot.',
    );
    return envelope(camel(row));
  },

  async deleteTimetableSlot(id: string) {
    unwrap(await supabase.from('timetable_slots').delete().eq('id', id), 'Could not delete the timetable slot.');
    return { data: { success: true } };
  },

  async listDepartmentTimetable() {
    const rows = camel(asArray(
      unwrap(
        await supabase
          .from('department_timetable_slots')
          .select('id, day_of_week, start_hour, course:courses(id, code, title), department:departments(id, name, confidence)')
          .order('day_of_week', { ascending: true })
          .order('start_hour', { ascending: true }),
        'Failed to load the department timetable.',
      ),
    ));
    return envelope(rows);
  },

  async createDepartmentTimetableSlot(data: { courseId: string; departmentId: string; dayOfWeek: number; startHour: number }) {
    const { courseId, departmentId, dayOfWeek, startHour } = data;
    if (!courseId || !departmentId || !Number.isInteger(dayOfWeek) || !Number.isInteger(startHour)) {
      throw new ServiceError('courseId, departmentId, dayOfWeek and startHour are required.');
    }
    if (dayOfWeek < 1 || dayOfWeek > 5 || ![8, 10, 12, 14, 16].includes(startHour)) {
      throw new ServiceError('Choose a weekday and one of the fixed two-hour periods from 08:00 to 18:00.');
    }
    const course = unwrap(
      await supabase.from('courses').select('id, department_id').eq('id', courseId).maybeSingle(),
      'Course lookup failed.',
    );
    if (!course || course.department_id !== departmentId) {
      throw new ServiceError('The selected course must belong to the selected department.');
    }

    const row = unwrap(
      await supabase
        .from('department_timetable_slots')
        .insert({ course_id: courseId, department_id: departmentId, day_of_week: dayOfWeek, start_hour: startHour })
        .select('id, day_of_week, start_hour, course:courses(id, code, title), department:departments(id, name, confidence)')
        .single(),
      'Could not save the timetable assignment.',
    );
    return envelope(camel(row));
  },

  async deleteDepartmentTimetableSlot(id: string) {
    unwrap(await supabase.from('department_timetable_slots').delete().eq('id', id), 'Could not remove the timetable assignment.');
    return { data: { success: true } };
  },
};

export const attendanceService = {
  async list(params?: { classSectionId?: string; date?: string }) {
    let query = supabase
      .from('attendance_records')
      .select('id, status, recorded_at, notes, student:profiles(id, first_name, last_name), classSection:class_sections(id, name)')
      .order('recorded_at', { ascending: false })
      .limit(200);
    if (params?.classSectionId) query = query.eq('class_section_id', params.classSectionId);
    if (params?.date) {
      const day = new Date(params.date);
      const nextDay = new Date(day);
      nextDay.setDate(day.getDate() + 1);
      query = query.gte('recorded_at', day.toISOString()).lt('recorded_at', nextDay.toISOString());
    }

    const rows = camel(asArray(unwrap(await query, 'Failed to load attendance.')));
    return envelope(rows);
  },

  async mark(classSectionId: string, date: string, records: Array<{ studentId: string; status: string; notes?: string }>) {
    if (!classSectionId || !date || !Array.isArray(records) || records.length === 0) {
      throw new ServiceError('classSectionId, date and a non-empty records array are required.');
    }
    for (const record of records) {
      if (!ATTENDANCE_STATUSES.includes(record.status)) {
        throw new ServiceError(`Invalid status "${record.status}". Must be one of ${ATTENDANCE_STATUSES.join(', ')}.`);
      }
    }

    const userId = await getCurrentUserId();
    const rows = records.map((record) => ({
      student_id: record.studentId,
      class_section_id: classSectionId,
      status: record.status,
      notes: record.notes ?? null,
      recorded_at: new Date(date).toISOString(),
      recorded_by_id: userId,
    }));

    unwrap(await supabase.from('attendance_records').insert(rows), 'Could not save attendance.');
    return envelope(rows);
  },
};

export const gradesService = {
  async listPeriods(courseId?: string) {
    let query = supabase
      .from('grade_periods')
      .select('id, name, starts_at, ends_at, course:courses(id, title, code)')
      .order('starts_at', { ascending: false });
    if (courseId) query = query.eq('course_id', courseId);

    const rows = camel(asArray(unwrap(await query, 'Failed to load grade periods.')))
      .map((row: any) => ({ ...row, courseId: row.course?.id, course: undefined }));
    return envelope(rows);
  },

  async createPeriod(courseId: string, name: string, startsAt: string, endsAt: string) {
    if (!courseId || !name || !startsAt || !endsAt) {
      throw new ServiceError('courseId, name, startsAt and endsAt are required.');
    }
    const startDate = new Date(startsAt);
    const endDate = new Date(endsAt);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new ServiceError('startsAt and endsAt must be valid dates.');
    }
    if (endDate <= startDate) throw new ServiceError('endsAt must be after startsAt.');

    const row = unwrap(
      await supabase
        .from('grade_periods')
        .insert({ course_id: courseId, name, starts_at: startDate.toISOString(), ends_at: endDate.toISOString() })
        .select('id, name, starts_at, ends_at, course_id')
        .single(),
      'Could not create the grade period.',
    );
    return envelope(camel(row));
  },

  async listEntries(params?: { courseId?: string; gradePeriodId?: string }) {
    let query = supabase
      .from('grade_entries')
      .select('id, score, letter_grade, comments, recorded_at, gradePeriod:grade_periods(id, name, course_id), enrollment:enrollments(id, student_id)')
      .order('recorded_at', { ascending: false })
      .limit(200);
    if (params?.gradePeriodId) query = query.eq('grade_period_id', params.gradePeriodId);
    if (params?.courseId) query = query.eq('grade_periods.course_id', params.courseId);

    const rows = camel(asArray(unwrap(await query, 'Failed to load grades.')));
    return envelope(rows);
  },

  async upsertEntry(enrollmentId: string, gradePeriodId: string, score: number, letterGrade?: string, comments?: string) {
    if (!enrollmentId || !gradePeriodId || score === undefined || score === null) {
      throw new ServiceError('enrollmentId, gradePeriodId and score are required.');
    }
    if (score < 0 || score > 100) throw new ServiceError('Score must be between 0 and 100.');

    // letter_grade is filled in by the default_grade_letter trigger when omitted.
    const payload: Record<string, unknown> = { enrollment_id: enrollmentId, grade_period_id: gradePeriodId, score };
    if (letterGrade) payload.letter_grade = letterGrade;
    if (comments !== undefined) payload.comments = comments;

    const row = unwrap(
      await supabase
        .from('grade_entries')
        .upsert(payload, { onConflict: 'enrollment_id,grade_period_id' })
        .select('id, score, letter_grade, comments, recorded_at')
        .single(),
      'Could not save the grade.',
    );
    return envelope(camel(row));
  },
};

export const feesService = {
  async listStructures() {
    const rows = camel(asArray(
      unwrap(
        await supabase.from('fee_structures').select('id, name, amount, frequency, active').eq('active', true).order('name', { ascending: true }),
        'Failed to load fee structures.',
      ),
    ));
    return envelope(rows);
  },

  async createStructure(name: string, amount: number, frequency: string) {
    if (!name || amount === undefined || !frequency) throw new ServiceError('name, amount and frequency are required.');
    const row = unwrap(
      await supabase.from('fee_structures').insert({ name, amount, frequency }).select('id, name, amount, frequency, active').single(),
      'Could not create the fee structure.',
    );
    return envelope(camel(row));
  },

  async listInvoices(studentId?: string) {
    let query = supabase
      .from('invoices')
      .select('id, reference, status, due_date, total_amount, paid_amount, created_at, lines:invoice_lines(id, description, amount), payments(*), student:profiles(id, first_name, last_name, email)')
      .order('created_at', { ascending: false })
      .limit(200);
    if (studentId) query = query.eq('student_id', studentId);

    const rows = camel(asArray(unwrap(await query, 'Failed to load invoices.')));
    return envelope(rows);
  },

  async createInvoice(studentId: string, dueDate: string, lines: Array<{ description: string; amount: number }>) {
    if (!studentId || !dueDate || !Array.isArray(lines) || lines.length === 0) {
      throw new ServiceError('studentId, dueDate and a non-empty lines array are required.');
    }
    const student = unwrap(
      await supabase.from('profiles').select('id').eq('id', studentId).eq('role', 'STUDENT').eq('active', true).maybeSingle(),
      'Student lookup failed.',
    );
    if (!student) throw new ServiceError('Student not found or not active.');

    const due = new Date(dueDate);
    if (Number.isNaN(due.getTime())) throw new ServiceError('dueDate must be a valid date.');

    const sanitized = lines.map((line) => ({ description: String(line.description).trim(), amount: Number(line.amount) }));
    if (sanitized.some((line) => !line.description || !(line.amount > 0))) {
      throw new ServiceError('Each invoice line must have a description and a positive amount.');
    }
    const total = sanitized.reduce((sum, line) => sum + line.amount, 0);
    if (!(total > 0)) throw new ServiceError('Invoice lines must sum to a positive amount.');

    const userId = await getCurrentUserId();
    const invoice = unwrap(
      await supabase
        .from('invoices')
        .insert({ student_id: studentId, due_date: due.toISOString(), total_amount: total, issued_by_id: userId, status: 'ISSUED' })
        .select('id')
        .single(),
      'Could not create the invoice.',
    );
    unwrap(
      await supabase.from('invoice_lines').insert(sanitized.map((line) => ({ invoice_id: invoice.id, ...line }))),
      'The invoice was created but its lines could not be saved.',
    );

    const rows = camel(unwrap(
      await supabase
        .from('invoices')
        .select('id, reference, status, due_date, total_amount, paid_amount, lines:invoice_lines(id, description, amount)')
        .eq('id', invoice.id)
        .single(),
      'Could not read the invoice back.',
    ));
    return envelope(rows);
  },

  async recordPayment(invoiceId: string, amount: number, method: string, transactionId?: string) {
    if (!amount || amount <= 0 || !method) throw new ServiceError('A positive amount and method are required.');
    if (!PAYMENT_METHODS.includes(method)) throw new ServiceError('Payment method is invalid.');

    const invoice = unwrap(
      await supabase.from('invoices').select('id, student_id, total_amount, paid_amount').eq('id', invoiceId).maybeSingle(),
      'Invoice lookup failed.',
    );
    if (!invoice) throw new ServiceError('Invoice not found.');
    if (Number(amount) > Number(invoice.total_amount) - Number(invoice.paid_amount)) {
      throw new ServiceError('Payment amount cannot exceed remaining invoice balance.');
    }

    const row = unwrap(
      await supabase
        .from('payments')
        .insert({ invoice_id: invoiceId, student_id: invoice.student_id, amount, method, transaction_id: transactionId ?? null })
        .select('id, amount, method, paid_at, transaction_id')
        .single(),
      'Could not record the payment.',
    );
    return envelope(camel(row));
  },
};

export const notificationsService = {
  async list() {
    const userId = await getCurrentUserId();
    const rows = camel(asArray(
      unwrap(
        await supabase
          .from('notifications')
          .select('id, level, category, title, message, created_at, reads:notification_reads(user_id)')
          .order('created_at', { ascending: false })
          .limit(20),
        'Failed to load notifications.',
      ),
    )).map((row: any) => {
      const reads = asArray(row.reads);
      const { reads: _drop, ...rest } = row;
      // The legacy API exposed a single readBy column; pages compare it to the
      // signed-in user id to decide whether an item is unread.
      return { ...rest, readBy: reads.some((read: any) => read.userId === userId) ? userId : null };
    });
    return envelope(rows);
  },

  async markRead(id: string) {
    unwrap(await supabase.rpc('mark_notifications_read', { p_notification_id: id }), 'Could not mark the notification as read.');
    return { data: { success: true } };
  },

  async markAllRead() {
    unwrap(await supabase.rpc('mark_notifications_read', { p_notification_id: null }), 'Could not mark notifications as read.');
    return { data: { success: true } };
  },
};

const SETTINGS_SELECT =
  'id, logo_path, hero_image_path, primary_color, secondary_color, widget_config, welcome_message, welcome_message_color, welcome_background_images';

const toSettings = (row: any) => {
  if (!row) return null;
  const settings = camel(row);
  return {
    ...settings,
    widgetConfig: settings.widgetConfig ?? { announcements: true, calendar: true, quickLinks: true },
    welcomeBackgroundImages: asArray(settings.welcomeBackgroundImages).filter((image: unknown) => typeof image === 'string'),
  };
};

async function uploadBranding(file: File, prefix: string): Promise<string> {
  const extension = file.name.includes('.') ? file.name.split('.').pop() : 'bin';
  const objectPath = `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const { error } = await supabase.storage.from('branding').upload(objectPath, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type,
  });
  if (error) throw toServiceError(error, 'Upload failed.');
  return `branding/${objectPath}`;
}

export const siteSettingsService = {
  async getPublic() {
    const row = unwrap(
      await supabase.from('site_settings').select(SETTINGS_SELECT).limit(1).maybeSingle(),
      'Branding could not be loaded.',
    );
    return envelope(toSettings(row));
  },

  async get() {
    const row = unwrap(
      await supabase.from('site_settings').select(SETTINGS_SELECT).limit(1).maybeSingle(),
      'Branding could not be loaded.',
    );
    return envelope(toSettings(row));
  },

  async update(formData: FormData) {
    const row = unwrap(
      await supabase.from('site_settings').select('id, logo_path, hero_image_path').limit(1).maybeSingle(),
      'Branding could not be read.',
    );

    const patch: Record<string, unknown> = {};
    const primaryColor = formData.get('primaryColor');
    const secondaryColor = formData.get('secondaryColor');
    const widgetConfig = formData.get('widgetConfig');
    if (typeof primaryColor === 'string' && primaryColor) patch.primary_color = primaryColor;
    if (typeof secondaryColor === 'string' && secondaryColor) patch.secondary_color = secondaryColor;
    if (typeof widgetConfig === 'string' && widgetConfig) patch.widget_config = JSON.parse(widgetConfig);

    for (const field of ['logo', 'hero'] as const) {
      const file = formData.get(field);
      if (file instanceof File && file.size > 0) {
        patch[field === 'logo' ? 'logo_path' : 'hero_image_path'] = await uploadBranding(file, field);
      }
    }

    if (!Object.keys(patch).length) return envelope(toSettings(row));

    const saved = row
      ? unwrap(await supabase.from('site_settings').update(patch).eq('id', row.id).select(SETTINGS_SELECT).single(), 'Could not save branding.')
      : unwrap(await supabase.from('site_settings').insert(patch).select(SETTINGS_SELECT).single(), 'Could not create branding.');
    return envelope(toSettings(saved));
  },

  async getWelcomeMessage() {
    const row = unwrap(
      await supabase.from('site_settings').select('welcome_message, welcome_message_color').limit(1).maybeSingle(),
      'Welcome message could not be loaded.',
    );
    return envelope({
      welcomeMessage: row?.welcome_message ?? null,
      welcomeMessageColor: row?.welcome_message_color ?? '#FFFFFF',
    });
  },

  async updateWelcomeMessage(welcomeMessage: string, welcomeMessageColor: string) {
    if (typeof welcomeMessage !== 'string') throw new ServiceError('Welcome message must be text.');
    if (typeof welcomeMessageColor !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(welcomeMessageColor)) {
      throw new ServiceError('Welcome message color must be a six-digit hex color.');
    }
    const message = welcomeMessage.trim();
    if (message.length > 160) throw new ServiceError('Welcome message must be 160 characters or fewer.');

    const row = unwrap(
      await supabase.from('site_settings').select('id').limit(1).maybeSingle(),
      'Branding could not be read.',
    );
    const patch = { welcome_message: message || null, welcome_message_color: welcomeMessageColor };
    const saved = row
      ? unwrap(await supabase.from('site_settings').update(patch).eq('id', row.id).select('welcome_message, welcome_message_color').single(), 'Could not save the welcome message.')
      : unwrap(await supabase.from('site_settings').insert(patch).select('welcome_message, welcome_message_color').single(), 'Could not save the welcome message.');

    return envelope(camel(saved));
  },

  async getWelcomeBackgrounds() {
    const row = unwrap(
      await supabase.from('site_settings').select('welcome_background_images').limit(1).maybeSingle(),
      'Backgrounds could not be loaded.',
    );
    return envelope({ images: asArray(camel<string[]>(row?.welcome_background_images ?? [])) });
  },

  async updateWelcomeBackgrounds(formData: FormData) {
    const removeRaw = formData.get('removePaths');
    const removePaths: string[] = typeof removeRaw === 'string' && removeRaw ? JSON.parse(removeRaw) : [];
    const files = formData.getAll('images').filter((entry): entry is File => entry instanceof File && entry.size > 0);

    const row = unwrap(
      await supabase.from('site_settings').select('id, welcome_background_images').limit(1).maybeSingle(),
      'Branding could not be read.',
    );
    const existing: string[] = asArray(camel<string[]>(row?.welcome_background_images ?? []));
    const remaining = existing.filter((image) => !removePaths.includes(image));

    if (remaining.length + files.length > MAX_WELCOME_BACKGROUNDS) {
      throw new ServiceError(`Welcome Page Background supports a maximum of ${MAX_WELCOME_BACKGROUNDS} images.`);
    }

    for (const path of removePaths) {
      const objectPath = path.replace(/^welcome-backgrounds\//, '');
      if (objectPath && objectPath !== path) await supabase.storage.from('welcome-backgrounds').remove([objectPath]);
    }

    const uploaded: string[] = [];
    for (const file of files) {
      const extension = file.name.includes('.') ? file.name.split('.').pop() : 'jpg';
      const objectPath = `welcome-backgrounds/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
      const { error } = await supabase.storage.from('welcome-backgrounds').upload(objectPath, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type,
      });
      if (error) throw toServiceError(error, 'Background upload failed.');
      uploaded.push(objectPath);
    }

    const images = [...remaining, ...uploaded];
    const saved = row
      ? unwrap(await supabase.from('site_settings').update({ welcome_background_images: images }).eq('id', row.id).select('welcome_background_images').single(), 'Could not save backgrounds.')
      : unwrap(await supabase.from('site_settings').insert({ welcome_background_images: images }).select('welcome_background_images').single(), 'Could not save backgrounds.');

    return envelope({ images: asArray(camel<string[]>(saved?.welcome_background_images ?? [])) });
  },
};

export default { supabase };
