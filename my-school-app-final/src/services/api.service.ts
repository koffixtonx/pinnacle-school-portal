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

const PROFILE_COLUMNS = 'id, email, first_name, last_name, phone, role, matric_number';

const NIGERIAN_PHONE_PATTERN = /^(?:\+234|234|0)(?:7|8|9)\d{9}$/;
const STUDENT_STATUSES = ['ACTIVE', 'INACTIVE', 'ON_PROBATION'];
const STUDENT_LEVELS = ['100', '200', '300', '400', '500'];
const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'];
const PAYMENT_METHODS = ['CARD', 'BANK_TRANSFER', 'CASH'];
const MAX_WELCOME_BACKGROUNDS = 8;

const normalizePhone = (phone: string) => phone.replace(/[\s().-]/g, '');

const asArray = <T,>(value: T[] | null | undefined): T[] => value ?? [];

/** courses.credit_units is checked by the database as 1..24 (0006). */
const isCreditUnitCount = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 24;

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

  /**
   * Matric numbers are issued by the registry, so the only way to sign in with
   * one is to ask the database which account it belongs to - which it will only
   * say when the surname matches too. The password then goes through the normal
   * sign-in, so a wrong password still reads as "Invalid credentials".
   */
  async loginByMatric(matricNumber: string, lastName: string, password: string) {
    const number = matricNumber?.trim();
    const surname = lastName?.trim();
    if (!number || !surname) throw new ServiceError('Enter both your matric number and your surname.');

    const email = unwrap(
      await supabase.rpc('resolve_login_email', { p_matric_number: number, p_last_name: surname }),
      'No student matches that matric number and surname.',
    );
    if (typeof email !== 'string' || !email) throw new ServiceError('No student matches that matric number and surname.');

    return this.login(email, password);
  },

  async requestPasswordReset(email: string) {
    const address = email?.trim();
    if (!address) throw new ServiceError('Enter the email address you signed up with.');

    const { error } = await supabase.auth.resetPasswordForEmail(address, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw toServiceError(error, 'The reset email could not be sent.');

    // GoTrue answers the same way whether or not the address exists, and this
    // must not become a way to test which emails have accounts here.
    return envelope({ message: 'If that address has an account, a reset link is on its way.' });
  },

  /**
   * The reset link Supabase sends carries a PKCE `code`, and `detectSessionInUrl`
   * is off in this client, so the code is exchanged by hand before the new
   * password is written.
   */
  async completePasswordReset(newPassword: string, code?: string) {
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      throw new ServiceError('Your new password must be at least 8 characters.');
    }

    if (code) {
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      if (exchangeError) {
        throw toServiceError(exchangeError, 'That reset link is no longer valid. Request another one.');
      }
    }

    const { data, error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      throw toServiceError(error, 'Your password could not be changed. Request a new reset link.');
    }
    if (!data.user) throw new ServiceError('Open the reset link from your email before choosing a new password.');

    return { data: { success: true } };
  },
};

/**
 * Two-factor codes live in GoTrue, not in the portal's tables: `auth.mfa` is the
 * only authority on whether a factor exists and whether it has been verified
 * this session, so nothing here is mirrored into Postgres.
 */
export const mfaService = {
  async status() {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) throw toServiceError(error, 'Two-factor status is unavailable.');
    const verified = data?.totp ?? [];
    const pending = (data?.all ?? []).filter((factor) => factor.factor_type === 'totp' && factor.status !== 'verified');
    return envelope({
      enrolled: verified.length > 0,
      /** Enrolled but never confirmed with a code, so it cannot be signed in with. */
      awaitingConfirmation: pending.length > 0,
      factorId: verified[0]?.id ?? pending[0]?.id ?? null,
    });
  },

  /** Whether this session has already proved a second factor. */
  async isVerified(): Promise<boolean> {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !data) return false;
    return data.currentLevel === 'aal2';
  },

  async enrol(friendlyName = 'Authenticator app') {
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName });
    if (error) throw toServiceError(error, 'Two-factor could not be set up.');
    if (!data?.totp) throw new ServiceError('Two-factor could not be set up.');
    return envelope({
      factorId: data.id,
      // The app shows the secret as text beside the picture, because an
      // authenticator that will not scan a QR code will still take a typed key.
      secret: data.totp.secret,
      qrCode: data.totp.qr_code,
      uri: data.totp.uri,
    });
  },

  /**
   * A code is proved against a fresh challenge every time: Supabase invalidates
   * a challenge once it is used, so a saved one cannot be replayed.
   */
  async confirm(factorId: string, code: string) {
    const digits = String(code ?? '').replace(/\D/g, '');
    if (digits.length !== 6) throw new ServiceError('Enter the 6-digit code from your authenticator app.');

    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError) throw toServiceError(challengeError, 'The verification request expired. Try again.');

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: digits,
    });
    // GoTrue answers a wrong code with "Invalid TOTP code entered", which tells
    // the student nothing; every failure here means the same two things.
    if (verifyError) throw new ServiceError('That code did not match or has expired. Check your app and try again.');

    return { data: { success: true } };
  },

  async disable(factorId: string) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) throw toServiceError(error, 'Two-factor could not be turned off.');
    return { data: { success: true } };
  },
};

export interface AuditEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  summary: string;
  changedData: string;
  createdAt: string;
  actorId: string | null;
  actor: { id: string; firstName: string; lastName: string; email: string | null; role: string } | null;
}

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

  /**
   * Issuing or clearing a matric number goes through the database rather than a
   * plain UPDATE: the RPC enforces the unique-per-tenant shape and writes the
   * audit row, and it refuses anyone who is not an administrator.
   */
  async setStudentMatricNumber(profileId: string, matricNumber: string) {
    if (!profileId) throw new ServiceError('Tell us which student this number belongs to.');
    const value = String(matricNumber ?? '').trim();

    const row = unwrap(
      await supabase.rpc('set_student_matric_number', { p_profile_id: profileId, p_matric_number: value || null }),
      'The matric number could not be saved.',
    );
    if (!row) throw new ServiceError('Student not found.');
    return envelope(camel(typeof row === 'object' ? row : { id: profileId, matricNumber: value }));
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

  async getAuditLogs(params?: {
    limit?: number;
    cursor?: string;
    entity?: string;
    action?: string;
    actorId?: string;
    from?: string;
    to?: string;
  }) {
    const limit = Math.min(Number(params?.limit) || 25, 100);
    let query = supabase
      .from('audit_logs')
      .select(
        'id, action, entity, entity_id, summary, changed_data, created_at, actor_id, ' +
          'actor:profiles!audit_logs_actor_id_fkey(id, first_name, last_name, email, role)',
      )
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (params?.entity) query = query.eq('entity', params.entity);
    if (params?.action) query = query.eq('action', params.action);
    if (params?.actorId) query = query.eq('actor_id', params.actorId);
    if (params?.from) query = query.gte('created_at', params.from);
    if (params?.to) query = query.lt('created_at', params.to);

    // One transaction stamps the same now() on every row it writes, so a single
    // action leaves several entries sharing a timestamp - provisioning alone
    // writes two. The read orders by id inside those ties, so the cursor has to
    // carry both: comparing only the timestamp would resume partway through a
    // tied group and skip the rows under it permanently.
    const [cursorAt, cursorId] = String(params?.cursor ?? '').split('|');
    if (cursorAt && cursorId) {
      query = query.or(`created_at.lt.${cursorAt},and(created_at.eq.${cursorAt},id.lt.${cursorId})`);
    } else if (params?.cursor) {
      query = query.lt('created_at', params.cursor);
    }

    const rows = camel(asArray(unwrap(await query, 'Failed to load the audit log.'))) as AuditEntry[];
    const hasNext = rows.length > limit;
    if (hasNext) rows.pop();
    const last = rows[rows.length - 1];
    // createdAt is passed through exactly as the database sent it. Rounding it
    // to milliseconds - as a Date would - makes the tie comparison miss rows the
    // next page then never returns.
    return paged(rows, hasNext && last ? `${last.createdAt}|${last.id}` : null);
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
          .select(`id, title, code, description, level, credit_units, created_at, ${COURSE_TEACHERS}, enrollments(count)`)
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

  async createCourse(
    title: string,
    code: string,
    description: string,
    teacherIds?: string[],
    level?: string,
    creditUnits?: number,
  ) {
    if (!title || !code) throw new ServiceError('title and code are required.');
    if (creditUnits !== undefined && !isCreditUnitCount(creditUnits)) {
      throw new ServiceError('Credit units must be a whole number between 1 and 24.');
    }
    const row = unwrap(
      await supabase
        .from('courses')
        .insert({
          title,
          code,
          description: description ?? '',
          level: level ?? '100',
          credit_units: creditUnits ?? 3,
        })
        .select(`id, title, code, description, level, credit_units, ${COURSE_TEACHERS}`)
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
      await supabase.from('courses').select(`id, title, code, description, level, credit_units, ${COURSE_TEACHERS}`).eq('id', row.id).single(),
      'Could not read the course back.',
    );
    return envelope(flattenTeachers(camel(reloaded)));
  },

  async updateCourse(
    id: string,
    data: Partial<{
      title: string;
      code: string;
      description: string;
      teacherIds: string[];
      level: string;
      creditUnits: number;
      departmentId: string | null;
    }>,
  ) {
    const patch: Record<string, unknown> = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.code !== undefined) patch.code = data.code;
    if (data.description !== undefined) patch.description = data.description;
    if (data.level !== undefined) patch.level = data.level;
    if (data.creditUnits !== undefined) {
      if (!isCreditUnitCount(data.creditUnits)) {
        throw new ServiceError('Credit units must be a whole number between 1 and 24.');
      }
      patch.credit_units = data.creditUnits;
    }
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
      await supabase.from('courses').select(`id, title, code, description, level, credit_units, ${COURSE_TEACHERS}`).eq('id', id).single(),
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
      .select('id, status, recorded_at, notes, student:profiles!attendance_records_student_id_fkey(id, first_name, last_name), classSection:class_sections(id, name)')
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
    // `!inner` makes the course filter below a real join. Without it PostgREST keeps
    // the non-matching parents and hands them back with gradePeriod: null.
    const periodTable = params?.courseId ? 'grade_periods!inner' : 'grade_periods';
    let query = supabase
      .from('grade_entries')
      .select(`id, score, letter_grade, status, comments, recorded_at, gradePeriod:${periodTable}(id, name, course_id), enrollment:enrollments(id, student_id)`)
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

  /** How many books of each status a grade period holds, for the workflow bar. */
  countByStatus(entries: Array<{ status?: string }>) {
    return entries.reduce<Record<string, number>>((totals, entry) => {
      const status = entry.status ?? 'DRAFT';
      totals[status] = (totals[status] ?? 0) + 1;
      return totals;
    }, {});
  },

  async submitPeriod(gradePeriodId: string) {
    if (!gradePeriodId) throw new ServiceError('Select a grade period first.');
    const count = unwrap(
      await supabase.rpc('submit_grade_period', { p_grade_period_id: gradePeriodId }),
      'Could not submit these results.',
    );
    return envelope({ submitted: Number(count ?? 0) });
  },

  async reviewPeriod(gradePeriodId: string, approve: boolean) {
    if (!gradePeriodId) throw new ServiceError('Select a grade period first.');
    const count = unwrap(
      await supabase.rpc('review_grade_period', { p_grade_period_id: gradePeriodId, p_approve: approve }),
      'Could not review these results.',
    );
    return envelope({ reviewed: Number(count ?? 0) });
  },

  async publishPeriod(gradePeriodId: string) {
    if (!gradePeriodId) throw new ServiceError('Select a grade period first.');
    const count = unwrap(
      await supabase.rpc('publish_grade_period', { p_grade_period_id: gradePeriodId }),
      'Could not publish these results.',
    );
    return envelope({ published: Number(count ?? 0) });
  },

  /** Pull an approved or published book back to draft so a score can be corrected. */
  async reopenPeriod(gradePeriodId: string) {
    if (!gradePeriodId) throw new ServiceError('Select a grade period first.');
    const count = unwrap(
      await supabase.rpc('reopen_grade_period', { p_grade_period_id: gradePeriodId }),
      'Could not reopen these results.',
    );
    return envelope({ reopened: Number(count ?? 0) });
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
      .select('id, reference, status, due_date, total_amount, paid_amount, created_at, lines:invoice_lines(id, description, amount), payments(*), student:profiles!invoices_student_id_fkey(id, first_name, last_name, email, matric_number)')
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

  /**
   * The bursar's "send overdue reminders" button. The database does the chasing
   * and refuses to repeat itself inside a week, so this is safe to click twice.
   */
  async flagOverdue() {
    const reminded = unwrap(
      await supabase.rpc('flag_overdue_invoices'),
      'The overdue reminders could not be sent.',
    );
    return envelope({ reminded: Number(reminded ?? 0) });
  },
};

/**
 * Paystack lives behind the two Edge Functions in supabase/functions: the browser
 * can open a checkout session and read its own attempts, and nothing more. The
 * money itself is only ever recorded by the webhook, whose signature the browser
 * cannot forge.
 */
export type PaymentAttempt = {
  id: string;
  reference: string;
  invoiceId: string;
  amount: string;
  currency: string;
  status: 'PENDING' | 'STARTED' | 'SUCCESS' | 'FAILED' | 'EXPIRED';
  email: string | null;
  authorizationUrl: string | null;
  failureReason: string | null;
  createdAt: string;
};

export const paystackService = {
  async begin(invoiceId: string, options?: { email?: string; amount?: number }) {
    if (!invoiceId) throw new ServiceError('Tell us which invoice you want to pay.');

    const { data, error } = await supabase.functions.invoke('paystack-initiate', {
      body: { invoiceId, email: options?.email ?? null, amount: options?.amount ?? null },
    });
    if (error) throw await functionError(error);

    const session = camel<{ reference?: string; authorizationUrl?: string }>(data);
    const authorizationUrl = session?.authorizationUrl;
    if (!authorizationUrl) {
      throw new ServiceError('The payment page did not open. Please try again in a moment.');
    }
    return envelope({ reference: session?.reference ?? null, authorizationUrl });
  },

  /**
   * Sessions the caller can see: a student's own, or the whole school's for an
   * administrator. RLS decides the reach, so this is one query for both pages.
   */
  async listSessions(limit = 20) {
    const rows = camel(asArray(
      unwrap(
        await supabase
          .from('payment_attempts')
          .select('id, reference, invoice_id, student_id, amount, currency, status, email, authorization_url, failure_reason, created_at, updated_at')
          .order('created_at', { ascending: false })
          .limit(limit),
        'Your payment attempts could not be loaded.',
      ),
    ));
    return envelope(rows);
  },

  /** The delivery log, which only an administrator's RLS policy lets through. */
  async listWebhookEvents(limit = 50) {
    const rows = camel(asArray(
      unwrap(
        await supabase
          .from('webhook_events')
          .select('id, event_id, reference, event, result, created_at')
          .order('created_at', { ascending: false })
          .limit(limit),
        'The payment delivery log could not be loaded.',
      ),
    ));
    return envelope(rows);
  },
};

/**
 * A function failure arrives as `FunctionsHttpError`, whose own message is
 * generic; the reason the student needs is the body the function returned.
 * Platform complaints ("Function not found", a refused request) describe our
 * deployment, not the student's action, so they get the friendly copy instead.
 */
const PLATFORM_NOISE = /function not found|not_found|no such function|invalid api key|unauthorized|failed to send a request/i;

async function functionError(error: any): Promise<ServiceError> {
  const response = error?.context;
  if (response && typeof response.json === 'function') {
    try {
      const body = await response.json();
      if (body?.error && !PLATFORM_NOISE.test(String(body.error))) return new ServiceError(String(body.error));
    } catch {
      // A gateway that answers with HTML has nothing useful to say here.
    }
  }
  const message = String(error?.message ?? '');
  if (!message || PLATFORM_NOISE.test(message)) {
    return new ServiceError('The payment service is not reachable right now. Please try again in a moment, or pay at the bursar.');
  }
  return new ServiceError(message);
}

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

// ---------------------------------------------------------------------------
// Academic calendar, course registration and published results
//
// The rules live in the database (0006-0008): the credit ceiling, the open
// window and who may read a result are enforced there, so these methods read
// back the same verdict the server would give rather than guessing it here.
// ---------------------------------------------------------------------------

export interface AcademicSession {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

export interface Semester {
  id: string;
  academicSessionId: string;
  name: string;
  number: number;
  startDate: string;
  endDate: string;
  isActive: boolean;
  academicSession?: { name: string } | null;
}

export interface GradeScaleBand {
  id: string;
  letter: string;
  minPercent: number;
  maxPercent: number;
  points: number;
}

export interface AcademicSettings {
  id?: string;
  minCreditUnits: number;
  maxCreditUnits: number;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
}

export type RegistrationStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'DROPPED';

export interface CourseRegistration {
  id: string;
  studentId: string;
  courseId: string;
  semesterId: string;
  creditUnits: number;
  status: RegistrationStatus;
  requestedAt: string;
  reviewedAt: string | null;
  notes: string | null;
  course?: { id: string; code: string; title: string; level: string; creditUnits: number } | null;
  student?: { id: string; firstName: string; lastName: string; email?: string } | null;
  reviewedBy?: { firstName: string; lastName: string } | null;
}

/** A row of the registration catalogue: the course plus this student's request. */
export interface CatalogCourse {
  id: string;
  code: string;
  title: string;
  description?: string;
  level?: string;
  creditUnits: number;
  registration: { id: string; status: RegistrationStatus; creditUnits: number; requestedAt: string } | null;
}

export interface ResultCourse {
  code: string;
  title: string;
  creditUnits: number;
  period: string;
  score: number;
  letterGrade: string;
  gradePoints: number;
}

export interface ResultSlip {
  semester?: Record<string, any> | null;
  session?: Record<string, any> | null;
  gradeCount: number;
  gpa: number;
  creditUnits: number | null;
  courses: ResultCourse[];
}

export interface TranscriptSemester {
  semesterId: string;
  semester: string;
  session: string;
  startDate: string;
  endDate: string;
  gpa: number;
  creditUnits: number | null;
  courses: ResultCourse[];
}

export interface Transcript {
  student: Record<string, any>;
  cgpa: number;
  classOfDegree: string;
  totalCreditUnits: number;
  semesters: TranscriptSemester[];
}

const SESSION_SELECT = 'id, name, start_date, end_date, is_active, created_at, updated_at';
const SEMESTER_SELECT = `id, name, number, start_date, end_date, is_active, academic_session_id, academicSession:academic_sessions(name)`;
const REGISTRATION_SELECT =
  'id, student_id, course_id, semester_id, credit_units, status, requested_at, reviewed_at, notes, ' +
  'course:courses(id, code, title, level, credit_units), ' +
  'student:profiles!course_registrations_student_id_fkey(id, first_name, last_name, email), ' +
  'reviewedBy:profiles!course_registrations_reviewed_by_id_fkey(id, first_name, last_name)';

const toAcademicSettings = (row: any): AcademicSettings => ({
  id: row?.id,
  minCreditUnits: Number(row?.min_credit_units ?? 10),
  maxCreditUnits: Number(row?.max_credit_units ?? 30),
  registrationOpensAt: row?.registration_opens_at ?? null,
  registrationClosesAt: row?.registration_closes_at ?? null,
});

export const academicService = {
  async listSessions() {
    const rows = camel(asArray(
      unwrap(
        await supabase.from('academic_sessions').select(SESSION_SELECT).order('start_date', { ascending: false }),
        'Failed to load the academic sessions.',
      ),
    ));
    return envelope(rows as AcademicSession[]);
  },

  async createSession(data: { name: string; startDate: string; endDate: string }) {
    if (!data.name?.trim()) throw new ServiceError('Give the session a name, such as 2026/2027.');
    if (!data.startDate || !data.endDate) throw new ServiceError('Both session dates are required.');
    if (new Date(data.endDate) <= new Date(data.startDate)) {
      throw new ServiceError('The session must end after it starts.');
    }

    const row = unwrap(
      await supabase
        .from('academic_sessions')
        .insert({ name: data.name.trim(), start_date: data.startDate, end_date: data.endDate })
        .select(SESSION_SELECT)
        .single(),
      'Could not create the academic session.',
    );
    return envelope(camel(row) as AcademicSession);
  },

  async listSemesters(academicSessionId?: string) {
    let query = supabase
      .from('semesters')
      .select(SEMESTER_SELECT)
      .order('start_date', { ascending: false })
      .order('number', { ascending: true });
    if (academicSessionId) query = query.eq('academic_session_id', academicSessionId);

    const rows = camel(asArray(unwrap(await query, 'Failed to load the semesters.')));
    return envelope(rows as Semester[]);
  },

  async createSemester(data: { academicSessionId: string; name: string; number: number; startDate: string; endDate: string }) {
    if (!data.academicSessionId || !data.name?.trim()) throw new ServiceError('A semester needs its session and a name.');
    if (!data.startDate || !data.endDate) throw new ServiceError('Both semester dates are required.');
    if (new Date(data.endDate) <= new Date(data.startDate)) {
      throw new ServiceError('The semester must end after it starts.');
    }
    if (![1, 2, 3].includes(Number(data.number))) {
      throw new ServiceError('A session has at most three semesters.');
    }

    const row = unwrap(
      await supabase
        .from('semesters')
        .insert({
          academic_session_id: data.academicSessionId,
          name: data.name.trim(),
          number: Number(data.number),
          start_date: data.startDate,
          end_date: data.endDate,
        })
        .select(SEMESTER_SELECT)
        .single(),
      'Could not create the semester.',
    );
    return envelope(camel(row) as Semester);
  },

  async getActiveSession() {
    const row = unwrap(await supabase.rpc('active_academic_session'), 'The active session could not be read.');
    return envelope(row ? (camel(row) as AcademicSession) : null);
  },

  async getActiveSemester() {
    const row = unwrap(await supabase.rpc('active_semester'), 'The active semester could not be read.');
    return envelope(row ? (camel(row) as Semester) : null);
  },

  async activateSession(id: string) {
    if (!id) throw new ServiceError('Select a session first.');
    const row = unwrap(
      await supabase.rpc('set_active_academic_session', { p_session_id: id }),
      'Could not activate the academic session.',
    );
    return envelope(camel(row) as AcademicSession);
  },

  async activateSemester(id: string) {
    if (!id) throw new ServiceError('Select a semester first.');
    const row = unwrap(
      await supabase.rpc('set_active_semester', { p_semester_id: id }),
      'Could not activate the semester.',
    );
    return envelope(camel(row) as Semester);
  },

  async getGradeScale() {
    const rows = camel(asArray(
      unwrap(
        await supabase
          .from('grade_scale')
          .select('id, letter, min_percent, max_percent, points, position')
          .order('position', { ascending: true }),
        'Failed to load the grade scale.',
      ),
    ));
    return envelope(rows as GradeScaleBand[]);
  },

  async getSettings() {
    const row = unwrap(await supabase.rpc('academic_settings_row'), 'The academic settings could not be read.');
    return envelope(toAcademicSettings(row));
  },

  async saveSettings(data: {
    minCreditUnits: number;
    maxCreditUnits: number;
    registrationOpensAt?: string | null;
    registrationClosesAt?: string | null;
  }) {
    const min = Number(data.minCreditUnits);
    const max = Number(data.maxCreditUnits);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max > 60) {
      throw new ServiceError('Credit limits must be whole numbers between 0 and 60.');
    }
    if (max < min) throw new ServiceError('The maximum credit load must be at least the minimum.');

    const opensAt = data.registrationOpensAt ? new Date(data.registrationOpensAt).toISOString() : null;
    const closesAt = data.registrationClosesAt ? new Date(data.registrationClosesAt).toISOString() : null;
    if (opensAt && closesAt && new Date(closesAt) <= new Date(opensAt)) {
      throw new ServiceError('Registration must close after it opens.');
    }

    const current = unwrap(await supabase.rpc('academic_settings_row'), 'The academic settings could not be read.');
    const patch = {
      min_credit_units: min,
      max_credit_units: max,
      registration_opens_at: opensAt,
      registration_closes_at: closesAt,
    };

    const saved = current
      ? unwrap(
          await supabase.from('academic_settings').update(patch).eq('id', current.id).select('*').single(),
          'Could not save the academic settings.',
        )
      : unwrap(
          await supabase.from('academic_settings').insert(patch).select('*').single(),
          'Could not save the academic settings.',
        );
    return envelope(toAcademicSettings(saved));
  },

  /** What the pages show next to the registration buttons. */
  async getRegistrationWindow() {
    const [open, message] = await Promise.all([
      unwrap<number | boolean>(await supabase.rpc('registration_window_open'), 'The registration window could not be read.'),
      unwrap<string | null>(await supabase.rpc('registration_window_message'), 'The registration window could not be read.'),
    ]);
    return envelope({ open: open === true, message: message ?? null });
  },
};

export const registrationService = {
  /**
   * The courses a learner can register for in the active semester, tagged with
   * whatever they already requested. Two plain reads instead of a filtered
   * embed keeps the result the same whether or not a request exists.
   */
  async listCatalog() {
    const semester = unwrap(await supabase.rpc('active_semester'), 'The active semester could not be read.');
    if (!semester) {
      throw new ServiceError('This school has no active semester yet. Ask an administrator to activate one.');
    }
    const userId = await getCurrentUserId();
    const semesterId = semester.id as string;

    const courseRows = camel(asArray(
      unwrap(
        await supabase
          .from('courses')
          .select('id, code, title, description, level, credit_units')
          .order('code', { ascending: true }),
        'Failed to load the courses.',
      ),
    )) as Record<string, any>[];

    const registrationRows = camel(asArray(
      unwrap(
        await supabase
          .from('course_registrations')
          .select('id, course_id, credit_units, status, requested_at')
          .eq('student_id', userId)
          .eq('semester_id', semesterId),
        'Failed to load your registrations.',
      ),
    )) as Record<string, any>[];

    const byCourse = new Map(registrationRows.map((row) => [row.courseId, row]));
    const courses: CatalogCourse[] = courseRows.map((course) => ({
      ...(course as unknown as Omit<CatalogCourse, 'registration'>),
      registration: (byCourse.get(course.id) ?? null) as CatalogCourse['registration'],
    }));

    return envelope({ semester: camel(semester) as Semester, courses });
  },

  async listMine() {
    const userId = await getCurrentUserId();
    const rows = camel(asArray(
      unwrap(
        await supabase
          .from('course_registrations')
          .select(REGISTRATION_SELECT)
          .eq('student_id', userId)
          .order('requested_at', { ascending: false }),
        'Failed to load your registrations.',
      ),
    ));
    return envelope(rows as CourseRegistration[]);
  },

  async listForReview(params?: { status?: RegistrationStatus; semesterId?: string }) {
    let query = supabase
      .from('course_registrations')
      .select(REGISTRATION_SELECT)
      .order('requested_at', { ascending: false })
      .limit(200);
    if (params?.status) query = query.eq('status', params.status);
    if (params?.semesterId) query = query.eq('semester_id', params.semesterId);

    const rows = camel(asArray(unwrap(await query, 'Failed to load the registrations.')));
    return envelope(rows as CourseRegistration[]);
  },

  async register(courseId: string) {
    if (!courseId) throw new ServiceError('Select a course to register.');
    const row = unwrap(
      await supabase.rpc('register_for_course', { p_course_id: courseId }),
      'Could not register you for this course.',
    );
    return envelope(camel(row) as CourseRegistration);
  },

  async drop(registrationId: string) {
    if (!registrationId) throw new ServiceError('Select a registration to drop.');
    const row = unwrap(
      await supabase.rpc('drop_course_registration', { p_registration_id: registrationId }),
      'Could not drop this course.',
    );
    return envelope(camel(row) as CourseRegistration);
  },

  async review(registrationId: string, approve: boolean, notes?: string) {
    if (!registrationId) throw new ServiceError('Select a registration to review.');
    const row = unwrap(
      await supabase.rpc('review_course_registration', {
        p_registration_id: registrationId,
        p_approve: approve,
        p_notes: notes?.trim() || null,
      }),
      'Could not review this registration.',
    );
    return envelope(camel(row) as CourseRegistration);
  },
};

export const resultsService = {
  /** One semester's published results - the data behind the result slip. */
  async slip(semesterId?: string) {
    const userId = await getCurrentUserId();
    const id = semesterId ?? unwrap(await supabase.rpc('active_semester_id'), 'The active semester could not be read.');
    if (!id) throw new ServiceError('This school has no active semester yet.');

    const row = unwrap(
      await supabase.rpc('student_results', { p_student_id: userId, p_semester_id: id }),
      'Your results could not be loaded.',
    );
    const slip = camel<Record<string, any>>(row ?? {});
    return envelope({
      semester: slip?.semester ?? null,
      session: slip?.session ?? null,
      gradeCount: Number(slip?.gradeCount ?? 0),
      gpa: Number(slip?.gpa ?? 0),
      creditUnits: slip?.creditUnits == null ? null : Number(slip.creditUnits),
      courses: asArray<ResultCourse>(slip?.courses ?? []),
    } as ResultSlip);
  },

  async transcript(studentId?: string) {
    const userId = studentId ?? await getCurrentUserId();
    const row = unwrap(
      await supabase.rpc('student_transcript', { p_student_id: userId }),
      'Your transcript could not be loaded.',
    );
    return envelope(camel<Transcript>(row ?? null));
  },
};

export type AnnouncementAudience = 'ALL' | 'STUDENTS' | 'TEACHERS' | 'PARENTS' | 'STAFF';
export type AnnouncementStatus = 'DRAFT' | 'PUBLISHED';

export interface Announcement {
  id: string;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  status: AnnouncementStatus;
  pinned: boolean;
  publishedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  author?: { id: string; firstName?: string; lastName?: string } | null;
  readAt?: string | null;
}

export interface DeliverySummary {
  emails: Record<string, number>;
  readBy: number;
  audience: number;
}

export interface GuardianLink {
  id: string;
  studentId: string;
  guardianId: string;
  relationship: string;
  createdAt: string;
  guardian?: { id: string; firstName: string; lastName: string; email: string } | null;
  student?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    matricNumber?: string | null;
    studentLevel?: string | null;
    studentStatus?: string | null;
  } | null;
}

const ANNOUNCEMENT_SELECT =
  'id, title, body, audience, status, pinned, published_at, expires_at, created_at, ' +
  'author:profiles!announcements_author_id_fkey(id, first_name, last_name)';

const GUARDIAN_SELECT =
  'id, student_id, guardian_id, relationship, created_at, ' +
  'guardian:profiles!student_guardians_guardian_id_fkey(id, first_name, last_name, email)';

const ANNOUNCEMENT_AUDIENCES: AnnouncementAudience[] = ['ALL', 'STUDENTS', 'TEACHERS', 'PARENTS', 'STAFF'];

/**
 * Read receipts come from a table whose policy admits only the reader's own
 * rows, so a second query is both the whole cost and the only honest answer.
 * Counting them over an embed would show an administrator their own ticks and
 * call it the school's.
 */
async function readStateOf(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = camel(asArray(
    unwrap(
      await supabase
        .from('announcement_reads')
        .select('announcement_id, read_at')
        .in('announcement_id', ids),
      'Read receipts could not be loaded.',
    ),
  ));
  return new Map<string, string>(rows.map((row: any) => [row.announcementId, row.readAt]));
}

const announcementInput = (data: {
  title: string;
  body: string;
  audience: AnnouncementAudience;
  pinned?: boolean;
  expiresAt?: string | null;
}) => {
  const title = data.title.trim();
  const body = data.body.trim();
  if (!title) throw new ServiceError('Give the notice a title.');
  if (!body) throw new ServiceError('Write the message families are meant to read.');
  if (!ANNOUNCEMENT_AUDIENCES.includes(data.audience)) throw new ServiceError('Choose who the notice is for.');
  if (data.expiresAt && Number.isNaN(Date.parse(data.expiresAt))) throw new ServiceError('The expiry date is not a date.');
  return {
    title,
    body,
    audience: data.audience,
    pinned: Boolean(data.pinned),
    expires_at: data.expiresAt || null,
  };
};

export const announcementService = {
  /** The feed a person opens: published, due, not expired, addressed to them. */
  async list(options?: { offset?: number; limit?: number }) {
    const offset = Math.max(Number(options?.offset) || 0, 0);
    const limit = Math.min(Number(options?.limit) || 20, 50);
    const now = new Date().toISOString();
    const rows = camel(asArray(
      unwrap(
        await supabase
          .from('announcements')
          .select(ANNOUNCEMENT_SELECT)
          .eq('status', 'PUBLISHED')
          .lte('published_at', now)
          .or('expires_at.is.null,expires_at.gt.' + now)
          .order('pinned', { ascending: false })
          .order('published_at', { ascending: false })
          .range(offset, offset + limit),
        'Announcements could not be loaded.',
      ),
    )) as Announcement[];

    const hasNext = rows.length > limit;
    const items = hasNext ? rows.slice(0, limit) : rows;
    const reads = await readStateOf(items.map((row) => row.id));
    items.forEach((row) => { row.readAt = reads.get(row.id) ?? null; });
    return envelope({ items, hasNext });
  },

  /** Everything the school has written, drafts included - administrators only. */
  async listForSchool(options?: { status?: AnnouncementStatus | '' }) {
    let query = supabase
      .from('announcements')
      .select(ANNOUNCEMENT_SELECT)
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100);
    if (options?.status) query = query.eq('status', options.status);
    const rows = camel(asArray(
      unwrap(await query, 'The announcement list could not be loaded.'),
    )) as Announcement[];
    return envelope(rows);
  },

  async compose(data: {
    title: string;
    body: string;
    audience: AnnouncementAudience;
    pinned?: boolean;
    expiresAt?: string | null;
  }) {
    const userId = await getCurrentUserId();
    const row = unwrap(
      await supabase
        .from('announcements')
        .insert({ ...announcementInput(data), author_id: userId })
        .select(ANNOUNCEMENT_SELECT)
        .single(),
      'The draft could not be saved.',
    );
    return envelope(camel(row) as Announcement);
  },

  async edit(id: string, data: {
    title: string;
    body: string;
    audience: AnnouncementAudience;
    pinned?: boolean;
    expiresAt?: string | null;
  }) {
    if (!id) throw new ServiceError('Select the notice to change.');
    const row = unwrap(
      await supabase
        .from('announcements')
        .update(announcementInput(data))
        .eq('id', id)
        .select(ANNOUNCEMENT_SELECT)
        .maybeSingle(),
      'The notice could not be saved.',
    );
    if (!row) throw new ServiceError('That notice is no longer here.');
    return envelope(camel(row) as Announcement);
  },

  /**
   * Writes the bell rows, and the mail rows when asked. `notified` and
   * `emailsQueued` are what the composer reports back, so the administrator
   * learns the size of the audience before the worker has sent anything.
   */
  async publish(id: string, sendEmail: boolean) {
    if (!id) throw new ServiceError('Select the notice to publish.');
    const result = unwrap<any>(
      await supabase.rpc('publish_announcement', { p_announcement_id: id, p_send_email: sendEmail }),
      'The announcement could not be published.',
    );
    if (!result) throw new ServiceError('That notice is no longer here.');
    return envelope({
      id: String(result.id),
      status: result.status as AnnouncementStatus,
      publishedAt: result.publishedAt,
      notified: Number(result.notified ?? 0),
      emailsQueued: Number(result.emailsQueued ?? 0),
    });
  },

  /** Back to the office shelf: nobody outside an administrator can read it. */
  async withdraw(id: string) {
    if (!id) throw new ServiceError('Select the notice to withdraw.');
    const row = unwrap(
      await supabase
        .from('announcements')
        .update({ status: 'DRAFT', published_at: null })
        .eq('id', id)
        .select(ANNOUNCEMENT_SELECT)
        .maybeSingle(),
      'The notice could not be withdrawn.',
    );
    if (!row) throw new ServiceError('That notice is no longer here.');
    return envelope(camel(row) as Announcement);
  },

  async remove(id: string) {
    if (!id) throw new ServiceError('Select the notice to delete.');
    unwrap(await supabase.from('announcements').delete().eq('id', id), 'The notice could not be deleted.');
    return { data: { success: true } };
  },

  /** Who the notice would reach, from the school's own register. */
  async recipients(id: string) {
    if (!id) throw new ServiceError('Select a notice.');
    const rows = camel(asArray(
      unwrap(
        await supabase.rpc('announcement_recipients', { p_announcement_id: id }),
        'The audience could not be read.',
      ),
    ));
    return envelope(rows as Array<{ id: string; email: string; fullName: string }>);
  },

  /** Counts, not addresses: what the mail log says about one notice. */
  async deliverySummary(id: string) {
    if (!id) throw new ServiceError('Select a notice.');
    const result = unwrap<any>(
      await supabase.rpc('announcement_delivery_summary', { p_announcement_id: id }),
      'The delivery report could not be read.',
    );
    const emails: Record<string, number> = {};
    Object.entries(result?.emails ?? {}).forEach(([status, count]) => { emails[status] = Number(count); });
    return envelope({
      emails,
      readBy: Number(result?.readBy ?? 0),
      audience: Number(result?.audience ?? 0),
    } as DeliverySummary);
  },

  async markRead(id?: string) {
    const count = unwrap<number>(
      await supabase.rpc('mark_announcements_read', { p_announcement_id: id ?? null }),
      'The notice could not be marked as read.',
    );
    return envelope(Number(count ?? 0));
  },
};

export const guardianService = {
  /** One call for the whole roster page, so the table stays a single fetch. */
  async forStudents(studentIds: string[]) {
    if (!studentIds.length) return envelope([] as GuardianLink[]);
    const rows = camel(asArray(
      unwrap(
        await supabase
          .from('student_guardians')
          .select(GUARDIAN_SELECT)
          .in('student_id', studentIds)
          .order('created_at', { ascending: true }),
        'The guardian links could not be loaded.',
      ),
    ));
    return envelope(rows as GuardianLink[]);
  },

  async link(studentId: string, guardianEmail: string, relationship: string) {
    if (!studentId) throw new ServiceError('Select the student.');
    if (!guardianEmail.trim()) throw new ServiceError('Enter the parent’s email address.');
    const row = unwrap(
      await supabase.rpc('link_guardian', {
        p_student_id: studentId,
        p_guardian_email: guardianEmail.trim(),
        p_relationship: relationship.trim() || 'Guardian',
      }),
      'The parent could not be linked to this student.',
    );
    return envelope(camel(row) as GuardianLink);
  },

  /**
   * The office creates a parent account before linking it, so a typo in an
   * address shows up as a link failure rather than a family that never hears
   * from the school.
   */
  async createParent(firstName: string, lastName: string, email: string) {
    const id = unwrap(
      await supabase.rpc('create_school_user', {
        p_first_name: firstName.trim(),
        p_last_name: lastName.trim(),
        p_email: email.trim(),
        p_role: 'PARENT',
      }),
      'The parent account could not be created.',
    );
    return envelope({ id, firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim() });
  },

  async unlink(linkId: string) {
    if (!linkId) throw new ServiceError('Select the link to remove.');
    unwrap(await supabase.rpc('unlink_guardian', { p_link_id: linkId }), 'The link could not be removed.');
    return { data: { success: true } };
  },

  /** A parent's own view: the children whose notices they are meant to receive. */
  async myChildren() {
    const userId = await getCurrentUserId();
    const rows = camel(asArray(
      unwrap(
        await supabase
          .from('student_guardians')
          .select('id, student_id, guardian_id, relationship, created_at, student:profiles!student_guardians_student_id_fkey(id, first_name, last_name, email, matric_number, student_level, student_status)')
          .eq('guardian_id', userId)
          .order('created_at', { ascending: true }),
        'Your children could not be loaded.',
      ),
    ));
    return envelope(rows as GuardianLink[]);
  },
};

export type AssignmentStatus = 'DRAFT' | 'PUBLISHED' | 'CLOSED';
export type SubmissionStatus = 'SUBMITTED' | 'LATE' | 'GRADED';

export interface Assignment {
  id: string;
  courseId: string;
  title: string;
  instructions: string;
  dueAt: string;
  points: number;
  status: AssignmentStatus;
  publishedAt: string | null;
  createdAt: string;
  course?: { id: string; code: string; title: string } | null;
  submission?: AssignmentSubmission | null;
}

export interface AssignmentSubmission {
  id: string;
  assignmentId: string;
  studentId: string;
  note: string;
  filePath: string | null;
  fileName: string | null;
  fileSizeBytes: number | null;
  status: SubmissionStatus;
  score: number | null;
  feedback: string | null;
  submittedAt: string;
  gradedAt: string | null;
}

export interface AssignmentRoster {
  assignmentId: string;
  submitted: number;
  late: number;
  graded: number;
  missing: number;
  students: Array<{
    studentId: string;
    firstName: string;
    lastName: string;
    matricNumber: string | null;
    submissionId: string | null;
    status: SubmissionStatus | null;
    note: string | null;
    filePath: string | null;
    fileName: string | null;
    fileSizeBytes: number | null;
    submittedAt: string | null;
    score: number | null;
    feedback: string | null;
  }>;
}

export interface CourseMaterial {
  id: string;
  courseId: string;
  title: string;
  description: string;
  weekLabel: string;
  storagePath: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
  uploadedBy?: { id: string; firstName?: string; lastName?: string } | null;
}

export interface IdCard {
  id: string;
  studentId: string;
  verificationCode: string;
  photoPath: string | null;
  sessionLabel: string;
  validFrom: string;
  validUntil: string;
  status: 'ISSUED' | 'REVOKED';
  issuedAt: string;
  revokedAt: string | null;
}

const ASSIGNMENT_SELECT =
  'id, course_id, title, instructions, due_at, points, status, published_at, created_at';
const SUBMISSION_SELECT =
  'id, assignment_id, student_id, note, file_path, file_name, file_size_bytes, status, score, feedback, submitted_at, graded_at';
const MATERIAL_SELECT =
  'id, course_id, title, description, week_label, storage_path, file_name, mime_type, size_bytes, created_at, uploaded_by:profiles!course_materials_uploaded_by_id_fkey(id, first_name, last_name)';
const ID_CARD_SELECT =
  'id, student_id, verification_code, photo_path, session_label, valid_from, valid_until, status, issued_at, revoked_at, issued_by:profiles!student_id_cards_issued_by_id_fkey(id, first_name, last_name)';

/** Storage rejects a name with a path separator in it, and a school should never see that error. */
const storageSafeName = (name: string) =>
  name.replace(/[^\w.()+-]/g, '_').replace(/^[_.]+/, '').slice(0, 80) || 'file';

const fileStamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * The Phase 4 buckets are private, so every read is a short-lived signed URL
 * issued to the person who has just passed the object's policy - the difference
 * between an obscure name and access control.
 */
async function signedDownloadUrl(bucket: string, key: string): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(key, 120);
  if (error || !data?.signedUrl) throw toServiceError(error, 'That file could not be opened.');
  return data.signedUrl;
}

/** `limitMb` mirrors the bucket's own ceiling so the student hears it before the upload fails. */
async function uploadPrivateFile(bucket: string, key: string, file: File, limitMb: number) {
  if (file.size > limitMb * 1024 * 1024) {
    throw new ServiceError(`That file is bigger than the ${limitMb} MB limit for this school.`);
  }
  const { error } = await supabase.storage.from(bucket).upload(key, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'application/octet-stream',
  });
  if (error) throw toServiceError(error, 'The upload failed. Please try again.');
}

/** 0015 checks the same range; saying it here saves a round trip to a constraint name. */
const isAssignmentPoints = (value: number) => Number.isFinite(value) && value > 0 && value <= 100;

export const assignmentService = {
  /** Everything set for the courses the signed-in student is on, soonest first. */
  async listForStudent() {
    const userId = await getCurrentUserId();
    const items = camel(asArray(
      unwrap(
        await supabase
          .from('assignments')
          .select(`${ASSIGNMENT_SELECT}, course:courses(id, code, title)`)
          .neq('status', 'DRAFT')
          .order('due_at', { ascending: true })
          .limit(100),
        'Your assignments could not be loaded.',
      ),
    )) as Assignment[];

    if (items.length) {
      const mine = camel(asArray(
        unwrap(
          await supabase
            .from('assignment_submissions')
            .select(SUBMISSION_SELECT)
            .eq('student_id', userId)
            .in('assignment_id', items.map((item) => item.id)),
          'Your submissions could not be loaded.',
        ),
      )) as AssignmentSubmission[];
      const byAssignment = new Map(mine.map((row) => [row.assignmentId, row]));
      items.forEach((item) => { item.submission = byAssignment.get(item.id) ?? null; });
    }
    return envelope(items);
  },

  /**
   * Everything the caller may act on, drafts included: a teacher's own courses,
   * the office's whole school. RLS decides that half, which is why no filter
   * appears here.
   */
  async listOwned() {
    const rows = camel(asArray(
      unwrap(
        await supabase
          .from('assignments')
          .select(`${ASSIGNMENT_SELECT}, course:courses(id, code, title)`)
          .order('due_at', { ascending: false })
          .limit(200),
        'Your assignments could not be loaded.',
      ),
    )) as Assignment[];
    return envelope(rows);
  },

  /** The tasks the caller teaches or runs, drafts included. */
  async listForCourse(courseId: string) {
    if (!courseId) throw new ServiceError('Choose a course.');
    const rows = camel(asArray(
      unwrap(
        await supabase
          .from('assignments')
          .select(`${ASSIGNMENT_SELECT}, course:courses(id, code, title)`)
          .eq('course_id', courseId)
          .order('due_at', { ascending: true }),
        'The assignments for this course could not be loaded.',
      ),
    )) as Assignment[];
    return envelope(rows);
  },

  async create(data: { courseId: string; title: string; instructions?: string; dueAt: string; points: number }) {
    const title = data.title?.trim();
    if (!data.courseId) throw new ServiceError('Choose the course this task belongs to.');
    if (!title) throw new ServiceError('Give the assignment a title.');
    if (!data.dueAt) throw new ServiceError('Choose when it is due.');
    if (!isAssignmentPoints(Number(data.points))) throw new ServiceError('Marks must be between 1 and 100.');

    const row = unwrap(
      await supabase
        .from('assignments')
        .insert({
          course_id: data.courseId,
          title,
          instructions: data.instructions?.trim() || '',
          due_at: new Date(data.dueAt).toISOString(),
          points: Number(data.points),
        })
        .select(`${ASSIGNMENT_SELECT}, course:courses(id, code, title)`)
        .single(),
      'The assignment could not be saved.',
    );
    return envelope(camel(row) as Assignment);
  },

  /** Only the four columns 0015 leaves writable; publish and close are RPCs. */
  async edit(id: string, data: { title: string; instructions?: string; dueAt: string; points: number }) {
    if (!id) throw new ServiceError('Choose the assignment to change.');
    const title = data.title?.trim();
    if (!title) throw new ServiceError('Give the assignment a title.');
    if (!isAssignmentPoints(Number(data.points))) throw new ServiceError('Marks must be between 1 and 100.');

    const row = unwrap(
      await supabase
        .from('assignments')
        .update({
          title,
          instructions: data.instructions?.trim() || '',
          due_at: new Date(data.dueAt).toISOString(),
          points: Number(data.points),
        })
        .eq('id', id)
        .select(ASSIGNMENT_SELECT)
        .maybeSingle(),
      'The assignment could not be saved.',
    );
    if (!row) throw new ServiceError('That assignment is no longer here.');
    return envelope(camel(row) as Assignment);
  },

  /** Tells the teacher how many students it reaches, which is the point of the button. */
  async publish(id: string) {
    if (!id) throw new ServiceError('Choose the assignment to publish.');
    const result = unwrap<Record<string, any>>(
      await supabase.rpc('publish_assignment', { p_assignment_id: id }),
      'The assignment could not be published.',
    );
    return envelope({
      id: String(result?.id ?? id),
      status: result?.status as AssignmentStatus,
      publishedAt: result?.publishedAt ?? null,
      students: Number(result?.students ?? 0),
    });
  },

  async close(id: string) {
    if (!id) throw new ServiceError('Choose the assignment to close.');
    const row = unwrap(
      await supabase.rpc('close_assignment', { p_assignment_id: id }),
      'The assignment could not be closed.',
    );
    return envelope(camel(row) as Assignment);
  },

  /** The roll, each person's state, and the tallies, in one call. */
  async roster(id: string) {
    if (!id) throw new ServiceError('Choose an assignment.');
    const result = camel<AssignmentRoster>(
      unwrap<Record<string, any>>(
        await supabase.rpc('assignment_roster', { p_assignment_id: id }),
        'The roster could not be loaded.',
      ),
    );
    return envelope({ ...result, students: asArray(result?.students) });
  },

  /**
   * The file goes up first, into a folder that names this course, this task and
   * this student - which is the path submit_assignment() will refuse anything else
   * to. The row is only written once the object is really there.
   */
  async submit(data: { assignmentId: string; note?: string; file?: File | null }) {
    const userId = await getCurrentUserId();
    const note = data.note?.trim() || '';
    if (!data.assignmentId) throw new ServiceError('Choose the work you are handing in.');
    if (!note && !data.file) throw new ServiceError('Write something or attach a file before handing it in.');

    const assignment = unwrap<{ course_id: string }>(
      await supabase
        .from('assignments')
        .select('course_id')
        .eq('id', data.assignmentId)
        .maybeSingle(),
      'That assignment is no longer here.',
    );
    if (!assignment) throw new ServiceError('That assignment is no longer here.');

    let filePath: string | null = null;
    if (data.file) {
      const key = `${assignment.course_id}/${data.assignmentId}/${userId}/${fileStamp()}-${storageSafeName(data.file.name)}`;
      await uploadPrivateFile('assignment-submissions', key, data.file, 20);
      filePath = key;
    }

    const row = unwrap(
      await supabase.rpc('submit_assignment', {
        p_assignment_id: data.assignmentId,
        p_note: note || null,
        p_file_path: filePath,
        p_file_name: data.file?.name || null,
        p_file_size: data.file ? data.file.size : null,
      }),
      'Your work could not be handed in.',
    );
    return envelope(camel(row) as AssignmentSubmission);
  },

  async grade(submissionId: string, score: number, feedback?: string) {
    if (!submissionId) throw new ServiceError('Choose the submission to mark.');
    if (!Number.isFinite(score) || score < 0) throw new ServiceError('Enter the mark to record.');

    const row = unwrap(
      await supabase.rpc('grade_submission', {
        p_submission_id: submissionId,
        p_score: Math.round(score * 100) / 100,
        p_feedback: feedback?.trim() || null,
      }),
      'The mark could not be saved.',
    );
    return envelope(camel(row) as AssignmentSubmission);
  },

  async download(filePath: string) {
    if (!filePath) throw new ServiceError('There is no file attached to this submission.');
    return envelope(await signedDownloadUrl('assignment-submissions', filePath));
  },
};

export const materialService = {
  async listForCourse(courseId: string) {
    if (!courseId) throw new ServiceError('Choose a course.');
    const rows = camel(asArray(
      unwrap(
        await supabase
          .from('course_materials')
          .select(MATERIAL_SELECT)
          .eq('course_id', courseId)
          .order('created_at', { ascending: false }),
        'The course materials could not be loaded.',
      ),
    )) as CourseMaterial[];
    return envelope(rows);
  },

  /** Everything on every course the caller is on, teaches or runs - the reading list. */
  async listVisible() {
    const rows = camel(asArray(
      unwrap(
        await supabase
          .from('course_materials')
          .select(`${MATERIAL_SELECT}, course:courses(id, code, title)`)
          .order('created_at', { ascending: false })
          .limit(200),
        'Your materials could not be loaded.',
      ),
    )) as Array<CourseMaterial & { course?: { id: string; code: string; title: string } | null }>;
    return envelope(rows);
  },

  /**
   * Upload then attach, in that order: attach_course_material() refuses a path
   * whose object does not exist, so a cancelled upload leaves no row behind.
   */
  async publish(data: {
    courseId: string;
    title: string;
    file: File;
    description?: string;
    weekLabel?: string;
  }) {
    const userId = await getCurrentUserId();
    const title = data.title?.trim();
    if (!data.courseId) throw new ServiceError('Choose the course this belongs to.');
    if (!title) throw new ServiceError('Give the file a title so the class knows what it is.');
    if (!data.file) throw new ServiceError('Choose the file to attach.');

    const key = `${data.courseId}/${fileStamp()}-${storageSafeName(data.file.name)}`;
    await uploadPrivateFile('course-materials', key, data.file, 50);

    const row = unwrap(
      await supabase.rpc('attach_course_material', {
        p_course_id: data.courseId,
        p_title: title,
        p_storage_path: key,
        p_file_name: data.file.name,
        p_description: data.description?.trim() || null,
        p_week_label: data.weekLabel?.trim() || null,
        p_mime_type: data.file.type || null,
        p_size_bytes: data.file.size,
      }),
      'The material could not be published.',
    );
    const material = camel<CourseMaterial>(row);
    return envelope({ ...material, uploadedBy: material.uploadedBy ?? { id: userId } });
  },

  async edit(id: string, data: { title: string; description?: string; weekLabel?: string }) {
    if (!id) throw new ServiceError('Choose the material to change.');
    const title = data.title?.trim();
    if (!title) throw new ServiceError('Give the file a title.');

    const row = unwrap(
      await supabase
        .from('course_materials')
        .update({ title, description: data.description?.trim() || '', week_label: data.weekLabel?.trim() || '' })
        .eq('id', id)
        .select(MATERIAL_SELECT)
        .maybeSingle(),
      'The material could not be saved.',
    );
    // An RLS-filtered update is silent, so the read-back is the only way to know
    // the caller was allowed to write it at all.
    if (!row) throw new ServiceError('That material is no longer here.');
    return envelope(camel(row) as CourseMaterial);
  },

  /** Takes the stored file with the row, which is what the RPC exists for. */
  async remove(id: string) {
    if (!id) throw new ServiceError('Choose the material to remove.');
    const row = unwrap(
      await supabase.rpc('remove_course_material', { p_material_id: id }),
      'The material could not be removed.',
    );
    if (!row) throw new ServiceError('That material is no longer here.');
    return { data: { success: true } };
  },

  async download(storagePath: string) {
    if (!storagePath) throw new ServiceError('There is no file to open.');
    return envelope(await signedDownloadUrl('course-materials', storagePath));
  },
};

export const idCardService = {
  /** The signed-in student's own cards, the live one first. */
  async mine() {
    const userId = await getCurrentUserId();
    const rows = camel(asArray(
      unwrap(
        await supabase
          .from('student_id_cards')
          .select(ID_CARD_SELECT)
          .eq('student_id', userId)
          .order('issued_at', { ascending: false }),
        'Your ID card could not be loaded.',
      ),
    )) as IdCard[];
    return envelope({ current: rows.find((row) => row.status === 'ISSUED') ?? null, history: rows });
  },

  /** The office's view of every card in the school, with enough on each row to print it. */
  async forSchool() {
    const rows = camel(asArray(
      unwrap(
        await supabase
          .from('student_id_cards')
          .select(`${ID_CARD_SELECT}, student:profiles!student_id_cards_student_id_fkey(id, first_name, last_name, matric_number, student_level, role, department:departments(name, code, faculty:faculties(name))), tenant:tenants(name)`)
          .order('issued_at', { ascending: false })
          .limit(200),
        'The card register could not be loaded.',
      ),
    )) as Array<IdCard & { student?: Record<string, any> | null; tenant?: { name?: string } | null }>;
    return envelope(rows);
  },

  /** The card's printed half: whoever holds it needs the school and the person, not the row. */
  async printData() {
    const userId = await getCurrentUserId();
    const [{ data: profile, error }, session] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, first_name, last_name, matric_number, student_level, tenant_id, department:departments(name, code, faculty:faculties(name)), tenant:tenants(name, slug)')
        .eq('id', userId)
        .maybeSingle(),
      supabase.rpc('current_academic_session'),
    ]);
    if (error) throw toServiceError(error, 'Your card details could not be loaded.');
    if (!profile) throw new ServiceError('Your account has no profile yet.');

    const cards = unwrap<any[]>(
      await supabase
        .from('student_id_cards')
        .select(ID_CARD_SELECT)
        .eq('student_id', userId)
        .order('issued_at', { ascending: false })
        .limit(1),
      'Your ID card could not be loaded.',
    );
    return envelope({
      holder: camel(profile),
      card: camel(asArray(cards)[0] ?? null) as IdCard | null,
      session: camel(session.data ?? null) as { label: string; endsAt: string } | null,
    });
  },

  /**
   * A card is issued by the office, never printed by the student, so this is
   * administrator-only as far as the database is concerned - the page simply gives
   * them the button.
   */
  async issue(data: { studentId: string; photo?: File | null; validUntil?: string | null; sessionLabel?: string }) {
    if (!data.studentId) throw new ServiceError('Choose the student.');

    let photoPath: string | null = null;
    if (data.photo) {
      // 0017 insists the photo lives in this student's own folder.
      photoPath = `${data.studentId}/photo-${fileStamp()}-${storageSafeName(data.photo.name)}`;
      await uploadPrivateFile('id-card-photos', photoPath, data.photo, 5);
    }

    const row = unwrap(
      await supabase.rpc('issue_student_id_card', {
        p_student_id: data.studentId,
        p_photo_path: photoPath,
        p_valid_until: data.validUntil || null,
        p_session_label: data.sessionLabel?.trim() || null,
      }),
      'The ID card could not be issued.',
    );
    return envelope(camel(row) as IdCard);
  },

  async revoke(cardId: string, reason?: string) {
    if (!cardId) throw new ServiceError('Choose the card to withdraw.');
    const row = unwrap(
      await supabase.rpc('revoke_student_id_card', { p_card_id: cardId, p_reason: reason?.trim() || null }),
      'The card could not be withdrawn.',
    );
    return envelope(camel(row) as IdCard);
  },

  async verify(code: string) {
    const trimmed = code?.trim().toUpperCase();
    if (!/^[0-9A-F]{8}$/.test(trimmed ?? '')) {
      throw new ServiceError('A card number is the eight characters printed under the name.');
    }
    const result = camel<Record<string, any>>(
      unwrap<Record<string, any>>(
        await supabase.rpc('verify_id_card', { p_code: trimmed }),
        'That card number could not be checked.',
      ),
    );
    if (!result) throw new ServiceError('No card from this school carries that number.');
    return envelope(result);
  },

  async downloadPhoto(photoPath: string) {
    if (!photoPath) throw new ServiceError('This card has no photo.');
    return envelope(await signedDownloadUrl('id-card-photos', photoPath));
  },
};

export default { supabase };
