import { useEffect, useState } from 'react';
import { AppProvider, useApp } from './lib/store';
import { Layout, type Route } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { LeadPanel, Leads } from './pages/Leads';
import { Quotations } from './pages/Quotations';
import { Shipping } from './pages/Shipping';
import { Suppliers } from './pages/Suppliers';
import { Settings } from './pages/Settings';
import { Login } from './pages/Login';
import { Team } from './pages/Team';
import { Landing } from './pages/Landing';
import { DownloadPage } from './pages/Download';
import type { Lead } from './lib/types';

const routes: Route[] = ['dashboard', 'leads', 'quotations', 'shipping', 'suppliers', 'users', 'settings'];
const fromHash = (): Route => (routes.find((r) => location.hash === `#/${r}`) ?? 'dashboard');

function Shell() {
  const { session, perms } = useApp();
  const [route, setRoute] = useState<Route>(fromHash);
  const [search, setSearch] = useState('');
  const [lead, setLead] = useState<Lead | null>(null);
  useEffect(() => { const h = () => setRoute(fromHash()); addEventListener('hashchange', h); return () => removeEventListener('hashchange', h); }, []);
  if (!session) return <Login />;
  const go = (r: Route) => { location.hash = `/${r}`; };
  return (
    <Layout route={route} go={go} search={search} setSearch={(s) => { setSearch(s); if (s && route === 'dashboard') go('leads'); }}>
      {route === 'dashboard' && <Dashboard openLead={setLead} />}
      {route === 'leads' && <Leads search={search} openLead={setLead} />}
      {route === 'quotations' && <Quotations search={search} />}
      {route === 'shipping' && <Shipping search={search} />}
      {route === 'suppliers' && perms.suppliers && <Suppliers search={search} />}
      {route === 'users' && perms.manageUsers && <Team />}
      {route === 'settings' && <Settings />}
      <LeadPanel lead={lead} onClose={() => setLead(null)} />
    </Layout>
  );
}

// Public site at "/", the staff app at /app (also /login). Old hash links (/#/leads) still open the app.
const isApp = () => /^\/(app|login)(\/|$)/.test(location.pathname) || location.hash.startsWith('#/');

const isDownload = () => /^\/download\/?$/.test(location.pathname);

export default function App() { return <AppProvider>{isDownload() ? <DownloadPage /> : isApp() ? <Shell /> : <Landing />}</AppProvider>; }
