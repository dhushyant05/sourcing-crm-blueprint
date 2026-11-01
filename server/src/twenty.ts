/** Minimal client for Twenty's REST data API (`/rest/<plural>`). Only the server holds the API key. */
export type Rec = Record<string, unknown>;

export interface TwentyLike {
  list(plural: string, filter?: Record<string, string>): Promise<Rec[]>;
  get(plural: string, id: string): Promise<Rec | null>;
  create(plural: string, data: Rec): Promise<Rec>;
  update(plural: string, id: string, data: Rec): Promise<Rec>;
  remove?(plural: string, id: string): Promise<void>;
}

/**
 * Source Easy field name -> Twenty field name, where Twenty reserves the name (v2.x: `currency`, `role`).
 * The rename happens only here, so the API contract to web/mobile keeps the original names.
 */
export const FIELD_RENAMES: Record<string, Record<string, string>> = {
  quotations: { currency: 'costCurrency' },
  teamMembers: { role: 'seRole' },
};
const remap = (r: Rec | null | undefined, m: Record<string, string> | undefined): Rec | null | undefined => {
  if (!r || !m) return r;
  const o: Rec = {};
  for (const [k, v] of Object.entries(r)) o[m[k] ?? k] = v;
  return o;
};
const inverse = (m?: Record<string, string>) => (m ? Object.fromEntries(Object.entries(m).map(([a, b]) => [b, a])) : undefined);
export const toTwenty = (plural: string, r: Rec) => remap(r, FIELD_RENAMES[plural]) as Rec;
export const fromTwenty = (plural: string, r: Rec | null) => remap(r, inverse(FIELD_RENAMES[plural])) as Rec | null;

const singular = (p: string) => (p.endsWith('ies') ? p.slice(0, -3) + 'y' : p.replace(/s$/, ''));

export class TwentyRest implements TwentyLike {
  constructor(private baseUrl: string, private apiKey: string, private fetchImpl: typeof fetch = fetch) {}

  private async req(method: string, path: string, body?: unknown): Promise<any> {
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}/rest/${path}`, {
      method,
      headers: { authorization: `Bearer ${this.apiKey}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404) return null;
    const text = await res.text();
    if (!res.ok) throw Object.assign(new Error(`Twenty ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`), { status: 502 });
    return text ? JSON.parse(text) : null;
  }

  async list(plural: string, filter?: Record<string, string>): Promise<Rec[]> {
    const out: Rec[] = [];
    filter = filter && toTwenty(plural, filter) as Record<string, string>;
    const f = filter && Object.keys(filter).length
      ? `&filter=${encodeURIComponent(Object.entries(filter).map(([k, v]) => `${k}[eq]:${JSON.stringify(v)}`).join(','))}` : '';
    let cursor: string | undefined;
    for (let page = 0; page < 50; page++) {
      const j = await this.req('GET', `${plural}?limit=200&depth=0${f}${cursor ? `&starting_after=${encodeURIComponent(cursor)}` : ''}`);
      out.push(...((j?.data?.[plural] as Rec[]) ?? []).map((r) => fromTwenty(plural, r) as Rec));
      if (!j?.pageInfo?.hasNextPage) break;
      cursor = j.pageInfo.endCursor;
    }
    return out;
  }
  async get(plural: string, id: string) {
    const j = await this.req('GET', `${plural}/${encodeURIComponent(id)}?depth=0`);
    return fromTwenty(plural, (j?.data?.[singular(plural)] as Rec) ?? null);
  }
  async create(plural: string, data: Rec) {
    const j = await this.req('POST', plural, toTwenty(plural, data));
    return fromTwenty(plural, (j?.data?.[`create${cap(singular(plural))}`] as Rec) ?? j?.data ?? {}) as Rec;
  }
  async update(plural: string, id: string, data: Rec) {
    const j = await this.req('PATCH', `${plural}/${encodeURIComponent(id)}`, toTwenty(plural, data));
    return fromTwenty(plural, (j?.data?.[`update${cap(singular(plural))}`] as Rec) ?? j?.data ?? {}) as Rec;
  }
  async remove(plural: string, id: string) { await this.req('DELETE', `${plural}/${encodeURIComponent(id)}`); }
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
