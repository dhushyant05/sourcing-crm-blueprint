import { useState } from 'react';
import { HardDriveDownload, ShieldCheck } from 'lucide-react';
import { useApp, useLoad } from '../lib/store';
import { label, ratesFrom } from '../lib/currency';
import { roleLabel } from '../lib/roles';
import { Chip, PageHeader, Skeleton } from '../components/ui';

const PAIRS = ['CNY_INR', 'USD_INR', 'USD_CNY'];
const pairLabel = (p: string) => p.split('_').map(label).join(' → ');

export function Settings() {
  const { api, perms, session } = useApp();
  const { data, reload } = useLoad(() => api.rates(), [api]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const current = data ? ratesFrom(data) : null;
  const backups = useLoad(() => (perms.backups ? api.backups() : Promise.resolve([])), [api, perms.backups]);

  const save = async (p: string) => {
    const v = Number(draft[p]);
    if (!v || v <= 0) return;
    await api.setRate(p, v, session?.name ?? 'admin');
    setDraft((d) => ({ ...d, [p]: '' }));
    reload();
  };

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card p-6">
          <h2 className="font-semibold text-ink-900 dark:text-white">Profile</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div><dt className="text-ink-500">Name</dt><dd className="font-medium">{session?.name}</dd></div>
            <div><dt className="text-ink-500">Email</dt><dd className="font-medium">{session?.email}</dd></div>
            <div><dt className="text-ink-500">Role</dt><dd className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-500/10 dark:text-brand-200"><ShieldCheck size={13} />{session && roleLabel[session.role]}</dd></div>
          </dl>
        </section>

        <section className="card p-6 lg:col-span-2">
          <h2 className="font-semibold text-ink-900 dark:text-white">Exchange rates</h2>
          <p className="text-sm text-ink-500">Prices stay in the quoted currency; the server converts India views to INR with the latest rate. Only the super admin can set rates.</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {PAIRS.map((p) => (
              <div key={p} className="rounded-xl border border-ink-200 p-4 dark:border-ink-800">
                <div className="text-xs text-ink-500">{pairLabel(p)}</div>
                {current ? <div className="mt-1 text-xl font-semibold tabular-nums">{current[p as keyof typeof current] ?? '—'}</div> : <Skeleton className="mt-2 h-7 w-16" />}
                {perms.rates && (
                  <div className="mt-3 flex gap-2">
                    <input className="input py-1.5" inputMode="decimal" placeholder="New rate" value={draft[p] ?? ''} onChange={(e) => setDraft({ ...draft, [p]: e.target.value })} />
                    <button className="btn-primary px-3 py-1.5" onClick={() => save(p)}>Set</button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <h3 className="mt-6 text-xs font-medium uppercase tracking-wide text-ink-400">History</h3>
          <ul className="mt-2 divide-y divide-ink-100 text-sm dark:divide-ink-800">
            {data?.slice(0, 6).map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2.5"><span className="w-32 text-ink-600 dark:text-ink-300">{pairLabel(r.pair)}</span><span className="font-medium tabular-nums">{r.rate}</span><span className="text-ink-500">{r.effectiveDate} · {r.setBy}</span><span className="ml-auto">{r.manual && <Chip value="OVERRIDE" />}</span></li>
            ))}
          </ul>
        </section>

        {perms.backups && (
          <section className="card p-6 lg:col-span-3">
            <div className="flex items-start gap-4">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10"><HardDriveDownload size={20} /></div>
              <div><h2 className="font-semibold text-ink-900 dark:text-white">Backups</h2>
                <p className="text-sm text-ink-500">Nightly dumps of Twenty and Chatwoot are kept on the storage server (7 daily, 4 weekly). Downloads are available to the super admin in the backup browser; restores run from the command line with <code className="rounded bg-ink-100 px-1 dark:bg-ink-800">restore.sh</code>.</p>
                <div className="mt-3 flex flex-wrap gap-2">{backups.data?.map((b) => <a key={b.url} href={b.url} target="_blank" rel="noreferrer" className="btn-outline">{b.label}</a>)}</div></div>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
