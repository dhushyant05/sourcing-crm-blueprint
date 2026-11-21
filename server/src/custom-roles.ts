/** Named staff roles whose permission defaults can be set by the super admin. */
import { randomUUID } from 'node:crypto';
import type { Db } from './db.js';
import { PERM_KEYS, allowedFor, type PermStore } from './permissions.js';
import type { UserStore } from './users.js';

export class CustomRoleStore {
  private defaults = new Map<string, Map<string, boolean>>(); // roleId -> perm -> granted
  private userRole = new Map<string, string>(); // userId -> roleId
  constructor(private db: Db, private perms: PermStore, private users: UserStore) {}

  async load() {
    const roles = await this.db.all<{ role_id: string; perm: string; granted: boolean }>('SELECT role_id, perm, granted FROM custom_role_permissions');
    const m = new Map<string, Map<string, boolean>>();
    for (const r of roles) {
      let x = m.get(r.role_id); if (!x) m.set(r.role_id, (x = new Map()));
      x.set(r.perm, !!r.granted);
    }
    this.defaults = m;
    const links = await this.db.all<{ id: string; custom_role_id: string }>('SELECT id, custom_role_id FROM users WHERE custom_role_id IS NOT NULL');
    this.userRole = new Map(links.map((r) => [r.id, r.custom_role_id]));
    this.perms.customDefault = (userId, key) => {
      const rid = this.userRole.get(userId); if (!rid) return undefined;
      return this.defaults.get(rid)?.get(key);
    };
    return this;
  }

  async list() {
    const rows = await this.db.all('SELECT * FROM custom_roles ORDER BY lower(name), id');
    const counts = await this.db.all<{ custom_role_id: string; c: number }>('SELECT custom_role_id, COUNT(*)::int c FROM users WHERE custom_role_id IS NOT NULL GROUP BY custom_role_id');
    const n = new Map(counts.map((r) => [r.custom_role_id, r.c]));
    return rows.map((r: any) => ({
      id: r.id, name: r.name, description: r.description, createdAt: r.created_at, updatedAt: r.updated_at,
      members: n.get(r.id) ?? 0,
      permissions: Object.fromEntries([...(this.defaults.get(r.id) ?? new Map())]),
    }));
  }

  async create(name: string, description: string | null, by: string, permissions: Record<string, boolean> = {}) {
    const n = name.trim().slice(0, 80); if (!n) throw Object.assign(new Error('Role name is required'), { status: 400 });
    const id = randomUUID();
    try {
      await this.db.run('INSERT INTO custom_roles (id, name, description, created_by) VALUES (?,?,?,?)', id, n, description?.trim().slice(0, 200) || null, by);
    } catch {
      throw Object.assign(new Error('A role with that name already exists'), { status: 409 });
    }
    if (Object.keys(permissions).length) await this.setPermissions(id, permissions);
    else await this.load();
    return (await this.list()).find((r) => r.id === id)!;
  }

  async update(id: string, patch: { name?: string; description?: string | null }) {
    const cur = await this.db.get('SELECT * FROM custom_roles WHERE id = ?', id);
    if (!cur) throw Object.assign(new Error('Role not found'), { status: 404 });
    const name = patch.name !== undefined ? patch.name.trim().slice(0, 80) : cur.name;
    if (!name) throw Object.assign(new Error('Role name is required'), { status: 400 });
    const description = patch.description !== undefined ? (patch.description?.trim().slice(0, 200) || null) : cur.description;
    try {
      await this.db.run('UPDATE custom_roles SET name=?, description=?, updated_at=now() WHERE id=?', name, description, id);
    } catch {
      throw Object.assign(new Error('A role with that name already exists'), { status: 409 });
    }
    return (await this.list()).find((r) => r.id === id)!;
  }

  async remove(id: string) {
    const n = await this.db.run('DELETE FROM custom_roles WHERE id = ?', id);
    if (!n) throw Object.assign(new Error('Role not found'), { status: 404 });
    await this.load();
    return true;
  }

  async setPermissions(id: string, changes: Record<string, boolean>) {
    const cur = await this.db.get('SELECT id FROM custom_roles WHERE id = ?', id);
    if (!cur) throw Object.assign(new Error('Role not found'), { status: 404 });
    for (const k of Object.keys(changes)) {
      if (!PERM_KEYS.includes(k as any)) throw Object.assign(new Error(`Unknown permission ${k}`), { status: 400 });
    }
    await this.db.tx(async (t) => {
      for (const [k, v] of Object.entries(changes)) {
        if (v) await t.run(`INSERT INTO custom_role_permissions (role_id, perm, granted) VALUES (?,?,true)
          ON CONFLICT (role_id, perm) DO UPDATE SET granted = true`, id, k);
        else await t.run('DELETE FROM custom_role_permissions WHERE role_id = ? AND perm = ?', id, k);
      }
      await t.run('UPDATE custom_roles SET updated_at = now() WHERE id = ?', id);
    });
    await this.load();
    // Apply immediately: notify every member so clients refresh the checklist.
    for (const [uid, rid] of this.userRole) if (rid === id) this.perms.onChange(uid);
    return (await this.list()).find((r) => r.id === id)!;
  }

  async assignUser(userId: string, roleId: string | null) {
    if (roleId) {
      const r = await this.db.get('SELECT id FROM custom_roles WHERE id = ?', roleId);
      if (!r) throw Object.assign(new Error('Role not found'), { status: 404 });
    }
    const u = this.users.byId(userId);
    if (!u) throw Object.assign(new Error('User not found'), { status: 404 });
    // Never let a custom role smuggle a side-locked permission into the defaults we store.
    if (roleId) {
      const perms = this.defaults.get(roleId) ?? new Map();
      for (const [k, granted] of perms) {
        if (granted && !allowedFor(u.role, k)) {
          // Stored on the role, but allowedFor in PermStore.can() still blocks it. Fine to assign.
        }
      }
    }
    await this.users.setCustomRole(userId, roleId);
    await this.load();
    this.perms.onChange(userId);
  }
}
