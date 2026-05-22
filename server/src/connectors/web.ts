// Web search connector — uses the §31 provider waterfall and treats results as web mentions.
import { webSearch } from './search/router.js';
import { sha256 } from '../lib/crypto.js';
import type { SourceConnector, CanonicalMentionDraft, IngestionContext, ConnectorHealth } from './types.js';

export const webConnector: SourceConnector = {
  platform: 'web',

  async testConnection(): Promise<ConnectorHealth> {
    const { results, provider } = await webSearch('site:wikipedia.org news', { maxResults: 3 });
    if (results.length === 0) return { ok: false, status: 'limited', message: 'No web search provider returned results. Configure SEARXNG_BASE_URL, BRAVE_API_KEY, or TAVILY_API_KEY.' };
    return { ok: true, status: 'active', message: `Web search via ${provider}` };
  },

  async fetchMentions(ctx: IngestionContext): Promise<CanonicalMentionDraft[]> {
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
