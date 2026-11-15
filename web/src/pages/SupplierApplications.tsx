import { useEffect, useState } from 'react';
import { PageHeader } from '../components/ui';
import { staffReq } from '../catalog/api';

type Application = {
  id: string; company: string; contactName: string; email?: string | null; phone?: string | null;
  status: string; rejectReason?: string | null; loginEmail?: string; createdAt?: string;
  catalogConsent?: boolean; publicRegion?: string | null; publicYears?: number | null;
};

export function SupplierApplications() {
  const [rows, setRows] = useState<Application[]>([]);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const r = await staffReq<{ data: Application[] }>('GET', `/api/supplier/applications${status ? `?status=${status}` : ''}`);
    setRows(r.data);
  };
  useEffect(() => { void load().catch((e) => setErr((e as Error).message)); }, [status]); // eslint-disable-line

  const act = async (id: string, kind: 'verify' | 'reject') => {
    setErr(null); setBusy(id);
    try {
      if (kind === 'reject' && !reason[id]?.trim()) { setErr('A reason is required to reject a supplier'); return; }
      await staffReq('POST', `/api/supplier/applications/${id}/${kind}`, kind === 'reject' ? { reason: reason[id] } : {});
      await load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  };

  return (
    <>
      <PageHeader title="Supplier applications" />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} data-testid="applications-filter">
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="VERIFIED">Verified</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </div>
      {err && <p className="mb-3 text-sm text-red-600">{err}</p>}
      <div className="overflow-hidden rounded-2xl border border-ink-200 bg-white">
        <table className="w-full text-sm" data-testid="supplier-applications">
          <thead className="bg-ink-50 text-left text-ink-500">
            <tr><th className="px-4 py-3">Company</th><th>Contact</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-ink-100" data-testid={`application-${r.id}`}>
                <td className="px-4 py-3">
                  <div className="font-medium text-ink-900">{r.company}</div>
                  <div className="text-xs text-ink-500">{r.loginEmail || r.email}{r.publicRegion ? ` · ${r.publicRegion}` : ''}{r.catalogConsent ? ' · consented' : ''}</div>
                </td>
                <td className="text-ink-700">{r.contactName}{r.phone ? ` · ${r.phone}` : ''}</td>
                <td className="text-ink-600">{r.status}{r.rejectReason ? ` — ${r.rejectReason}` : ''}</td>
                <td className="px-4 py-3 text-right">
                  {r.status !== 'VERIFIED' && (
                    <div className="flex flex-wrap justify-end gap-2">
                      <button className="btn-primary !py-1 text-xs" disabled={busy === r.id} onClick={() => void act(r.id, 'verify')} data-testid="verify-supplier">Verify</button>
                      <input className="input max-w-[12rem] !py-1 text-xs" placeholder="Reason for rejection" value={reason[r.id] ?? ''} onChange={(e) => setReason((s) => ({ ...s, [r.id]: e.target.value }))} />
                      <button className="btn-outline !py-1 text-xs text-red-600" disabled={busy === r.id} onClick={() => void act(r.id, 'reject')} data-testid="reject-supplier">Reject</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={4} className="px-4 py-8 text-center text-ink-500">No supplier applications yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
