// NewsAPI.org connector — free dev tier; optional paid.
import { config } from '../config.js';
import { sha256 } from '../lib/crypto.js';
import type { SourceConnector, CanonicalMentionDraft, IngestionContext, ConnectorHealth } from './types.js';

export const newsConnector: SourceConnector = {
  platform: 'news',
  async testConnection(): Promise<ConnectorHealth> {
    if (!config.newsapi.apiKey) return { ok: false, status: 'not_configured', message: 'Set NEWSAPI_KEY' };
    try {
      const r = await fetch(`https://newsapi.org/v2/top-headlines?country=us&pageSize=1&apiKey=${config.newsapi.apiKey}`);
      if (!r.ok) return { ok: false, status: 'failed', message: `NewsAPI HTTP ${r.status}` };
      return { ok: true, status: 'active', message: 'NewsAPI reachable' };
    } catch (e) {
      return { ok: false, status: 'failed', message: (e as Error).message };
    }
  },
  async fetchMentions(ctx: IngestionContext): Promise<CanonicalMentionDraft[]> {
    if (!config.newsapi.apiKey) return [];
    const q = ctx.keywords.slice(0, 5).join(' OR ');
    if (!q) return [];
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&pageSize=${Math.min(100, ctx.maxItems)}&sortBy=publishedAt&apiKey=${config.newsapi.apiKey}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`NewsAPI HTTP ${r.status}`);
    const data: any = await r.json();
    const drafts: CanonicalMentionDraft[] = [];
    for (const a of data.articles ?? []) {
      if (!a.url) continue;
      drafts.push({
        topicId: ctx.topicId, platform: 'news', sourceType: 'news_article',
        sourceId: a.url, sourceUrl: a.url, sourceUrlHash: sha256(a.url),
        title: a.title ?? null, text: `${a.title ?? ''}\n${a.description ?? ''}`,
        language: null,
        author: { displayName: a.source?.name ?? a.author ?? null },
        publishedAt: a.publishedAt ?? null,
        metrics: { engagementTotal: 0 },
      });
      if (drafts.length >= ctx.maxItems) break;
    }
    return drafts;
  },
};
