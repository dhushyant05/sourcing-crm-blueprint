import { useState } from 'react';
import { useApp } from '../lib/store';
import { staffReq } from '../catalog/api';

export function SupplierStatus() {
  const { session, updateSession } = useApp();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rejected = session?.supplierStatus === 'DECLINED' || session?.supplierStatus === 'REJECTED';
  const resubmit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await staffReq<{ data: { status: 'PENDING' | 'APPROVED' | 'DECLINED' | 'VERIFIED' | 'REJECTED' } }>('POST', '/api/supplier/me/resubmit', {});
      updateSession({ supplierStatus: r.data.status, supplierRejectReason: null });
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div className="mx-auto max-w-lg py-10" data-testid="supplier-status">
      <h1 className="text-2xl font-semibold text-ink-800">{rejected ? 'Your application was not approved' : 'Your application is being reviewed'}</h1>
      <p className="mt-3 text-ink-600">
        {rejected
          ? (session?.supplierRejectReason ? `Reason: ${session.supplierRejectReason}` : 'Update your details in Settings if needed, then send it back for review.')
          : 'The Marketplace Team will verify your supplier account. You can add products once it is approved.'}
      </p>
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      {rejected && (
        <button className="btn-primary mt-6" disabled={busy} onClick={() => void resubmit()} data-testid="supplier-resubmit">
          {busy ? 'Sending…' : 'Send for review again'}
        </button>
      )}
    </div>
  );
}
