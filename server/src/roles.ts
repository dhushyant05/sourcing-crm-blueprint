export const ROLES = ['INDIA_STAFF', 'CHINA_STAFF', 'INDIA_ADMIN', 'CHINA_ADMIN', 'SUPER_ADMIN'] as const;
export type Role = (typeof ROLES)[number];
export const isRole = (r: unknown): r is Role => ROLES.includes(r as Role);

export interface Sides { india: boolean; china: boolean; admin: boolean; superAdmin: boolean }
export function sides(role: Role): Sides {
  const superAdmin = role === 'SUPER_ADMIN';
  return {
    india: superAdmin || role.startsWith('INDIA'),
    china: superAdmin || role.startsWith('CHINA'),
    admin: role.endsWith('ADMIN'),
    superAdmin,
  };
}

/** Roles a given role may create / edit / reset. Office admins manage their own side only. */
export function manageableRoles(role: Role): Role[] {
  switch (role) {
    case 'SUPER_ADMIN': return [...ROLES];
    case 'INDIA_ADMIN': return ['INDIA_STAFF', 'INDIA_ADMIN'];
    case 'CHINA_ADMIN': return ['CHINA_STAFF', 'CHINA_ADMIN'];
    default: return [];
  }
}

/** Capabilities returned to clients so web/mobile can render role-aware navigation. Enforcement is server-side. */
export function capabilities(role: Role) {
  const s = sides(role);
  return {
    customers: s.india, suppliers: s.china, rawCost: s.china, clientPricing: s.india,
    rates: s.superAdmin, backups: s.superAdmin, manageUsers: s.admin,
    currencies: [...(s.china ? ['CNY', 'USD'] : []), ...(s.india ? ['INR'] : [])],
  };
}
