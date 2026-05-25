// YouTube connector.
import { config } from '../config.js';
import { sha256 } from '../lib/crypto.js';
import { cache } from '../lib/cache.js';
import type { SourceConnector, CanonicalMentionDraft, IngestionContext, ConnectorHealth } from './types.js';
import { ensembleDataConfigured, ensembleDataHealth, fetchEnsembleYouTubeMentions } from './ensembledata.js';

const testOfficialYouTube = async (): Promise<ConnectorHealth> => {
  if (!config.youtube.apiKey) return { ok: false, status: 'not_configured', message: 'Source is not configured.' };
  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=test&maxResults=1&key=${config.youtube.apiKey}`;
    const r = await fetch(url);
    if (!r.ok) return { ok: false, status: 'failed', message: 'Source request failed.' };
    return { ok: true, status: 'active', message: 'YouTube source reachable.' };
  } catch (e) {
    return { ok: false, status: 'failed', message: `Source request failed: ${(e as Error).message}` };
  }
};

const fetchOfficialYouTubeMentions = async (ctx: IngestionContext): Promise<CanonicalMentionDraft[]> => {
  if (!config.youtube.apiKey) return [];
  const query = ctx.keywords.slice(0, 3).join(' ');
  if (!query) return [];
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('q', query);
  url.searchParams.set('type', 'video');
  url.searchParams.set('order', 'date');
  url.searchParams.set('maxResults', String(Math.min(50, ctx.maxItems)));
  url.searchParams.set('key', config.youtube.apiKey);

  const key = `yt:${sha256(url.toString())}`;
  let data: any = cache.get(key);
  if (!data) {
    const r = await fetch(url.toString());
    if (!r.ok) throw new Error('Source request failed.');
    data = await r.json();
    cache.set(key, data, 900);
  }
  const drafts: CanonicalMentionDraft[] = [];
  for (const it of data.items ?? []) {
    const videoId = it.id?.videoId;
    if (!videoId) continue;
    const link = `https://www.youtube.com/watch?v=${videoId}`;
    const sn = it.snippet ?? {};
    const thumbnailUrl = sn.thumbnails?.high?.url ?? sn.thumbnails?.medium?.url ?? sn.thumbnails?.default?.url ?? null;
    drafts.push({
      topicId: ctx.topicId, platform: 'youtube', sourceType: 'video',
      sourceId: videoId, sourceUrl: link, sourceUrlHash: sha256(link),
      title: sn.title ?? null, text: `${sn.title ?? ''}\n${sn.description ?? ''}`,
      language: null,
      author: {
        username: sn.channelTitle, displayName: sn.channelTitle,
        profileUrl: `https://www.youtube.com/channel/${sn.channelId}`,
      },
      publishedAt: sn.publishedAt ?? null,
      media: [{
        id: `media_${sha256(`video:${link}`).slice(0, 16)}`,
        type: 'video',
        sourceUrl: link,
        thumbnailUrl,
        transcript: `${sn.title ?? ''}\n${sn.description ?? ''}`.trim(),
        status: 'queued',
      }],
      metrics: { engagementTotal: 0 },
    });
    if (drafts.length >= ctx.maxItems) break;
  }
  return drafts;
};

export const youtubeConnector: SourceConnector = {
  platform: 'youtube',

  async testConnection(): Promise<ConnectorHealth> {
    if (ensembleDataConfigured()) {
      const ensemble = await ensembleDataHealth('YouTube');
      if (ensemble.ok || !config.youtube.apiKey) return ensemble;
      const official = await testOfficialYouTube();
      if (official.ok) return { ...official, message: 'YouTube source reachable.' };
      return ensemble;
    }
    return testOfficialYouTube();
  },

  async fetchMentions(ctx: IngestionContext): Promise<CanonicalMentionDraft[]> {
    if (ensembleDataConfigured()) {
      try {
        const drafts = await fetchEnsembleYouTubeMentions(ctx);
        if (drafts.length > 0 || !config.youtube.apiKey) return drafts;
      } catch (error) {
        if (!config.youtube.apiKey) throw error;
      }
    }
    return fetchOfficialYouTubeMentions(ctx);
  },
};
