// Web search connector.
import { webSearch } from './search/router.js';
import { sha256 } from '../lib/crypto.js';
import { indonesianNewsToDrafts, searchIndonesianNews } from '../services/indonesianNews.js';
import type { SourceConnector, CanonicalMentionDraft, IngestionContext, ConnectorHealth } from './types.js';

export const webConnector: SourceConnector = {
  platform: 'web',

  async testConnection(): Promise<ConnectorHealth> {
    const { results, provider } = await webSearch('site:wikipedia.org news', { maxResults: 3 });
    void provider;
    if (results.length === 0) return { ok: false, status: 'limited', message: 'No search results were available. Check source configuration.' };
    return { ok: true, status: 'active', message: 'Web search source reachable.' };
  },

  async fetchMentions(ctx: IngestionContext): Promise<CanonicalMentionDraft[]> {
    if (ctx.connectorConfig?.trendingNews === true) {
      const query = String(ctx.connectorConfig.trendingNewsQuery ?? ctx.keywords.slice(0, 5).join(' ')).trim();
      const sources = Array.isArray(ctx.connectorConfig.newsSourceDomains)
        ? ctx.connectorConfig.newsSourceDomains.map(String)
        : undefined;
      const days = Number(ctx.connectorConfig.days ?? ctx.connectorConfig.freshnessDays ?? 30);
      const aggregated = await searchIndonesianNews({
        query,
        sources,
        maxResults: ctx.maxItems,
        freshnessDays: Number.isFinite(days) ? Math.min(90, Math.max(1, days)) : 30,
      });
      return indonesianNewsToDrafts(ctx.topicId, aggregated.results).slice(0, ctx.maxItems);
    }

    const query = ctx.keywords.slice(0, 5).join(' OR ');
    if (!query) return [];
    const { results } = await webSearch(query, { maxResults: Math.min(20, ctx.maxItems), freshnessDays: 30 });
    const drafts: CanonicalMentionDraft[] = [];
    for (const r of results) {
      drafts.push({
        topicId: ctx.topicId,
        platform: 'web', sourceType: 'web_page',
        sourceId: r.url, sourceUrl: r.url, sourceUrlHash: sha256(r.url),
        title: r.title, text: `${r.title}\n${r.snippet}`, language: null,
        author: { displayName: new URL(r.url).hostname },
        publishedAt: r.publishedAt ?? null,
        metrics: { engagementTotal: 0 },
      });
      if (drafts.length >= ctx.maxItems) break;
    }
    return drafts;
  },
};
