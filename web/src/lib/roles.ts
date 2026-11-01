// Mirrors server/src/roles.ts capabilities(). Navigation only: the server strips fields/records per role.
export type Role = 'INDIA_STAFF' | 'CHINA_STAFF' | 'INDIA_ADMIN' | 'CHINA_ADMIN' | 'SUPER_ADMIN';
export const ROLES: Role[] = ['INDIA_STAFF', 'CHINA_STAFF', 'INDIA_ADMIN', 'CHINA_ADMIN', 'SUPER_ADMIN'];
export function perms(role: Role) {
  const india = role === 'SUPER_ADMIN' || role.startsWith('INDIA');
  const china = role === 'SUPER_ADMIN' || role.startsWith('CHINA');
  return {
    customers: india, suppliers: china, rawCost: china, clientPricing: india,
    backups: role === 'SUPER_ADMIN', manageUsers: role.endsWith('ADMIN'),
  };
}
export type Perms = ReturnType<typeof perms>;
