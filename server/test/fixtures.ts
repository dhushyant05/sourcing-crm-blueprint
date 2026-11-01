import { openMemoryDb, type Db } from '../src/db.js';
import { MemoryBus } from '../src/bus.js';
import { LeadStore, type Rec } from '../src/leads.js';
import { UserStore } from '../src/users.js';

/** Seed leads (same API shapes the apps use). */
export function fixtures(): Rec[] {
  return [
    { id: 'lead-india-1', name: 'Arora Home Store — Steel bottles', createdAt: '2026-10-01T00:00:00Z', clientName: 'Arora Home Store',
      contactPhone: { primaryPhoneNumber: '+919800000001' }, contactEmail: { primaryEmail: 'buyer@arora.in' },
      productInterest: 'Steel bottles', quantity: 500, targetPrice: { amountMicros: 220e6, currencyCode: 'INR' },
      sourceChannel: 'WHATSAPP', status: 'NEW', assignedOffice: 'INDIA', winLossReason: null, office: 'BOTH' },
    { id: 'lead-china-1', name: 'Mehta Kitchenware — Bamboo boards', createdAt: '2026-10-02T00:00:00Z', clientName: 'Mehta Kitchenware',
      contactPhone: { primaryPhoneNumber: '+919800000002' }, contactEmail: { primaryEmail: 'buyer@mehta.in' },
      productInterest: 'Bamboo boards', quantity: 1200, targetPrice: { amountMicros: 180e6, currencyCode: 'INR' },
      sourceChannel: 'REFERRAL', status: 'SOURCING', assignedOffice: 'CHINA', assignedChinaAgent: 'Li Wei',
      chatwootConversationUrl: { primaryLinkUrl: 'https://chat/1' }, office: 'BOTH' },
  ];
}

/** Direct access to the leads table for assertions (oldest first, like the old mock's arrays). */
export class LeadsAccess {
  constructor(readonly store: LeadStore) {}
  async list(_p = 'leads', filter?: Record<string, string>) { return (await this.store.list(filter)).reverse(); }
  get(_p: string, id: string) { return this.store.get(id); }
  create(_p: string, d: Rec) { return this.store.create(d); }
  update(_p: string, id: string, d: Rec) { return this.store.update(id, d); }
}

/** Fresh in-memory PostgreSQL (PGlite, real migrations) + in-memory bus, seeded with the fixture leads. */
export async function testEnv(seed = true) {
  const db: Db = await openMemoryDb();
  const bus = new MemoryBus();
  const store = new LeadStore(db);
  if (seed) for (const l of fixtures()) await store.create(l);
  const users = await new UserStore(db).load();
  return { db, bus, users, twenty: new LeadsAccess(store) };
}
