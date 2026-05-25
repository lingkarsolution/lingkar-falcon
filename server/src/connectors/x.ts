// X connector.
import { config } from '../config.js';
import { sha256 } from '../lib/crypto.js';
import { ensembleDataConfigured, ensembleDataHealth, fetchEnsembleXMentions } from './ensembledata.js';
import { fetchSocialWebSearchMentions, paidSocialApiAllowed, shouldUseSocialWebSearchFirst } from './socialWebSearch.js';
import type { SourceConnector, CanonicalMentionDraft, IngestionContext, ConnectorHealth } from './types.js';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const textList = (ctx: IngestionContext, keys: string[]): string[] => {
  const cfg = asRecord(ctx.connectorConfig);
  for (const key of keys) {
    const value = cfg[key];
    if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
    if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
};

const normalizeTerm = (value: string): string => value.trim().replace(/^[@#]+/, '').trim();

const searchTerms = (ctx: IngestionContext): string[] => [...new Set([
  ...ctx.keywords,
  ...textList(ctx, ['includeKeywords']),
  ...textList(ctx, ['exactPhrases']),
  ...textList(ctx, ['hashtags']).map(normalizeTerm),
].map(normalizeTerm).filter(Boolean))];

const buildRecentSearchQuery = (ctx: IngestionContext): string => {
  const include = searchTerms(ctx).slice(0, 6).map((term) => term.includes(' ') ? `"${term}"` : term);
  const exclude = [...ctx.excludeKeywords, ...textList(ctx, ['excludeKeywords'])]
    .map(normalizeTerm)
    .filter(Boolean)
    .slice(0, 6)
    .map((term) => `-${term}`);
  return [include.join(' OR '), exclude.join(' ')].filter(Boolean).join(' ').trim();
};

const applyRecentSearchWindow = (url: URL, ctx: IngestionContext): void => {
  if (ctx.dateFrom) {
    const requestedStart = Date.parse(ctx.dateFrom);
    const recentFloor = Date.now() - 6.9 * 24 * 3600_000;
    if (Number.isFinite(requestedStart)) url.searchParams.set('start_time', new Date(Math.max(requestedStart, recentFloor)).toISOString());
  }
  if (ctx.dateTo) {
    const requestedEnd = Date.parse(ctx.dateTo);
    if (Number.isFinite(requestedEnd) && requestedEnd < Date.now()) url.searchParams.set('end_time', new Date(requestedEnd).toISOString());
  }
};

export const xConnector: SourceConnector = {
  platform: 'x',

  async testConnection(): Promise<ConnectorHealth> {
    if (!config.x.bearerToken) return ensembleDataHealth('X / Twitter');
    try {
      const r = await fetch('https://api.twitter.com/2/tweets/search/recent?query=test&max_results=10', {
        headers: { Authorization: `Bearer ${config.x.bearerToken}` },
      });
      if (r.status === 429) return { ok: false, status: 'limited', message: 'Source rate limit reached.' };
      if (!r.ok) return { ok: false, status: 'failed', message: 'Source request failed.' };
      return { ok: true, status: 'active', message: 'X source reachable.' };
    } catch (e) {
      return { ok: false, status: 'failed', message: `Source request failed: ${(e as Error).message}` };
    }
  },

  async fetchMentions(ctx: IngestionContext): Promise<CanonicalMentionDraft[]> {
    if (shouldUseSocialWebSearchFirst(ctx)) {
      const drafts = await fetchSocialWebSearchMentions(ctx, 'x');
      if (drafts.length > 0 || !paidSocialApiAllowed(ctx)) return drafts;
    }
    if (ensembleDataConfigured() && paidSocialApiAllowed(ctx)) {
      try {
        const drafts = await fetchEnsembleXMentions(ctx);
        if (drafts.length > 0 || !config.x.bearerToken) return drafts;
      } catch (error) {
        if (!config.x.bearerToken) throw error;
      }
    }
    if (!paidSocialApiAllowed(ctx)) return [];
    if (!config.x.bearerToken) throw new Error('Source is not configured.');
    const query = buildRecentSearchQuery(ctx);
    if (!query) return [];

    const url = new URL('https://api.twitter.com/2/tweets/search/recent');
    url.searchParams.set('query', query);
    url.searchParams.set('max_results', String(Math.min(100, ctx.maxItems)));
    url.searchParams.set('tweet.fields', 'created_at,public_metrics,lang,author_id,attachments');
    url.searchParams.set('expansions', 'author_id,attachments.media_keys');
    url.searchParams.set('user.fields', 'username,name,verified,public_metrics');
    url.searchParams.set('media.fields', 'type,url,preview_image_url,alt_text');
    applyRecentSearchWindow(url, ctx);

    const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${config.x.bearerToken}` } });
    if (!response.ok) throw new Error(`X source request failed (${response.status}).`);
    const data: any = await response.json();
    const usersById = new Map<string, any>();
    for (const u of data.includes?.users ?? []) usersById.set(u.id, u);
    const mediaByKey = new Map<string, any>();
    for (const media of data.includes?.media ?? []) mediaByKey.set(media.media_key, media);

    const drafts: CanonicalMentionDraft[] = [];
    for (const t of data.data ?? []) {
      const u = usersById.get(t.author_id);
      const link = u ? `https://x.com/${u.username}/status/${t.id}` : `https://x.com/i/status/${t.id}`;
      const pm = t.public_metrics ?? {};
      const media = (t.attachments?.media_keys ?? []).map((key: string) => mediaByKey.get(key)).find(Boolean);
      const mediaUrl = media?.url ?? media?.preview_image_url ?? null;
      drafts.push({
        topicId: ctx.topicId, platform: 'x', sourceType: 'social_post',
        sourceId: t.id, sourceUrl: link, sourceUrlHash: sha256(link),
        title: null, text: t.text ?? '', language: t.lang ?? null,
        author: u ? {
          id: u.id, username: u.username, displayName: u.name,
          profileUrl: `https://x.com/${u.username}`,
          followersCount: u.public_metrics?.followers_count ?? null,
          verified: u.verified ?? false,
        } : null,
        publishedAt: t.created_at ?? null,
        media: mediaUrl ? [{
          id: `media_${sha256(`${media?.type}:${mediaUrl}`).slice(0, 16)}`,
          type: media?.type === 'photo' ? 'image' : 'video',
          sourceUrl: media?.type === 'photo' ? mediaUrl : link,
          thumbnailUrl: media?.type === 'photo' ? null : mediaUrl,
          transcript: t.text ?? null,
          status: 'queued',
        }] : [],
        metrics: {
          likes: pm.like_count, comments: pm.reply_count, shares: pm.retweet_count,
          quotes: pm.quote_count, views: pm.impression_count,
          engagementTotal: (pm.like_count ?? 0) + (pm.reply_count ?? 0) + (pm.retweet_count ?? 0) + (pm.quote_count ?? 0),
          reachEstimate: u?.public_metrics?.followers_count ?? null,
        },
      });
      if (drafts.length >= ctx.maxItems) break;
    }
    return drafts;
  },
};
