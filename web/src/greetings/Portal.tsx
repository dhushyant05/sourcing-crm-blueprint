import { useCallback, useEffect, useState } from 'react';
import type { PortalApi } from '../portal/api';
import { GreetingBanner, useGreeting } from './Banner';

/** Portal home banner (PORTAL surface). Artwork is fetched with the customer token and shown from blob URLs. */
export function PortalGreeting({ api }: { api: PortalApi }) {
  const load = useCallback(() => api.greetings(), [api]);
  const { greeting, close } = useGreeting('se.greet.portal', load);
  const [img, setImg] = useState<{ desktop: string | null; mobile: string | null } | null>(null);
  useEffect(() => {
    if (!greeting) return; let live = true; const urls: string[] = [];
    const get = async (p: string | null) => { if (!p) return null; try { const u = await api.blobUrl(p); urls.push(u); return u; } catch { return null; } };
    void Promise.all([get(greeting.imageDesktop), get(greeting.imageMobile)]).then(([desktop, mobile]) => { if (live) setImg({ desktop, mobile }); });
    return () => { live = false; urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [api, greeting]);
  if (!greeting || ((greeting.imageDesktop || greeting.imageMobile) && !img)) return null;
  if (greeting.layout === 'IMAGE' && !img?.desktop && !img?.mobile) return null;
  return <div className="mb-5"><GreetingBanner g={greeting} img={img ?? { desktop: null, mobile: null }} onClose={close} /></div>;
}
