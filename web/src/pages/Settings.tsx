import { Coins, HardDriveDownload, KeyRound, ShieldCheck } from 'lucide-react';
import { SlaSettingsCard } from '../components/Workflow';
import { useEffect, useState, type FormEvent } from 'react';
import { AvatarEditor } from '../components/AvatarEditor';
import { useTranslation } from 'react-i18next';
import { useApp, useLoad } from '../lib/store';
import { CURRENCIES, label, symbol } from '../lib/currency';
import { PageHeader } from '../components/ui';
import { StorageCard } from '../components/Storage';
import { staffReq } from '../catalog/api';
import { LanguageSwitch } from '../components/LanguageSwitch';

export function Settings() {
  const { api, perms, session, updateSession, refreshPeople } = useApp();
  const { t } = useTranslation();
  const backups = useLoad(() => (perms.backups ? api.backups() : Promise.resolve([])), [api, perms.backups]);
  return (
    <>
      <PageHeader title={t('settings.title')} />
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card p-6">
          <h2 className="font-semibold text-ink-900 dark:text-white">{t('settings.profile')}</h2>
          {!session?.demo && <div className="mt-4"><AvatarEditor name={session?.name ?? ''} src={session?.avatarUrl}
            onSave={async (b) => { updateSession({ avatarUrl: await api.setAvatar(b) }); refreshPeople(); }}
            onRemove={async () => { await api.removeAvatar(); updateSession({ avatarUrl: null }); refreshPeople(); }} /></div>}
          <dl className="mt-4 space-y-3 text-sm">
            <div><dt className="text-ink-500">{t('common.name')}</dt><dd className="font-medium">{session?.name}</dd></div>
            <div><dt className="text-ink-500">{t('common.email')}</dt><dd className="font-medium">{session?.email}</dd></div>
            <div><dt className="text-ink-500">{t('common.role')}</dt><dd className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-500/10 dark:text-brand-200"><ShieldCheck size={13} />{session && t(`role.${session.role}`)}</dd></div>
            <div><dt className="text-ink-500">{t('lang.label')}</dt><dd className="mt-1"><LanguageSwitch className="w-fit" /><p className="mt-1 text-xs text-ink-400">{t('settings.languageHint')}</p></dd></div>
          </dl>
        </section>
        {!session?.demo && <PasswordCard />}
        {!session?.demo && <SlaSettingsCard />}
        {!session?.demo && perms.can('data.export') && api.exportCsv && <div className="card p-5" data-testid="export-card">
          <h2 className="font-semibold text-ink-900 dark:text-white">{t('perm.export')}</h2><p className="mt-1 text-sm text-ink-500">{t('perm.exportHint')}</p>
          <div className="mt-3 flex flex-wrap gap-2">{(['leads', 'quotes', 'orders', 'shipments'] as const).map((k) => <button key={k} data-testid={`export-${k}`} className="btn-outline !py-1 text-sm" onClick={() => void api.exportCsv!(k).catch((e) => alert((e as Error).message))}>{t(`nav.${k === 'shipments' ? 'shipping' : k === 'quotes' ? 'quotations' : k}`)} CSV</button>)}</div>
        </div>}
        <section className="card p-6 lg:col-span-2">
          <h2 className="flex items-center gap-2 font-semibold text-ink-900 dark:text-white"><Coins size={18} className="text-ink-400" />{t('settings.currencies')}</h2>
          <p className="mt-1 text-sm text-ink-500">{t('settings.currenciesHint')}</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {CURRENCIES.map((c) => (
              <div key={c} className="rounded-xl border border-ink-200 p-4 dark:border-ink-800">
                <div className="text-2xl font-semibold">{symbol(c)}</div><div className="mt-1 text-sm text-ink-500">{label(c)}{c === 'CNY' && ' (CNY)'}</div>
              </div>
            ))}
          </div>
        </section>
        {perms.backups && (
          <section className="card p-6 lg:col-span-3">
            <div className="flex items-start gap-4">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10"><HardDriveDownload size={20} /></div>
              <div><h2 className="font-semibold text-ink-900 dark:text-white">{t('settings.backups')}</h2>
                <p className="text-sm text-ink-500">{t('settings.backupsHint')}</p>
                <div className="mt-3 flex flex-wrap gap-2">{backups.data?.map((b) => <a key={b.url} href={b.url} target="_blank" rel="noreferrer" className="btn-outline">{b.label}</a>)}</div></div>
            </div>
          </section>
        )}
      </div>
      {session?.role === 'SUPER_ADMIN' && api.notificationOutbox && <Outbox />}
      {session?.role === 'SUPER_ADMIN' && <CatalogSettingsCard />}
      {session?.role === 'SUPER_ADMIN' && api.storage && <StorageCard />}
    </>
  );
}

function PasswordCard() {
  const { api, replaceToken } = useApp();
  const { t } = useTranslation();
  const [f, setF] = useState({ cur: '', next: '', conf: '' }), [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setMsg(null);
    if (f.next.length < 10) return setMsg({ ok: false, text: t('pw.min') });
    if (f.next !== f.conf) return setMsg({ ok: false, text: t('pw.mismatch') });
    setBusy(true);
    try { replaceToken(await api.changePassword(f.cur, f.next)); setF({ cur: '', next: '', conf: '' }); setMsg({ ok: true, text: t('pw.done') }); }
    catch (err) { setMsg({ ok: false, text: /current/i.test((err as Error).message) ? t('pw.wrong') : (err as Error).message }); }
    finally { setBusy(false); }
  };
  return (
    <section className="card p-6">
      <h2 className="flex items-center gap-2 font-semibold text-ink-900 dark:text-white"><KeyRound size={18} className="text-ink-400" />{t('pw.title')}</h2>
      <p className="mt-1 text-sm text-ink-500">{t('pw.hint')}</p>
      <form className="mt-4 space-y-3" onSubmit={(e) => void submit(e)} data-testid="pw-form">
        <input className="input" type="password" autoComplete="current-password" placeholder={t('pw.current')} value={f.cur} onChange={(e) => setF({ ...f, cur: e.target.value })} required data-testid="pw-current" />
        <input className="input" type="password" autoComplete="new-password" placeholder={t('pw.new')} value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} required data-testid="pw-new" />
        <input className="input" type="password" autoComplete="new-password" placeholder={t('pw.confirm')} value={f.conf} onChange={(e) => setF({ ...f, conf: e.target.value })} required data-testid="pw-confirm" />
        <button className="btn-primary" disabled={busy} data-testid="pw-submit">{t('pw.submit')}</button>
        {msg && <p className={msg.ok ? 'text-sm text-emerald-600' : 'text-sm text-red-600'} data-testid="pw-msg">{msg.text}</p>}
      </form>
    </section>
  );
}

/** Super admin: customer notification outbox (read-only; nothing is sent while no provider is configured). */
function Outbox() {
  const { api } = useApp(); const { t } = useTranslation();
  const [d, setD] = useState<Awaited<ReturnType<NonNullable<typeof api.notificationOutbox>>> | null>(null), [err, setErr] = useState<string | null>(null);
  useEffect(() => { void api.notificationOutbox!().then(setD).catch((e) => setErr((e as Error).message)); }, [api]);
  const when = (s: string) => new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) + ' IST';
  return (
    <section className="card mt-6 p-6" data-testid="outbox">
      <h2 className="font-semibold text-ink-900 dark:text-white">{t('outbox.title')}</h2>
      <p className="mt-1 text-sm text-ink-500">{t('outbox.intro')}</p>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {d && <><p className="mt-2 text-xs text-ink-600">{t('outbox.email')}: {t(d.email ? 'outbox.on' : 'outbox.off')} · {t('outbox.push')}: {t(d.push ? 'outbox.on' : 'outbox.off')}</p>
        {!d.rows.length ? <p className="mt-2 text-sm text-ink-500">{t('outbox.none')}</p> : <div className="mt-3 max-h-96 overflow-auto"><table className="w-full text-xs"><thead><tr className="text-left text-ink-500">
          {(['at', 'channel', 'template', 'customer', 'status', 'reason'] as const).map((c) => <th key={c} className="pr-3">{t(`outbox.col.${c}`)}</th>)}</tr></thead>
          <tbody>{d.rows.map((r) => <tr key={r.id} className="border-t border-ink-100 dark:border-ink-800"><td className="py-1 pr-3">{when(r.createdAt)}</td><td className="pr-3">{r.channel}</td><td className="pr-3">{r.template}</td>
            <td className="pr-3 font-mono">{r.label || r.reference || ''}</td><td className="pr-3">{r.status}</td><td>{r.reason ?? ''}</td></tr>)}</tbody></table></div>}</>}
    </section>
  );
}

function CatalogSettingsCard() {
  const { session } = useApp();
  const [homepageEnabled, setHomepageEnabled] = useState(false);
  const [direction, setDirection] = useState<'LTR' | 'RTL'>('LTR');
  const [interval, setInterval] = useState(5);
  const [trust, setTrust] = useState([{ title: 'Sourced in China', text: 'Quoted and managed by Source Easy' }, { title: 'Two offices', text: 'India and China working as one team' }, { title: 'Prices you can compare', text: 'Switch between USD, RMB and INR' }, { title: 'Quality on request', text: 'Factory visits and checks when you need them' }]);
  const [promoOn, setPromoOn] = useState(true);
  const [promoText, setPromoText] = useState('Sourcing from China — request a quote from the Source Easy team');
  const [promoHref, setPromoHref] = useState('/#contact');
  const [msg, setMsg] = useState<string | null>(null);
  const demo = !!session?.demo;
  useEffect(() => {
    if (demo) { setHomepageEnabled(true); return; }
    void staffReq<{ data: any }>('GET', '/api/catalog/settings').then((r) => {
      setHomepageEnabled(!!r.data.homepageEnabled);
      setDirection(r.data.direction === 'RTL' ? 'RTL' : 'LTR');
      setInterval(Number(r.data.intervalSeconds) || 5);
      if (Array.isArray(r.data.trust) && r.data.trust.length) setTrust(r.data.trust);
      if (r.data.promo) { setPromoOn(r.data.promo.enabled !== false); if (r.data.promo.text) setPromoText(r.data.promo.text); if (r.data.promo.href) setPromoHref(r.data.promo.href); }
    }).catch(() => undefined);
  }, [demo]);
  const save = async () => {
    if (demo) { setMsg('Saved in demo (not sent to the server).'); return; }
    await staffReq('PATCH', '/api/catalog/settings', { homepageEnabled, bannerDirection: direction, bannerIntervalSeconds: interval, trustItems: trust, promo: { enabled: promoOn, text: promoText, href: promoHref } });
    setMsg('Marketplace settings saved.');
  };
  const seed = async () => {
    if (demo) { setMsg('Demo already includes sample products.'); return; }
    const r = await staffReq<{ data: { products: number; banners: number } }>('POST', '/api/catalog/samples/seed', {});
    setMsg(`Added ${r.data.products} sample products and ${r.data.banners} banners. Turn the homepage on when you are ready.`);
  };
  const remove = async () => {
    if (!confirm('Remove every sample product and sample banner? This is a soft delete; you can restore products individually.')) return;
    if (demo) { setMsg('Samples would be removed on a live server.'); return; }
    const r = await staffReq<{ data: { products: number; banners: number } }>('POST', '/api/catalog/samples/remove', {});
    setMsg(`Removed ${r.data.products} sample products.`);
  };
  return (
    <section className="card mt-6 p-6" data-testid="catalog-settings">
      <h2 className="font-semibold text-ink-900 dark:text-white">Marketplace</h2>
      <p className="mt-1 text-sm text-ink-500">The public catalog stays hidden until this switch is on and at least one product is published. Sample products are added only when you ask — they are labelled Sample and can be removed in one action.</p>
      <label className="mt-4 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={homepageEnabled} onChange={(e) => setHomepageEnabled(e.target.checked)} /> Show the marketplace as the homepage
      </label>
      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-2">Banner direction
          <select className="input w-auto" value={direction} onChange={(e) => setDirection(e.target.value as 'LTR' | 'RTL')}>
            <option value="LTR">Left to right</option>
            <option value="RTL">Right to left</option>
          </select>
        </label>
        <label className="flex items-center gap-2">Interval (seconds)
          <input className="input w-20" type="number" min={3} max={10} value={interval} onChange={(e) => setInterval(Number(e.target.value))} />
        </label>
      </div>
      <div className="mt-4 space-y-2">
        <p className="text-sm font-medium text-ink-800">Top promo strip</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={promoOn} onChange={(e) => setPromoOn(e.target.checked)} /> Show the promo strip</label>
        <input className="input" value={promoText} onChange={(e) => setPromoText(e.target.value)} placeholder="Promo text (no invented numbers or discounts)" />
        <input className="input" value={promoHref} onChange={(e) => setPromoHref(e.target.value)} placeholder="Link, for example /#contact" />
      </div>
      <div className="mt-4 space-y-2">
        <p className="text-sm font-medium text-ink-800">Trust strip (no invented numbers)</p>
        {trust.map((it, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-2">
            <input className="input" value={it.title} onChange={(e) => setTrust((xs) => xs.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} placeholder="Title" />
            <input className="input" value={it.text} onChange={(e) => setTrust((xs) => xs.map((x, j) => j === i ? { ...x, text: e.target.value } : x))} placeholder="Short text" />
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn-primary" onClick={() => void save().catch((e) => setMsg((e as Error).message))}>Save settings</button>
        <button className="btn-outline" onClick={() => void seed().catch((e) => setMsg((e as Error).message))}>Add sample products</button>
        <button className="btn-outline text-red-600" onClick={() => void remove().catch((e) => setMsg((e as Error).message))}>Remove all samples</button>
      </div>
      {msg && <p className="mt-3 text-sm text-ink-600">{msg}</p>}
    </section>
  );
}
