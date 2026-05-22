// Reddit public JSON endpoint. No auth required for read-only search.
// Honor User-Agent header (Reddit ToS).
import { sha256 } from '../lib/crypto.js';
import { cache } from '../lib/cache.js';
import { config } from '../config.js';
import type { SourceConnector, CanonicalMentionDraft, IngestionContext, ConnectorHealth } from './types.js';

const UA = config.reddit.userAgent || 'civicfalcon/0.1';

export const redditConnector: SourceConnector = {
  platform: 'reddit',

  async testConnection(): Promise<ConnectorHealth> {
    try {
      const r = await fetch('https://www.reddit.com/search.json?q=test&limit=1', { headers: { 'User-Agent': UA } });
      if (!r.ok) return { ok: false, status: 'failed', message: `Reddit HTTP ${r.status}` };
      return { ok: true, status: 'active', message: 'Reddit reachable' };
    } catch (e) {
      return { ok: false, status: 'failed', message: `Reddit error: ${(e as Error).message}` };
    }
  },

  async fetchMentions(ctx: IngestionContext): Promise<CanonicalMentionDraft[]> {
    const query = ctx.keywords.slice(0, 5).join(' OR ');
    if (!query) return [];
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=new&limit=${Math.min(100, ctx.maxItems)}`;
    const key = `reddit:${sha256(url)}`;
    let data: any = cache.get(key);
    if (!data) {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (!r.ok) throw new Error(`Reddit HTTP ${r.status}`);
      data = await r.json();
      cache.set(key, data, 600);
    }
    const drafts: CanonicalMentionDraft[] = [];
    for (const c of data?.data?.children ?? []) {
      const d = c.data;
      const link = `https://www.reddit.com${d.permalink ?? ''}`;
      const text = `${d.title ?? ''}\n${d.selftext ?? ''}`.trim();
      drafts.push({
        topicId: ctx.topicId, platform: 'reddit', sourceType: 'social_post',
        sourceId: String(d.id), sourceUrl: link, sourceUrlHash: sha256(link),
        title: d.title ?? null, text,
        language: null,
        author: {
          username: d.author, displayName: d.author,
          profileUrl: `https://www.reddit.com/user/${d.author}`,
        },
        publishedAt: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : null,
        metrics: {
          views: null, likes: d.ups ?? 0, comments: d.num_comments ?? 0,
          shares: null, engagementTotal: (d.ups ?? 0) + (d.num_comments ?? 0),
          reachEstimate: (d.ups ?? 0) * 10,
        },
      });
      if (drafts.length >= ctx.maxItems) break;
    }
    return drafts;
  },
};
