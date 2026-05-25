// Instagram connector.
import { config } from '../config.js';
import { sha256 } from '../lib/crypto.js';
import type { SourceConnector, CanonicalMentionDraft, IngestionContext, ConnectorHealth } from './types.js';
import { ensembleDataConfigured, ensembleDataHealth, fetchEnsembleInstagramMentions } from './ensembledata.js';
import { fetchSocialWebSearchMentions, paidSocialApiAllowed, shouldUseSocialWebSearchFirst } from './socialWebSearch.js';

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

const graphErrorMessage = async (response: Response, label: string): Promise<string> => {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  const detail = body?.error?.message?.trim();
  return detail ? `${label} source request failed (${response.status}): ${detail}` : `${label} source request failed (${response.status}).`;
};

const withinDateRange = (value: string | null | undefined, ctx: IngestionContext): boolean => {
  if (!value) return true;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return true;
  if (ctx.dateFrom) {
    const from = Date.parse(ctx.dateFrom);
    if (Number.isFinite(from) && time < from) return false;
  }
  if (ctx.dateTo) {
    const to = Date.parse(ctx.dateTo);
    if (Number.isFinite(to) && time > to) return false;
  }
  return true;
};

const testOfficialInstagram = async (): Promise<ConnectorHealth> => {
  if (!config.instagram.accessToken) return { ok: false, status: 'not_configured', message: 'Source is not configured.' };
  try {
    const r = await fetch(`https://graph.facebook.com/v20.0/me?access_token=${config.instagram.accessToken}`);
    if (!r.ok) return { ok: false, status: 'failed', message: 'Source request failed.' };
    return { ok: true, status: 'active', message: 'Instagram source reachable.' };
  } catch (e) {
    return { ok: false, status: 'failed', message: `Source request failed: ${(e as Error).message}` };
  }
};

const fetchOfficialInstagramMentions = async (ctx: IngestionContext): Promise<CanonicalMentionDraft[]> => {
  if (!config.instagram.accessToken) throw new Error('Source is not configured.');
  const userIds = textList(ctx, ['instagramUserIds', 'instagramUserId', 'userIds', 'userId']);
  const targets = userIds.length > 0 ? userIds : ['me'];
  const drafts: CanonicalMentionDraft[] = [];
  for (const instagramUserId of targets) {
    const url = `https://graph.facebook.com/v20.0/${instagramUserId}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count&limit=${Math.min(25, ctx.maxItems)}&access_token=${config.instagram.accessToken}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(await graphErrorMessage(response, 'Instagram'));
    const data: any = await response.json();
    for (const media of data.data ?? []) {
      if (!withinDateRange(media.timestamp, ctx)) continue;
      drafts.push({
        topicId: ctx.topicId, platform: 'instagram', sourceType: 'social_post',
        sourceId: media.id, sourceUrl: media.permalink, sourceUrlHash: sha256(media.permalink ?? media.id),
        title: null, text: media.caption ?? '', language: null,
        author: { username: instagramUserId },
        publishedAt: media.timestamp ?? null,
        media: media.media_url ? [{
          id: `media_${sha256(`${media.media_type}:${media.media_url}`).slice(0, 16)}`,
          type: String(media.media_type ?? '').toUpperCase().includes('VIDEO') ? 'video' : 'image',
          sourceUrl: media.media_url,
          thumbnailUrl: media.thumbnail_url ?? null,
          transcript: media.caption ?? null,
          status: 'queued',
        }] : [],
        metrics: {
          likes: media.like_count ?? 0, comments: media.comments_count ?? 0,
          engagementTotal: (media.like_count ?? 0) + (media.comments_count ?? 0),
        },
      });
      if (drafts.length >= ctx.maxItems) break;
    }
    if (drafts.length >= ctx.maxItems) break;
  }
  return drafts;
};

export const instagramConnector: SourceConnector = {
  platform: 'instagram',
  async testConnection(): Promise<ConnectorHealth> {
    if (ensembleDataConfigured()) {
      const ensemble = await ensembleDataHealth('Instagram');
      if (ensemble.ok || !config.instagram.accessToken) return ensemble;
      const official = await testOfficialInstagram();
      if (official.ok) return { ...official, message: 'Instagram source reachable.' };
      return ensemble;
    }
    return testOfficialInstagram();
  },
  async fetchMentions(ctx: IngestionContext): Promise<CanonicalMentionDraft[]> {
    if (shouldUseSocialWebSearchFirst(ctx)) {
      const drafts = await fetchSocialWebSearchMentions(ctx, 'instagram');
      if (drafts.length > 0 || !paidSocialApiAllowed(ctx)) return drafts;
    }
    if (ensembleDataConfigured() && paidSocialApiAllowed(ctx)) {
      try {
        const drafts = await fetchEnsembleInstagramMentions(ctx);
        if (drafts.length > 0 || !config.instagram.accessToken) return drafts;
      } catch (error) {
        if (!config.instagram.accessToken) throw error;
      }
    }
    if (!paidSocialApiAllowed(ctx)) return [];
    return fetchOfficialInstagramMentions(ctx);
  },
};
