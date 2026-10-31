// Mirrors mobile/lib/core/roles.dart. Presentation-level only (see README).
export type Role = 'INDIA_STAFF' | 'CHINA_STAFF' | 'INDIA_ADMIN' | 'CHINA_ADMIN' | 'SUPER_ADMIN';
export const roleLabel: Record<Role, string> = {
  INDIA_STAFF: 'India staff', CHINA_STAFF: 'China staff', INDIA_ADMIN: 'India admin', CHINA_ADMIN: 'China admin', SUPER_ADMIN: 'Super admin',
};
export function perms(role: Role) {
  const india = role === 'SUPER_ADMIN' || role.startsWith('INDIA');
  const china = role === 'SUPER_ADMIN' || role.startsWith('CHINA');
  return {
    customers: india, suppliers: china, rawCost: china, clientPricing: india,
    rates: role.endsWith('ADMIN'), backups: role === 'SUPER_ADMIN',
    currencies: [...(china ? (['CNY', 'USD'] as const) : []), ...(india ? (['INR'] as const) : [])],
  };
}
export type Perms = ReturnType<typeof perms>;
