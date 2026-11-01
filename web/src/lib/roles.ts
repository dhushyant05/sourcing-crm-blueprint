// Mirrors server/src/roles.ts + permissions.ts. Navigation only: the server enforces every permission (403) and strips fields.
export type Role = 'INDIA_STAFF' | 'CHINA_STAFF' | 'INDIA_ADMIN' | 'CHINA_ADMIN' | 'SUPER_ADMIN';
export const ROLES: Role[] = ['INDIA_STAFF', 'CHINA_STAFF', 'INDIA_ADMIN', 'CHINA_ADMIN', 'SUPER_ADMIN'];
export const PERM_KEYS = ['suppliers.view', 'suppliers.edit', 'quotes.view', 'quotes.create', 'quotes.customer', 'prices.inr', 'orders.create', 'orders.production',
  'orders.payment', 'reports.view', 'data.export', 'leads.all', 'leads.delete', 'staff.manage', 'settings.sla'] as const;
export type PermKey = (typeof PERM_KEYS)[number];
const INDIA_STAFF: PermKey[] = ['quotes.view', 'quotes.customer', 'prices.inr', 'orders.create', 'orders.production', 'orders.payment', 'leads.all'];
const CHINA_STAFF: PermKey[] = ['suppliers.view', 'suppliers.edit', 'quotes.view', 'quotes.create', 'orders.production', 'leads.all'];
const ADMIN: PermKey[] = ['reports.view', 'staff.manage', 'data.export'];
export const ROLE_DEFAULTS: Record<Role, readonly PermKey[]> = {
  INDIA_STAFF, CHINA_STAFF, INDIA_ADMIN: [...INDIA_STAFF, ...ADMIN], CHINA_ADMIN: [...CHINA_STAFF, ...ADMIN], SUPER_ADMIN: PERM_KEYS,
};
/** `granted` = effective permissions from /api/me (falls back to the role defaults, e.g. in the demo). */
export function perms(role: Role, granted?: readonly string[] | null) {
  const india = role === 'SUPER_ADMIN' || role.startsWith('INDIA');
  const china = role === 'SUPER_ADMIN' || role.startsWith('CHINA');
  const set = new Set<string>(role === 'SUPER_ADMIN' ? PERM_KEYS : granted ?? ROLE_DEFAULTS[role]);
  const can = (k: PermKey) => set.has(k);
  return {
    customers: india, suppliers: china, rawCost: china, clientPricing: india && can('prices.inr'),
    backups: role === 'SUPER_ADMIN', manageUsers: can('staff.manage'), can,
  };
}
export type Perms = ReturnType<typeof perms>;
