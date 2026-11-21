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
import { ChatPage } from './pages/Chat';
import { Greetings } from './pages/Greetings';
import { Landing } from './pages/Landing';
import { Marketplace } from './catalog/Marketplace';
import { publicCatalog } from './catalog/api';
import { Products } from './pages/Products';
import { SupplierAccess } from './pages/SupplierAccess';
import { SupplierApplications } from './pages/SupplierApplications';
import { SupplierStatus } from './pages/SupplierStatus';
import { Banners } from './pages/Banners';
import { DownloadPage } from './pages/Download';
import { Portal } from './portal/Portal';
import type { Lead } from './lib/types';

const routes: Route[] = ['dashboard', 'leads', 'quotations', 'orders', 'shipping', 'customers', 'suppliers', 'greetings', 'products', 'banners', 'applications', 'chat', 'users', 'settings'];
const hashRoute = () => location.hash.replace(/^#\/?/, '').split('?')[0];
const hashQuery = () => new URLSearchParams(location.hash.split('?')[1] || '');
const fromHash = (fallback: Route = 'dashboard'): Route => (routes.find((r) => r === hashRoute()) ?? fallback);

function Shell() {
  const { session, perms, api } = useApp();
  const catalogOnly = session?.role === 'MARKETPLACE_TEAM' || session?.role === 'SUPPLIER';
  const isSupplier = session?.role === 'SUPPLIER';
  const supplierReady = !isSupplier || session?.supplierStatus === 'APPROVED';
  const canReviewSuppliers = session?.role === 'SUPER_ADMIN' || session?.role === 'MARKETPLACE_TEAM';
  const [route, setRoute] = useState<Route>(() => fromHash(catalogOnly ? 'products' : 'dashboard'));
  const [search, setSearch] = useState('');
  const [lead, setLead] = useState<Lead | null>(null);
  const go = (r: Route) => { location.hash = `/${r}`; };
  useEffect(() => { const h = () => setRoute(fromHash(catalogOnly ? 'products' : 'dashboard')); addEventListener('hashchange', h); return () => removeEventListener('hashchange', h); }, [catalogOnly]);
  useEffect(() => {
    const open = () => {
      if (hashRoute() !== 'leads') return;
      const id = hashQuery().get('id');
      if (id) void api.lead(id).then((l) => l && setLead(l)).catch(() => undefined);
    };
    open();
    addEventListener('hashchange', open);
    return () => removeEventListener('hashchange', open);
  }, [api]);
  useEffect(() => {
    if (isSupplier && !['products', 'settings'].includes(route)) go('products');
    else if (catalogOnly && !['products', 'banners', 'applications', 'chat', 'settings'].includes(route)) go('products');
  }, [catalogOnly, isSupplier, route]);
  if (!session) return <Login />;
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
      {route === 'products' && perms.can('catalog.edit') && (supplierReady ? <Products /> : <SupplierStatus />)}
      {route === 'banners' && perms.can('catalog.banners') && <Banners />}
      {route === 'applications' && canReviewSuppliers && <SupplierApplications />}
      {route === 'chat' && session?.role !== 'SUPPLIER' && <ChatPage openLead={setLead} />}
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
const isSupplierPath = () => /^\/supplier(\/|$)/.test(location.pathname);

function PublicSite() {
  const [mode, setMode] = useState<'loading' | 'landing' | 'market'>('loading');
  useEffect(() => { publicCatalog.status().then((s) => setMode(s.showMarketplace ? 'market' : 'landing')).catch(() => setMode('landing')); }, []);
  if (mode === 'loading') return <div className="min-h-screen bg-white" />;
  return mode === 'market' ? <Marketplace /> : <Landing />;
}

export default function App() { if (isPortal()) return <Portal />; return <AppProvider>{isDownload() ? <DownloadPage /> : isSupplierPath() ? <SupplierAccess /> : isApp() ? <Shell /> : <PublicSite />}</AppProvider>; }
