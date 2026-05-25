// Facebook connector.
import { config } from '../config.js';
import { sha256 } from '../lib/crypto.js';
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

const normalizePageRef = (value: string): string => {
  let normalized = value.trim();
  normalized = normalized.replace(/^https?:\/\/(?:www\.)?facebook\.com\//i, '');
  normalized = normalized.split(/[/?#]/)[0] ?? normalized;
  return normalized.replace(/^@+/, '').trim();
};

const graphErrorMessage = async (response: Response): Promise<string> => {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  const detail = body?.error?.message?.trim();
  return detail ? `Facebook source request failed (${response.status}): ${detail}` : `Facebook source request failed (${response.status}).`;
};

const unixTime = (value?: string): string | null => {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? String(Math.floor(time / 1000)) : null;
};

export const facebookConnector: SourceConnector = {
  platform: 'facebook',
  async testConnection(): Promise<ConnectorHealth> {
    if (!config.facebook.pageAccessToken) return { ok: false, status: 'not_configured', message: 'Source is not configured.' };
    try {
      const r = await fetch(`https://graph.facebook.com/v20.0/me?access_token=${config.facebook.pageAccessToken}`);
      if (!r.ok) return { ok: false, status: 'failed', message: 'Source request failed.' };
      return { ok: true, status: 'active', message: 'Facebook source reachable.' };
    } catch (e) {
      return { ok: false, status: 'failed', message: `Source request failed: ${(e as Error).message}` };
    }
  },
  async fetchMentions(ctx: IngestionContext): Promise<CanonicalMentionDraft[]> {
    if (shouldUseSocialWebSearchFirst(ctx)) {
      const webDrafts = await fetchSocialWebSearchMentions(ctx, 'facebook');
      if (webDrafts.length > 0 || !paidSocialApiAllowed(ctx)) return webDrafts;
    }
    if (!paidSocialApiAllowed(ctx)) return [];
    if (!config.facebook.pageAccessToken) throw new Error('Source is not configured.');
    const configuredPages = textList(ctx, ['facebookPageIds', 'facebookPageId', 'facebookPages', 'pageIds', 'pageId', 'pages'])
      .map(normalizePageRef)
      .filter(Boolean);
    const configuredHandles = textList(ctx, ['facebookHandles', 'handles']).map(normalizePageRef).filter(Boolean);
    const pageIds = [...new Set([...configuredPages, ...configuredHandles])];
    const targets = pageIds.length > 0 ? pageIds : ['me'];
    const drafts: CanonicalMentionDraft[] = [];
    const errors: string[] = [];
    for (const pageId of targets) {
      const url = new URL(`https://graph.facebook.com/v20.0/${pageId}/posts`);
      url.searchParams.set('fields', 'id,message,created_time,permalink_url,reactions.summary(true),comments.summary(true),shares');
      url.searchParams.set('limit', String(Math.min(25, ctx.maxItems)));
      url.searchParams.set('access_token', config.facebook.pageAccessToken);
      const since = unixTime(ctx.dateFrom);
      const until = unixTime(ctx.dateTo);
      if (since) url.searchParams.set('since', since);
      if (until) url.searchParams.set('until', until);
      const response = await fetch(url.toString());
      if (!response.ok) {
        errors.push(await graphErrorMessage(response));
        continue;
      }
      const data: any = await response.json();
      for (const post of data.data ?? []) {
        const link = post.permalink_url ?? `https://facebook.com/${post.id}`;
        drafts.push({
          topicId: ctx.topicId, platform: 'facebook', sourceType: 'social_post',
          sourceId: post.id, sourceUrl: link, sourceUrlHash: sha256(link),
          title: null, text: post.message ?? '', language: null,
          author: { username: pageId, displayName: pageId },
          publishedAt: post.created_time ?? null,
          metrics: {
            likes: post.reactions?.summary?.total_count ?? 0,
            comments: post.comments?.summary?.total_count ?? 0,
            shares: post.shares?.count ?? 0,
            engagementTotal:
              (post.reactions?.summary?.total_count ?? 0) +
              (post.comments?.summary?.total_count ?? 0) +
              (post.shares?.count ?? 0),
          },
        });
        if (drafts.length >= ctx.maxItems) break;
      }
      if (drafts.length >= ctx.maxItems) break;
    }
    if (drafts.length === 0 && errors.length > 0) throw new Error(errors.slice(0, 3).join('; '));
    return drafts;
  },
};
