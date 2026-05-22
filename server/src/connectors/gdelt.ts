// GDELT 2.0 DOC API: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
// Free, no key. Returns recent global news articles in JSON.
import { sha256 } from '../lib/crypto.js';
import { cache } from '../lib/cache.js';
import type { SourceConnector, CanonicalMentionDraft, IngestionContext, ConnectorHealth } from './types.js';

const BASE = 'https://api.gdeltproject.org/api/v2/doc/doc';

export const gdeltConnector: SourceConnector = {
  platform: 'gdelt',

  async testConnection(): Promise<ConnectorHealth> {
    try {
      const url = `${BASE}?query=test&mode=ArtList&maxrecords=1&format=json`;
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) return { ok: false, status: 'failed', message: `GDELT HTTP ${r.status}` };
      return { ok: true, status: 'active', message: 'GDELT reachable' };
    } catch (e) {
      return { ok: false, status: 'failed', message: `GDELT error: ${(e as Error).message}` };
    }
  },

  async fetchMentions(ctx: IngestionContext): Promise<CanonicalMentionDraft[]> {
    const drafts: CanonicalMentionDraft[] = [];
    const query = ctx.keywords.slice(0, 5).map((k) => `"${k}"`).join(' OR ');
    if (!query) return [];

    const url = new URL(BASE);
    url.searchParams.set('query', query);
    url.searchParams.set('mode', 'ArtList');
    url.searchParams.set('maxrecords', String(Math.min(250, ctx.maxItems)));
    url.searchParams.set('format', 'json');
    url.searchParams.set('sort', 'DateDesc');

    const key = `gdelt:${sha256(url.toString())}`;
    const cached = cache.get<unknown>(key);
    let data: any;
    if (cached) {
      data = cached;
    } else {
      const r = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`GDELT HTTP ${r.status}`);
      const text = await r.text();
      try { data = JSON.parse(text); } catch { data = { articles: [] }; }
      cache.set(key, data, 900); // 15 min
    }

    for (const a of data.articles ?? []) {
      const url = String(a.url ?? '');
      if (!url) continue;
      const text = String(a.title ?? '') + (a.seendate ? `` : '');
      drafts.push({
        topicId: ctx.topicId,
        platform: 'gdelt', sourceType: 'news_article',
        sourceId: url, sourceUrl: url, sourceUrlHash: sha256(url),
        title: a.title ?? null, text: a.title ?? '', language: a.language ?? null,
        author: { displayName: a.domain ?? null, profileUrl: null },
        publishedAt: parseGdeltDate(a.seendate),
        metrics: { views: null, likes: null, comments: null, shares: null, engagementTotal: 0, reachEstimate: null },
      });
      if (drafts.length >= ctx.maxItems) break;
    }
    return drafts;
  },
};

const parseGdeltDate = (s?: string): string | null => {
  if (!s) return null;
  // Format like "20260522T103000Z"
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
};
