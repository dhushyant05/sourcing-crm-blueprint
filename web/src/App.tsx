import { useEffect, useState } from 'react';
import { AppProvider, useApp } from './lib/store';
import { Layout, type Route } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { LeadPanel, Leads } from './pages/Leads';
import { Quotations } from './pages/Quotations';
import { Orders } from './pages/Orders';
import { Shipping } from './pages/Shipping';
import { Suppliers } from './pages/Suppliers';
import { Customers } from './pages/Customers';
import { Settings } from './pages/Settings';
import { Login } from './pages/Login';
import { Team } from './pages/Team';
import { Greetings } from './pages/Greetings';
import { Landing } from './pages/Landing';
import { DownloadPage } from './pages/Download';
import { Portal } from './portal/Portal';
import type { Lead } from './lib/types';

const routes: Route[] = ['dashboard', 'leads', 'quotations', 'orders', 'shipping', 'customers', 'suppliers', 'greetings', 'users', 'settings'];
const fromHash = (): Route => (routes.find((r) => location.hash === `#/${r}`) ?? 'dashboard');

function Shell() {
  const { session, perms, api } = useApp();
  const [route, setRoute] = useState<Route>(fromHash);
  const [search, setSearch] = useState('');
  const [lead, setLead] = useState<Lead | null>(null);
  useEffect(() => { const h = () => setRoute(fromHash()); addEventListener('hashchange', h); return () => removeEventListener('hashchange', h); }, []);
  if (!session) return <Login />;
  const go = (r: Route) => { location.hash = `/${r}`; };
  return (
    <Layout openLeadId={(id) => { void api.lead(id).then((l) => l && setLead(l)); }} route={route} go={go} search={search} setSearch={(s) => { setSearch(s); if (s && route === 'dashboard') go('leads'); }}>
      {route === 'dashboard' && <Dashboard openLead={setLead} />}
      {route === 'leads' && <Leads search={search} openLead={setLead} />}
      {route === 'quotations' && perms.can('quotes.view') && <Quotations search={search} openLead={setLead} />}
      {route === 'orders' && <Orders search={search} openLead={setLead} />}
      {route === 'shipping' && <Shipping search={search} openLead={setLead} />}
      {route === 'customers' && perms.customers && perms.can('customers.view') && <Customers search={search} openLead={(id) => { void api.lead(id).then((l) => l && setLead(l)); }} />}
      {route === 'suppliers' && perms.suppliers && perms.can('suppliers.view') && <Suppliers search={search} />}
      {route === 'greetings' && perms.can('greetings.manage') && <Greetings />}
      {route === 'users' && perms.manageUsers && <Team />}
      {route === 'settings' && <Settings />}
      <LeadPanel lead={lead} onClose={() => setLead(null)} />
    </Layout>
  );
}

// Public site at "/", the staff app at /app (also /login). Old hash links (/#/leads) still open the app.
const isApp = () => /^\/(app|login)(\/|$)/.test(location.pathname) || location.hash.startsWith('#/');

const isDownload = () => /^\/download\/?$/.test(location.pathname);
// Customer portal at /portal: its own login realm, English only.
const isPortal = () => /^\/portal(\/|$)/.test(location.pathname);

export default function App() { if (isPortal()) return <Portal />; return <AppProvider>{isDownload() ? <DownloadPage /> : isApp() ? <Shell /> : <Landing />}</AppProvider>; }
