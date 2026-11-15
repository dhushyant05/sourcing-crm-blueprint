import { useEffect, useState, type FormEvent } from 'react';
import { PageHeader } from '../components/ui';
import { staffReq } from '../catalog/api';

type Application = {
  id: string; company: string; contactName: string; email?: string | null; phone?: string | null;
  status: string; displayStatus?: string; rejectReason?: string | null; loginEmail?: string; createdAt?: string;
  catalogConsent?: boolean; publicRegion?: string | null; publicAbout?: string | null;
  publicYears?: number | null; publicVerified?: boolean; loginActive?: boolean;
};

const label = (r: Application) => {
  const d = r.displayStatus || (r.publicVerified && r.status === 'APPROVED' ? 'VERIFIED' : r.status);
  if (d === 'PENDING') return 'Pending';
  if (d === 'APPROVED') return 'Approved';
  if (d === 'DECLINED' || d === 'REJECTED') return 'Declined';
  if (d === 'VERIFIED') return 'Verified';
  return d;
};
const badge = (r: Application) => {
  const d = r.displayStatus || r.status;
  if (d === 'PENDING') return 'bg-amber-50 text-amber-800';
  if (d === 'APPROVED') return 'bg-sky-50 text-sky-800';
  if (d === 'DECLINED' || d === 'REJECTED') return 'bg-rose-50 text-rose-800';
  return 'bg-emerald-50 text-emerald-800';
};

export function SupplierApplications() {
  const [rows, setRows] = useState<Application[]>([]);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<Application | null>(null);
  const [declining, setDeclining] = useState<Application | null>(null);
  const [reason, setReason] = useState('');

  const load = async () => {
    const r = await staffReq<{ data: Application[] }>('GET', `/api/supplier/applications${status ? `?status=${status}` : ''}`);
    setRows(r.data);
  };
  useEffect(() => { void load().catch((e) => setErr((e as Error).message)); }, [status]); // eslint-disable-line

  const act = async (id: string, path: string, body: Record<string, unknown> = {}) => {
    setErr(null); setBusy(id);
    try {
      await staffReq('POST', `/api/supplier/applications/${id}/${path}`, body);
      setDeclining(null); setReason('');
      await load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  };

  const actions = (r: Application) => {
    const approved = r.status === 'APPROVED';
    const declined = r.status === 'DECLINED' || r.status === 'REJECTED';
    const verified = !!r.publicVerified;
    const wait = busy === r.id;
    return (
      <div className="flex flex-wrap gap-2" data-testid={`application-actions-${r.id}`}>
        <button type="button" className="btn-outline min-h-10 !px-3 text-sm" disabled={wait} onClick={() => setEditing(r)} data-testid="edit-supplier">Edit</button>
        {!approved && <button type="button" className="btn-primary min-h-10 !px-3 text-sm" disabled={wait} onClick={() => void act(r.id, 'accept')} data-testid="accept-supplier">Accept</button>}
        {!declined && <button type="button" className="btn-outline min-h-10 !px-3 text-sm text-red-600" disabled={wait} onClick={() => { setReason(r.rejectReason ?? ''); setDeclining(r); }} data-testid="decline-supplier">Decline</button>}
        {approved && !verified && <button type="button" className="btn-primary min-h-10 !px-3 text-sm" disabled={wait} onClick={() => void act(r.id, 'verify', { verified: true })} data-testid="verify-supplier">Mark as verified</button>}
        {verified && <button type="button" className="btn-outline min-h-10 !px-3 text-sm" disabled={wait} onClick={() => void act(r.id, 'verify', { verified: false })} data-testid="unverify-supplier">Remove verified</button>}
      </div>
    );
  };

  const details = (r: Application) => (
    <>
      <div className="font-medium text-ink-900">{r.company}</div>
      <div className="text-xs text-ink-500">{r.loginEmail || r.email}{r.publicRegion ? ` · ${r.publicRegion}` : ''}{r.catalogConsent ? ' · consented' : ''}</div>
      <div className="text-sm text-ink-700">{r.contactName}{r.phone ? ` · ${r.phone}` : ''}</div>
    </>
  );

  return (
    <>
      <PageHeader title="Supplier applications" />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} data-testid="applications-filter">
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="DECLINED">Declined</option>
          <option value="VERIFIED">Verified</option>
        </select>
      </div>
      {err && <p className="mb-3 text-sm text-red-600">{err}</p>}

      {/* Mobile: stacked cards so action buttons stay visible */}
      <div className="space-y-3 md:hidden" data-testid="supplier-applications-cards">
        {rows.map((r) => (
          <article key={r.id} className="rounded-2xl border border-ink-200 bg-white p-4" data-testid={`application-${r.id}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">{details(r)}</div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${badge(r)}`}>{label(r)}</span>
            </div>
            {r.rejectReason && (r.status === 'DECLINED' || r.status === 'REJECTED') && <p className="mt-2 text-xs text-ink-500">Reason: {r.rejectReason}</p>}
            <div className="mt-3">{actions(r)}</div>
          </article>
        ))}
        {!rows.length && <p className="rounded-2xl border border-ink-200 bg-white px-4 py-8 text-center text-ink-500">No supplier applications yet.</p>}
      </div>

      <div className="hidden overflow-x-auto rounded-2xl border border-ink-200 bg-white md:block">
        <table className="w-full text-sm" data-testid="supplier-applications">
          <thead className="bg-ink-50 text-left text-ink-500">
            <tr><th className="px-4 py-3">Company</th><th>Contact</th><th>Status</th><th className="px-4 py-3">Actions</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-ink-100 align-top" data-testid={`application-${r.id}`}>
                <td className="px-4 py-3">{details(r)}</td>
                <td className="py-3 text-ink-700">{r.contactName}{r.phone ? ` · ${r.phone}` : ''}</td>
                <td className="py-3">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badge(r)}`}>{label(r)}</span>
                  {r.rejectReason && (r.status === 'DECLINED' || r.status === 'REJECTED') && <div className="mt-1 text-xs text-ink-500">{r.rejectReason}</div>}
                </td>
                <td className="px-4 py-3">{actions(r)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={4} className="px-4 py-8 text-center text-ink-500">No supplier applications yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {declining && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4" role="dialog" aria-modal="true" data-testid="decline-dialog" onClick={() => setDeclining(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-ink-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-ink-900">Decline this supplier?</h2>
            <p className="mt-2 text-sm text-ink-600">They will not be able to sign in or add products. You can accept them again later.</p>
            <label className="mt-4 block text-sm text-ink-700">Reason (optional)
              <textarea className="input mt-1 min-h-[80px]" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="decline-reason" />
            </label>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" className="btn-outline min-h-10" onClick={() => setDeclining(null)}>Cancel</button>
              <button type="button" className="btn-primary min-h-10 !bg-red-600" disabled={busy === declining.id} onClick={() => void act(declining.id, 'decline', { reason })} data-testid="confirm-decline">Decline</button>
            </div>
          </div>
        </div>
      )}

      {editing && <EditDialog row={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />}
    </>
  );
}

function EditDialog({ row, onClose, onSaved }: { row: Application; onClose: () => void; onSaved: () => Promise<void> }) {
  const [f, setF] = useState({
    company: row.company, contactName: row.contactName, phone: row.phone ?? '', email: row.email ?? '',
    publicRegion: row.publicRegion ?? '', publicYears: row.publicYears == null ? '' : String(row.publicYears),
    publicAbout: row.publicAbout ?? '', catalogConsent: !!row.catalogConsent,
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));
  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await staffReq('PATCH', `/api/supplier/applications/${row.id}`, {
        company: f.company, contactName: f.contactName, phone: f.phone, email: f.email,
        publicRegion: f.publicRegion, publicYears: f.publicYears, publicAbout: f.publicAbout, catalogConsent: f.catalogConsent,
      });
      await onSaved();
    } catch (err) { setErr((err as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4" role="dialog" aria-modal="true" data-testid="edit-supplier-dialog" onClick={onClose}>
      <form className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl dark:bg-ink-900" onClick={(e) => e.stopPropagation()} onSubmit={(e) => void save(e)}>
        <h2 className="text-lg font-semibold text-ink-900">Edit supplier</h2>
        <div className="mt-4 space-y-3">
          <input className="input" required placeholder="Company name" value={f.company} onChange={(e) => set('company', e.target.value)} data-testid="edit-company" />
          <input className="input" required placeholder="Contact name" value={f.contactName} onChange={(e) => set('contactName', e.target.value)} />
          <input className="input" placeholder="Phone" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
          <input className="input" type="email" placeholder="Contact email" value={f.email} onChange={(e) => set('email', e.target.value)} />
          <input className="input" placeholder="Public location" value={f.publicRegion} onChange={(e) => set('publicRegion', e.target.value)} />
          <input className="input" placeholder="Years in business" value={f.publicYears} onChange={(e) => set('publicYears', e.target.value)} />
          <textarea className="input min-h-[80px]" placeholder="Public about" value={f.publicAbout} onChange={(e) => set('publicAbout', e.target.value)} />
          <label className="flex items-start gap-2 text-sm text-ink-600">
            <input type="checkbox" className="mt-1" checked={f.catalogConsent} onChange={(e) => set('catalogConsent', e.target.checked)} />
            Show a public catalog card to paying members (when they have consented)
          </label>
        </div>
        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-outline min-h-10" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary min-h-10" disabled={busy} data-testid="save-supplier">Save changes</button>
        </div>
      </form>
    </div>
  );
}
