/**
 * Backfill the shared lead reference (SE-YYMM-NNNN) on existing leads, oldest first, numbered within
 * each lead's creation month, then copy it onto sourcing requests, quotations and shipments.
 * Idempotent: leads that already have a reference keep it; the counter never goes backwards.
 *
 *   TWENTY_URL=... TWENTY_API_KEY=... REFS_FILE=./data/refs.json npx tsx scripts/backfill-refs.ts [--dry-run]
 */
import { RefCounter } from '../src/refs.js';
import { TwentyRest, type TwentyLike } from '../src/twenty.js';

export async function backfill(t: TwentyLike, refs: RefCounter, dry: boolean, log: (s: string) => void = () => {}) {
  const leads = await t.list('leads');
  leads.forEach((l) => refs.seen(l.leadRef));
  const refOf = new Map<string, string>();
  let n = 0, children = 0;
  for (const l of [...leads].sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')))) {
    let ref = l.leadRef as string | undefined;
    if (!ref) {
      ref = await refs.next(l.createdAt ? new Date(String(l.createdAt)) : new Date());
      log(`${l.id} -> ${ref}`); n++;
      if (!dry) await t.update('leads', String(l.id), { leadRef: ref });
    }
    refOf.set(String(l.id), ref);
  }
  const fix = async (plural: string, ref: (r: Record<string, unknown>) => string | undefined) => {
    for (const r of await t.list(plural)) {
      const want = ref(r);
      if (want && r.leadRef !== want) { children++; log(`${plural}/${r.id} -> ${want}`); if (!dry) await t.update(plural, String(r.id), { leadRef: want }); r.leadRef = want; }
      if (plural !== 'shippingOrders') srRef.set(`${plural}:${r.id}`, (want ?? r.leadRef) as string);
    }
  };
  const srRef = new Map<string, string>();
  await fix('sourcingRequests', (r) => refOf.get(String(r.leadId)));
  await fix('quotations', (r) => srRef.get(`sourcingRequests:${r.sourcingRequestId}`));
  await fix('shippingOrders', (r) => refOf.get(String(r.leadId)) ?? srRef.get(`quotations:${r.quotationId}`));
  return { leads: n, children };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dry = process.argv.includes('--dry-run');
  const t = new TwentyRest(process.env.TWENTY_URL ?? 'http://localhost:3000', process.env.TWENTY_API_KEY ?? '');
  const r = await backfill(t, new RefCounter(dry ? undefined : process.env.REFS_FILE ?? './data/refs.json'), dry, console.log);
  console.log(`${dry ? '[dry run] ' : ''}${r.leads} leads numbered, ${r.children} related records updated`);
}
