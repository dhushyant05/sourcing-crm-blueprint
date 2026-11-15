/**
 * Supplier self-signup and verification.
 * A SUPPLIER login is linked to one catalog supplier card. Public supplier
 * details still follow consent + paid-membership rules on the catalog.
 */
import { randomUUID } from 'node:crypto';
import type { Db } from './db.js';
import type { User, UserStore } from './users.js';

export const SUPPLIER_MIN_PASSWORD = 8;
export const SUPPLIER_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'] as const;
export type SupplierStatus = (typeof SUPPLIER_STATUSES)[number];

export class SupplierAccountError extends Error {
  status: number; appCode?: string;
  constructor(message: string, status = 400, appCode?: string) { super(message); this.status = status; this.appCode = appCode; }
}
const bad = (m: string, s = 400, c?: string): never => { throw new SupplierAccountError(m, s, c); };

const clean = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const emailOk = (e: string) => /^[^@\s]+@[^@\s]+$/.test(e);

export function canReviewSuppliers(u: User) {
  return u.role === 'SUPER_ADMIN' || u.role === 'MARKETPLACE_TEAM';
}

export type SupplierProfile = {
  id: string; userId: string; supplierId: string; company: string; contactName: string;
  phone: string | null; email: string | null; status: SupplierStatus; rejectReason: string | null;
  reviewedBy: string | null; reviewedAt: string | null; createdAt: string; updatedAt: string;
  catalogConsent: boolean; publicRegion: string | null; publicAbout: string | null;
  publicYears: number | null; publicVerified: boolean;
};

const SEL = `SELECT p.id, p.user_id AS "userId", p.supplier_id AS "supplierId", p.company, p.contact_name AS "contactName",
  p.phone, p.email, p.status, p.reject_reason AS "rejectReason", p.reviewed_by AS "reviewedBy", p.reviewed_at AS "reviewedAt",
  p.created_at AS "createdAt", p.updated_at AS "updatedAt",
  s.catalog_consent AS "catalogConsent", s.public_region AS "publicRegion", s.public_about AS "publicAbout",
  s.public_years AS "publicYears", s.public_verified AS "publicVerified"
  FROM supplier_profiles p JOIN suppliers s ON s.id = p.supplier_id`;

export function ownView(row: SupplierProfile) {
  return {
    id: row.id, company: row.company, contactName: row.contactName, phone: row.phone, email: row.email,
    status: row.status, rejectReason: row.status === 'REJECTED' ? row.rejectReason : null,
    catalogConsent: !!row.catalogConsent, publicRegion: row.publicRegion, publicAbout: row.publicAbout,
    publicYears: row.publicYears == null ? null : Number(row.publicYears),
    publicVerified: !!row.publicVerified,
  };
}

export function reviewView(row: SupplierProfile & { loginEmail?: string; loginName?: string; loginActive?: boolean }) {
  return {
    ...ownView(row),
    supplierId: row.supplierId, userId: row.userId, loginEmail: row.loginEmail ?? row.email,
    loginName: row.loginName ?? null, loginActive: row.loginActive,
    rejectReason: row.rejectReason, reviewedAt: row.reviewedAt, createdAt: row.createdAt,
  };
}

export class SupplierAccountStore {
  constructor(private db: Db, private users: UserStore) {}

  async byUser(userId: string): Promise<SupplierProfile | null> {
    return (await this.db.get(`${SEL} WHERE p.user_id = ?`, userId)) as SupplierProfile | null;
  }
  async byId(id: string): Promise<SupplierProfile | null> {
    return (await this.db.get(`${SEL} WHERE p.id = ?`, id)) as SupplierProfile | null;
  }
  async list(status?: string) {
    const where = status && SUPPLIER_STATUSES.includes(status as SupplierStatus) ? 'AND p.status = ?' : '';
    const params: unknown[] = where ? [status] : [];
    return this.db.all(
      `SELECT p.id, p.user_id AS "userId", p.supplier_id AS "supplierId", p.company, p.contact_name AS "contactName",
        p.phone, p.email, p.status, p.reject_reason AS "rejectReason", p.reviewed_by AS "reviewedBy", p.reviewed_at AS "reviewedAt",
        p.created_at AS "createdAt", p.updated_at AS "updatedAt",
        s.catalog_consent AS "catalogConsent", s.public_region AS "publicRegion", s.public_about AS "publicAbout",
        s.public_years AS "publicYears", s.public_verified AS "publicVerified",
        u.email AS "loginEmail", u.name AS "loginName", u.active AS "loginActive"
       FROM supplier_profiles p
       JOIN suppliers s ON s.id = p.supplier_id
       JOIN users u ON u.id = p.user_id
       WHERE 1=1 ${where}
       ORDER BY p.created_at DESC`,
      ...params,
    ) as Promise<(SupplierProfile & { loginEmail: string; loginName: string; loginActive: boolean })[]>;
  }

  async signup(input: Record<string, unknown>) {
    const company = clean(input.company, 120);
    const contactName = clean(input.contactName ?? input.name, 120);
    const email = clean(input.email, 160).toLowerCase();
    const password = String(input.password ?? '');
    const phone = clean(input.phone, 40) || null;
    if (!company) bad('Company name is required');
    if (!contactName) bad('Contact name is required');
    if (!emailOk(email)) bad('A valid email is required', 400, 'email');
    if (password.length < SUPPLIER_MIN_PASSWORD) bad(`Password must be at least ${SUPPLIER_MIN_PASSWORD} characters`, 400, 'password');

    const consent = input.catalogConsent === true || input.catalogConsent === 'true';
    const region = clean(input.publicRegion, 80) || null;
    const about = clean(input.publicAbout, 2000) || null;
    const yearsRaw = input.publicYears == null || input.publicYears === '' ? null : Number(input.publicYears);
    const years = yearsRaw != null && Number.isFinite(yearsRaw) ? Math.max(0, Math.round(yearsRaw)) : null;

    let user;
    try { user = await this.users.create(email, contactName, 'SUPPLIER', password); }
    catch (e) {
      const msg = (e as Error).message;
      if (/already exists/i.test(msg)) bad('An account with that email already exists', 409, 'exists');
      throw e;
    }
    try {
      const supplierId = randomUUID();
      await this.db.run(
        `INSERT INTO suppliers (id, name, catalog_consent, consent_at, public_region, public_about, public_years, public_verified, created_by, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,now())`,
        supplierId, company, consent, consent ? new Date().toISOString() : null, region, about, years, false, user.id,
      );
      const profileId = randomUUID();
      await this.db.run(
        `INSERT INTO supplier_profiles (id, user_id, supplier_id, company, contact_name, phone, email, status)
         VALUES (?,?,?,?,?,?,?,'PENDING')`,
        profileId, user.id, supplierId, company, contactName, phone, email,
      );
    } catch (e) {
      await this.users.update(user.id, { active: false }).catch(() => undefined);
      throw e;
    }
    const profile = (await this.byUser(user.id)) ?? bad('Could not create the supplier profile', 500);
    return { user, profile };
  }

  async updateOwn(userId: string, patch: Record<string, unknown>) {
    const cur = (await this.byUser(userId)) ?? bad('Supplier profile not found', 404);
    const company = patch.company !== undefined ? clean(patch.company, 120) : cur.company;
    const contactName = patch.contactName !== undefined ? clean(patch.contactName, 120) : cur.contactName;
    if (!company) bad('Company name is required');
    if (!contactName) bad('Contact name is required');
    const phone = patch.phone !== undefined ? (clean(patch.phone, 40) || null) : cur.phone;
    const consent = patch.catalogConsent === undefined ? !!cur.catalogConsent : (patch.catalogConsent === true || patch.catalogConsent === 'true');
    const region = patch.publicRegion !== undefined ? (clean(patch.publicRegion, 80) || null) : cur.publicRegion;
    const about = patch.publicAbout !== undefined ? (clean(patch.publicAbout, 2000) || null) : cur.publicAbout;
    let years: number | null = cur.publicYears == null ? null : Number(cur.publicYears);
    if (patch.publicYears !== undefined) {
      if (patch.publicYears == null || patch.publicYears === '') years = null;
      else {
        years = Math.max(0, Math.round(Number(patch.publicYears)));
        if (!Number.isFinite(years)) bad('Years in business must be a number');
      }
    }
    await this.db.run('UPDATE supplier_profiles SET company = ?, contact_name = ?, phone = ?, updated_at = now() WHERE id = ?',
      company, contactName, phone, cur.id);
    await this.db.run(
      `UPDATE suppliers SET name = ?, catalog_consent = ?,
        consent_at = CASE WHEN ? THEN coalesce(consent_at, now()) ELSE consent_at END,
        public_region = ?, public_about = ?, public_years = ? WHERE id = ?`,
      company, consent, consent, region, about, years, cur.supplierId,
    );
    if (contactName !== cur.contactName) await this.users.update(userId, { name: contactName });
    return (await this.byUser(userId))!;
  }

  async verify(id: string, by: string) {
    const cur = (await this.byId(id)) ?? bad('Application not found', 404);
    await this.db.run(`UPDATE supplier_profiles SET status = 'VERIFIED', reject_reason = null, reviewed_by = ?, reviewed_at = now(), updated_at = now() WHERE id = ?`, by, id);
    return (await this.byId(id))!;
  }
  async reject(id: string, by: string, reason: string) {
    const cur = (await this.byId(id)) ?? bad('Application not found', 404);
    const why = clean(reason, 500);
    if (!why) bad('A reason is required to reject a supplier');
    await this.db.run(`UPDATE supplier_profiles SET status = 'REJECTED', reject_reason = ?, reviewed_by = ?, reviewed_at = now(), updated_at = now() WHERE id = ?`, why, by, id);
    return (await this.byId(id))!;
  }
  async resubmit(userId: string) {
    const cur = (await this.byUser(userId)) ?? bad('Supplier profile not found', 404);
    if (cur.status !== 'REJECTED') bad('Only a rejected application can be sent back for review');
    await this.db.run(`UPDATE supplier_profiles SET status = 'PENDING', reject_reason = null, reviewed_by = null, reviewed_at = null, updated_at = now() WHERE id = ?`, cur.id);
    return (await this.byUser(userId))!;
  }
}
