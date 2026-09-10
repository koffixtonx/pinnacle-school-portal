export type Role = 'SUPER_ADMIN' | 'SCHOOL_ADMIN' | 'TEACHER' | 'STUDENT' | 'NON_ACADEMIC_STAFF';

export interface CurrentUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  role: Role;
}

const ADMIN_ROLES: Role[] = ['SUPER_ADMIN', 'SCHOOL_ADMIN'];

export function useCurrentUser(): CurrentUser | null {
  const raw = localStorage.getItem('user');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CurrentUser;
  } catch {
    return null;
  }
}

export function isAdminRole(role?: Role | null): boolean {
  return !!role && ADMIN_ROLES.includes(role);
}
