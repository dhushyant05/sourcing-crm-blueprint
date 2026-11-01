/** Minimal client for Twenty's REST data API (`/rest/<plural>`). Only the server holds the API key. */
export type Rec = Record<string, unknown>;

export interface TwentyLike {
  list(plural: string, filter?: Record<string, string>): Promise<Rec[]>;
  get(plural: string, id: string): Promise<Rec | null>;
  create(plural: string, data: Rec): Promise<Rec>;
  update(plural: string, id: string, data: Rec): Promise<Rec>;
}

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
    const f = filter && Object.keys(filter).length
      ? `&filter=${encodeURIComponent(Object.entries(filter).map(([k, v]) => `${k}[eq]:${JSON.stringify(v)}`).join(','))}` : '';
    let cursor: string | undefined;
    for (let page = 0; page < 50; page++) {
      const j = await this.req('GET', `${plural}?limit=200&depth=0${f}${cursor ? `&starting_after=${encodeURIComponent(cursor)}` : ''}`);
      out.push(...((j?.data?.[plural] as Rec[]) ?? []));
      if (!j?.pageInfo?.hasNextPage) break;
      cursor = j.pageInfo.endCursor;
    }
    return out;
  }
  async get(plural: string, id: string) {
    const j = await this.req('GET', `${plural}/${encodeURIComponent(id)}?depth=0`);
    return (j?.data?.[singular(plural)] as Rec) ?? null;
  }
  async create(plural: string, data: Rec) {
    const j = await this.req('POST', plural, data);
    return (j?.data?.[`create${cap(singular(plural))}`] as Rec) ?? j?.data ?? {};
  }
  async update(plural: string, id: string, data: Rec) {
    const j = await this.req('PATCH', `${plural}/${encodeURIComponent(id)}`, data);
    return (j?.data?.[`update${cap(singular(plural))}`] as Rec) ?? j?.data ?? {};
  }
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
