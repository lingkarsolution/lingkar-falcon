// Threads connector — EnsembleData public keyword search preferred, official Threads API fallback.
import { config } from '../config.js';
import { sha256 } from '../lib/crypto.js';
import { ensembleDataConfigured, ensembleDataHealth, fetchEnsembleThreadsMentions } from './ensembledata.js';
import type { SourceConnector, CanonicalMentionDraft, IngestionContext, ConnectorHealth } from './types.js';

const officialFields = 'id,text,media_type,media_url,permalink,timestamp,username,shortcode,thumbnail_url,has_replies,is_quote_post,is_reply';

const testOfficialThreads = async (): Promise<ConnectorHealth> => {
  if (!config.threads.accessToken) return { ok: false, status: 'not_configured', message: 'Set THREADS_ACCESS_TOKEN or ENSEMBLEDATA_TOKEN' };
  try {
    const url = new URL('https://graph.threads.net/v1.0/me');
    url.searchParams.set('fields', 'id,username');
    url.searchParams.set('access_token', config.threads.accessToken);
    const response = await fetch(url.toString());
    if (!response.ok) return { ok: false, status: response.status === 429 ? 'limited' : 'failed', message: `Threads HTTP ${response.status}` };
    return { ok: true, status: 'active', message: 'Threads official API reachable' };
  } catch (error) {
    return { ok: false, status: 'failed', message: `Threads error: ${(error as Error).message}` };
  }
};

const fetchOfficialThreadsMentions = async (ctx: IngestionContext): Promise<CanonicalMentionDraft[]> => {
  if (!config.threads.accessToken) return [];
  const query = ctx.keywords.slice(0, 4).join(' ').trim();
  if (!query) return [];

  const url = new URL('https://graph.threads.net/v1.0/keyword_search');
  url.searchParams.set('q', query);
  url.searchParams.set('search_type', 'RECENT');
  url.searchParams.set('fields', officialFields);
  url.searchParams.set('limit', String(Math.min(100, ctx.maxItems)));
  url.searchParams.set('access_token', config.threads.accessToken);

  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`Threads HTTP ${response.status}`);
  const json = await response.json() as { data?: any[] };

  const drafts: CanonicalMentionDraft[] = [];
  for (const item of json.data ?? []) {
    const sourceId = typeof item.id === 'string' ? item.id : null;
    const sourceUrl = typeof item.permalink === 'string' ? item.permalink : sourceId ? `https://www.threads.net/t/${sourceId}` : null;
    const text = typeof item.text === 'string' ? item.text : '';
    const mediaType = String(item.media_type ?? '').toLowerCase();
    const mediaUrl = typeof item.media_url === 'string' ? item.media_url : null;
    const thumbnailUrl = typeof item.thumbnail_url === 'string' ? item.thumbnail_url : null;
    drafts.push({
      topicId: ctx.topicId,
      platform: 'threads',
      sourceType: 'social_post',
      sourceId,
      sourceUrl,
      sourceUrlHash: sha256(sourceUrl ?? `threads:${sourceId ?? text}`),
      title: null,
      text,
      language: null,
      author: item.username ? {
        username: item.username,
        displayName: item.username,
        profileUrl: `https://www.threads.net/@${item.username}`,
      } : null,
      publishedAt: typeof item.timestamp === 'string' ? item.timestamp : null,
      media: mediaUrl ? [{
        id: `media_${sha256(`${mediaType}:${mediaUrl}`).slice(0, 16)}`,
        type: mediaType.includes('video') ? 'video' : mediaType.includes('image') ? 'image' : 'other',
        sourceUrl: mediaUrl,
        thumbnailUrl,
        transcript: text || null,
        status: 'queued',
      }] : [],
      metrics: { engagementTotal: 0 },
    });
    if (drafts.length >= ctx.maxItems) break;
  }
  return drafts.filter((draft) => Boolean(draft.text || draft.sourceUrl));
};

export const threadsConnector: SourceConnector = {
  platform: 'threads',

  async testConnection(): Promise<ConnectorHealth> {
    if (ensembleDataConfigured()) {
      const ensemble = await ensembleDataHealth('Threads');
      if (ensemble.ok || !config.threads.accessToken) return ensemble;
      const official = await testOfficialThreads();
      if (official.ok) return { ...official, message: `${ensemble.message}; official Threads fallback reachable` };
      return ensemble;
    }
    return testOfficialThreads();
  },

  async fetchMentions(ctx: IngestionContext): Promise<CanonicalMentionDraft[]> {
    if (ensembleDataConfigured()) {
      try {
        const drafts = await fetchEnsembleThreadsMentions(ctx);
        if (drafts.length > 0 || !config.threads.accessToken) return drafts;
      } catch (error) {
        if (!config.threads.accessToken) throw error;
      }
    }
    return fetchOfficialThreadsMentions(ctx);
  },
};