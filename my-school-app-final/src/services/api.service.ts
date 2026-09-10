import api from './api';

export const authService = {
  register: (firstName: string, lastName: string, email: string, password: string) =>
    api.post('/auth/register', { firstName, lastName, email, password }),

  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),

  // Refresh token travels via httpOnly cookie - nothing to pass here.
  refresh: () =>
    api.post('/auth/refresh'),

  logout: () =>
    api.post('/auth/logout'),

  updateProfile: (fullName: string, phone: string) =>
    api.put('/auth/profile', { fullName, phone }),
};

export const adminService = {
  getEnrollmentAnalytics: () =>
    api.get('/admin/analytics/enrollments'),

  getFeeCollectionAnalytics: () =>
    api.get('/admin/analytics/fees'),

  getAttendanceAnalytics: () =>
    api.get('/admin/analytics/attendance'),

  listStudents: (params?: { limit?: number; cursor?: string }) =>
    api.get('/admin/students', { params }),

  createStudent: (firstName: string, lastName: string, email: string) =>
    api.post('/admin/students', { firstName, lastName, email }),
  updateStudent: (id: string, data: Partial<{ firstName: string; lastName: string; email: string; active: boolean; studentStatus: 'ACTIVE' | 'INACTIVE' | 'ON_PROBATION'; admittedYear: number | null; studentLevel: string; departmentId: string | null }>) =>
    api.put(`/admin/students/${id}`, data),
  deleteStudent: (id: string) => api.delete(`/admin/students/${id}`),

  listTeachers: () =>
    api.get('/admin/teachers'),

  createTeacher: (firstName: string, lastName: string, email: string) =>
    api.post('/admin/teachers', { firstName, lastName, email }),
  updateTeacher: (id: string, data: Partial<{ firstName: string; lastName: string; email: string; active: boolean }>) =>
    api.put(`/admin/teachers/${id}`, data),
  deleteTeacher: (id: string) => api.delete(`/admin/teachers/${id}`),

  bulkImportStudents: (sourceName: string, lines: Array<{ email: string; firstName: string; lastName: string }>) =>
    api.post('/admin/students/import', { sourceName, lines }),

  getAuditLogs: (params?: { limit?: number; cursor?: string }) =>
    api.get('/admin/audit-logs', { params }),
  listFaculties: () => api.get('/admin/faculties'),
  createFaculty: (name: string) => api.post('/admin/faculties', { name }),
  listDepartments: () => api.get('/admin/departments'),
  createDepartment: (name: string, code: string, facultyId: string) => api.post('/admin/departments', { name, code, facultyId }),
};

export const academicsService = {
  listCourses: () => api.get('/academics/courses'),
  getCourseHierarchy: () => api.get('/academics/course-hierarchy'),
  createCourse: (title: string, code: string, description: string, teacherIds?: string[], level?: string) =>
    api.post('/academics/courses', { title, code, description, teacherIds, level }),
  updateCourse: (id: string, data: Partial<{ title: string; code: string; description: string; teacherIds: string[]; level: string; departmentId: string | null }>) =>
    api.put(`/academics/courses/${id}`, data),
  deleteCourse: (id: string) => api.delete(`/academics/courses/${id}`),
  enrollStudent: (courseId: string, studentId: string) =>
    api.post(`/academics/courses/${courseId}/enroll`, { studentId }),
  listCourseEnrollments: (courseId: string) => api.get(`/academics/courses/${courseId}/enrollments`),
  listAvailableCourses: () => api.get('/academics/courses/available'),
  requestCourseEnrollment: (courseId: string) => api.post(`/academics/courses/${courseId}/request-enrollment`),
  listPendingEnrollments: () => api.get('/academics/enrollments/pending'),
  reviewEnrollment: (enrollmentId: string, status: 'ACTIVE' | 'REJECTED') => api.patch(`/academics/enrollments/${enrollmentId}/review`, { status }),

  listClassSections: () => api.get('/academics/classes'),
  createClassSection: (name: string, grade: string, homeroomTeacherId?: string) =>
    api.post('/academics/classes', { name, grade, homeroomTeacherId }),
  listClassSectionStudents: (id: string) => api.get(`/academics/classes/${id}/students`),
  addStudentToClassSection: (id: string, studentId: string) =>
    api.post(`/academics/classes/${id}/students`, { studentId }),

  listTimetable: (params?: { classSectionId?: string; courseId?: string }) =>
    api.get('/academics/timetable', { params }),
  createTimetableSlot: (data: {
    courseId: string;
    classSectionId: string;
    teacherId: string;
    dayOfWeek: number;
    startsAt: string;
    endsAt: string;
    room: string;
  }) => api.post('/academics/timetable', data),
  deleteTimetableSlot: (id: string) => api.delete(`/academics/timetable/${id}`),
  listDepartmentTimetable: () => api.get('/academics/department-timetable'),
  createDepartmentTimetableSlot: (data: { courseId: string; departmentId: string; dayOfWeek: number; startHour: number }) => api.post('/academics/department-timetable', data),
  deleteDepartmentTimetableSlot: (id: string) => api.delete(`/academics/department-timetable/${id}`),
};

export const attendanceService = {
  list: (params?: { classSectionId?: string; date?: string }) =>
    api.get('/attendance', { params }),
  mark: (classSectionId: string, date: string, records: Array<{ studentId: string; status: string; notes?: string }>) =>
    api.post('/attendance', { classSectionId, date, records }),
};

export const gradesService = {
  listPeriods: (courseId?: string) => api.get('/grades/periods', { params: { courseId } }),
  createPeriod: (courseId: string, name: string, startsAt: string, endsAt: string) =>
    api.post('/grades/periods', { courseId, name, startsAt, endsAt }),

  listEntries: (params?: { courseId?: string; gradePeriodId?: string }) =>
    api.get('/grades/entries', { params }),
  upsertEntry: (enrollmentId: string, gradePeriodId: string, score: number, letterGrade?: string, comments?: string) =>
    api.post('/grades/entries', { enrollmentId, gradePeriodId, score, letterGrade, comments }),
};

export const feesService = {
  listStructures: () => api.get('/fees/structures'),
  createStructure: (name: string, amount: number, frequency: string) =>
    api.post('/fees/structures', { name, amount, frequency }),

  listInvoices: (studentId?: string) => api.get('/fees/invoices', { params: { studentId } }),
  createInvoice: (studentId: string, dueDate: string, lines: Array<{ description: string; amount: number }>) =>
    api.post('/fees/invoices', { studentId, dueDate, lines }),
  recordPayment: (invoiceId: string, amount: number, method: string, transactionId?: string) =>
    api.post(`/fees/invoices/${invoiceId}/payments`, { amount, method, transactionId }),
};

export const notificationsService = {
  list: () => api.get('/notifications'),
  markRead: (id: string) => api.patch(`/notifications/${id}/read`),
  markAllRead: () => api.patch('/notifications/read-all'),
};

export default api;

export const siteSettingsService = {
  // Publicly fetch settings for welcome page
  getPublic: (tenantSlug = 'pinnacle-school') => api.get(`/site-settings/public`, { params: { tenantSlug } }),

  // Protected endpoints for admins
  get: () => api.get('/site-settings'),
  update: (formData: FormData) => api.post('/site-settings', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  getWelcomeMessage: () => api.get('/site-settings/welcome-message'),
  updateWelcomeMessage: (welcomeMessage: string, welcomeMessageColor: string) => api.put('/site-settings/welcome-message', { welcomeMessage, welcomeMessageColor }),
  getWelcomeBackgrounds: () => api.get('/site-settings/welcome-backgrounds'),
  updateWelcomeBackgrounds: (formData: FormData) => api.put('/site-settings/welcome-backgrounds', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
};
