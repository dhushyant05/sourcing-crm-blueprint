// Mirrors server/src/roles.ts + permissions.ts. Navigation only: the server enforces every permission (403) and strips fields.
export type Role = 'INDIA_STAFF' | 'CHINA_STAFF' | 'INDIA_ADMIN' | 'CHINA_ADMIN' | 'SUPER_ADMIN' | 'MARKETPLACE_TEAM' | 'SUPPLIER';
export const ROLES: Role[] = ['INDIA_STAFF', 'CHINA_STAFF', 'INDIA_ADMIN', 'CHINA_ADMIN', 'SUPER_ADMIN', 'MARKETPLACE_TEAM', 'SUPPLIER'];
export const PERM_KEYS = ['customers.view', 'customers.edit', 'suppliers.view', 'suppliers.edit', 'quotes.view', 'quotes.create', 'quotes.customer', 'prices.inr', 'orders.create', 'orders.production',
  'orders.payment', 'reports.view', 'data.export', 'leads.all', 'leads.delete', 'staff.manage', 'settings.sla', 'portal.logins.manage',
  'greetings.manage', 'greetings.publish', 'catalog.edit', 'catalog.price', 'catalog.publish', 'catalog.delete', 'catalog.banners', 'chat.view_own', 'chat.view_team', 'chat.view_all', 'chat.start', 'chat.reference_quotes', 'chat.send_attachments', 'chat.manage_canned', 'chat.see_customer_fields', 'chat.see_supplier_fields'] as const;
export type PermKey = (typeof PERM_KEYS)[number];
const INDIA_STAFF: PermKey[] = ['quotes.view', 'quotes.customer', 'prices.inr', 'orders.create', 'orders.production', 'orders.payment', 'leads.all', 'catalog.edit', 'catalog.price', 'catalog.delete', 'chat.view_own', 'chat.start', 'chat.reference_quotes', 'chat.send_attachments', 'chat.see_customer_fields'];
const CHINA_STAFF: PermKey[] = ['suppliers.view', 'suppliers.edit', 'quotes.view', 'quotes.create', 'orders.production', 'leads.all', 'catalog.edit', 'chat.view_own', 'chat.start', 'chat.reference_quotes', 'chat.send_attachments', 'chat.see_supplier_fields'];
const ADMIN: PermKey[] = ['reports.view', 'staff.manage', 'data.export', 'chat.view_team', 'chat.manage_canned'];
const MARKETPLACE_TEAM: PermKey[] = ['catalog.edit', 'catalog.delete', 'catalog.publish', 'catalog.price', 'chat.view_own', 'chat.view_team', 'chat.reference_quotes', 'chat.see_supplier_fields'];
const SUPPLIER: PermKey[] = ['catalog.edit', 'catalog.delete'];
export const ROLE_DEFAULTS: Record<Role, readonly PermKey[]> = {
  INDIA_STAFF, CHINA_STAFF, INDIA_ADMIN: [...INDIA_STAFF, ...ADMIN, 'catalog.publish', 'customers.view', 'customers.edit', 'portal.logins.manage', 'greetings.manage'], CHINA_ADMIN: [...CHINA_STAFF, ...ADMIN], SUPER_ADMIN: PERM_KEYS, MARKETPLACE_TEAM, SUPPLIER,
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
