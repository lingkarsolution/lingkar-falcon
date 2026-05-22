import { config } from '../config.js';
import { sha256 } from '../lib/crypto.js';
import type { Platform } from '../types.js';
import type { CanonicalMentionDraft, ConnectorHealth, IngestionContext } from './types.js';

type JsonRecord = Record<string, unknown>;
type ParamValue = string | number | boolean | null | undefined;

const asRecord = (value: unknown): JsonRecord | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;

const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

const getPath = (source: unknown, path: string): unknown => {
  let current: unknown = source;
  for (const part of path.split('.')) {
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[Number(part)];
      continue;
    }
    const record = asRecord(current);
    if (!record) return undefined;
    current = record[part];
  }
  return current;
};

const firstValue = (source: unknown, paths: string[]): unknown => {
  for (const path of paths) {
    const value = getPath(source, path);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

const textValue = (value: unknown): string | null => {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const record = asRecord(value);
  if (record) return firstString(record, ['text', 'title', 'name', 'caption']);
  return null;
};

const firstString = (source: unknown, paths: string[]): string | null => textValue(firstValue(source, paths));

const firstNumber = (source: unknown, paths: string[]): number | null => {
  const value = firstValue(source, paths);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const normalized = value.replace(/,/g, '').trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const firstArray = (source: unknown, paths: string[]): unknown[] => {
  for (const path of paths) {
    const value = getPath(source, path);
    if (Array.isArray(value)) return value;
  }
  return [];
};

const toIsoDate = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 10_000_000_000 ? value : value * 1000;
    return new Date(millis).toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && /^\d+$/.test(value.trim())) return toIsoDate(numeric);
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
};

const cleanText = (...parts: Array<string | null | undefined>): string =>
  parts.map((part) => part?.trim()).filter(Boolean).join('\n');

const queryFromContext = (ctx: IngestionContext): string => ctx.keywords.slice(0, 4).join(' ').trim();

const regionFromContext = (ctx: IngestionContext): string => (ctx.regions?.[0] ?? '').slice(0, 2).toLowerCase();

const periodFromContext = (ctx: IngestionContext): '0' | '1' | '7' | '30' | '90' | '180' => {
  if (!ctx.dateFrom) return '30';
  const days = Math.max(0, Math.ceil((Date.now() - new Date(ctx.dateFrom).getTime()) / 86_400_000));
  if (days <= 1) return '1';
  if (days <= 7) return '7';
  if (days <= 30) return '30';
  if (days <= 90) return '90';
  return '180';
};

const oldestTimestamp = (ctx: IngestionContext, fallbackDays = 30): number => {
  const date = ctx.dateFrom ? new Date(ctx.dateFrom) : new Date(Date.now() - fallbackDays * 86_400_000);
  return Math.floor(date.getTime() / 1000);
};

const connectorConfig = (ctx: IngestionContext): JsonRecord => asRecord(ctx.connectorConfig) ?? {};

const stringArrayConfig = (ctx: IngestionContext, keys: string[]): string[] => {
  const cfg = connectorConfig(ctx);
  for (const key of keys) {
    const value = cfg[key];
    if (Array.isArray(value)) return value.map((item) => textValue(item)).filter((item): item is string => Boolean(item));
    if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
};

const depthFor = (maxItems: number, pageSize: number, cap = 3): number =>
  Math.max(1, Math.min(cap, Math.ceil(Math.max(1, maxItems) / pageSize)));

export const ensembleDataConfigured = (): boolean => Boolean(config.ensembleData.token);

export const ensembleDataRequest = async (endpoint: string, params: Record<string, ParamValue> = {}): Promise<JsonRecord> => {
  if (!config.ensembleData.token) throw new Error('Set ENSEMBLEDATA_TOKEN');
  const url = new URL(endpoint, config.ensembleData.baseUrl.endsWith('/') ? config.ensembleData.baseUrl : `${config.ensembleData.baseUrl}/`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  url.searchParams.set('token', config.ensembleData.token);
  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`EnsembleData HTTP ${response.status}`);
  const json = await response.json() as JsonRecord;
  return json;
};

export const ensembleDataHealth = async (label: string): Promise<ConnectorHealth> => {
  if (!config.ensembleData.token) return { ok: false, status: 'not_configured', message: 'Set ENSEMBLEDATA_TOKEN' };
  try {
    const date = new Date().toISOString().slice(0, 10);
    await ensembleDataRequest('customer/get-used-units', { date });
    return { ok: true, status: 'active', message: `EnsembleData reachable for ${label}` };
  } catch (error) {
    return { ok: false, status: 'failed', message: `EnsembleData error: ${(error as Error).message}` };
  }
};

const sourceHash = (platform: Platform, sourceUrl: string | null, sourceId: string | null): string =>
  sha256(sourceUrl || `${platform}:${sourceId ?? Date.now()}:${Math.random()}`);

const youtubeVideoId = (post: unknown): string | null => {
  const direct = firstString(post, ['videoId', 'video_id', 'id.videoId', 'id', 'video.id', 'video.videoId']);
  if (direct && /^[a-zA-Z0-9_-]{8,}$/.test(direct)) return direct;
  const url = firstString(post, ['url', 'videoUrl', 'video_url', 'watchUrl', 'navigationEndpoint.commandMetadata.webCommandMetadata.url']);
  if (!url) return direct;
  const match = url.match(/[?&]v=([a-zA-Z0-9_-]+)/) ?? url.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? direct;
};

export const fetchEnsembleYouTubeMentions = async (ctx: IngestionContext): Promise<CanonicalMentionDraft[]> => {
  const keyword = queryFromContext(ctx);
  if (!keyword) return [];
  const json = await ensembleDataRequest('youtube/search', {
    keyword,
    depth: depthFor(ctx.maxItems, 20),
    start_cursor: '',
    period: 'month',
    sorting: 'time',
    get_additional_info: false,
  });
  const root = asRecord(json.data) ?? json;
  const posts = firstArray(root, ['posts', 'videos', 'data']);
  const drafts: CanonicalMentionDraft[] = [];
  for (const post of posts) {
    const sourceId = youtubeVideoId(post);
    const sourceUrl = firstString(post, ['url', 'videoUrl', 'video_url', 'watchUrl']) ?? (sourceId ? `https://www.youtube.com/watch?v=${sourceId}` : null);
    const title = firstString(post, ['title', 'name', 'headline']);
    const description = firstString(post, ['description', 'snippet', 'text', 'shortDescription']);
    const channelId = firstString(post, ['channelId', 'channel_id', 'channel.id', 'owner.id']);
    const channelName = firstString(post, ['channelTitle', 'channel_title', 'channel.name', 'owner.name', 'author', 'author.name']);
    drafts.push({
      topicId: ctx.topicId,
      platform: 'youtube',
      sourceType: 'video',
      sourceId,
      sourceUrl,
      sourceUrlHash: sourceHash('youtube', sourceUrl, sourceId),
      title,
      text: cleanText(title, description),
      language: null,
      author: {
        id: channelId,
        username: channelName,
        displayName: channelName,
        profileUrl: channelId ? `https://www.youtube.com/channel/${channelId}` : null,
      },
      publishedAt: toIsoDate(firstValue(post, ['publishedAt', 'published_at', 'publishedTime', 'published_time', 'date'])),
      metrics: {
        views: firstNumber(post, ['viewCount', 'views', 'stats.views']),
        likes: firstNumber(post, ['likeCount', 'likes', 'stats.likes']),
        comments: firstNumber(post, ['commentCount', 'comments', 'stats.comments']),
      },
    });
    if (drafts.length >= ctx.maxItems) break;
  }
  return drafts.filter((draft) => Boolean(draft.text || draft.title || draft.sourceUrl));
};

const tiktokPostId = (post: unknown): string | null => firstString(post, ['aweme_id', 'awemeId', 'id', 'video.id']);

export const fetchEnsembleTikTokMentions = async (ctx: IngestionContext): Promise<CanonicalMentionDraft[]> => {
  const keyword = queryFromContext(ctx);
  if (!keyword) return [];
  const json = await ensembleDataRequest('tt/keyword/search', {
    name: keyword,
    cursor: 0,
    period: periodFromContext(ctx),
    sorting: '2',
    country: regionFromContext(ctx),
    match_exactly: false,
    get_author_stats: false,
  });
  const root = asRecord(json.data) ?? json;
  const posts = firstArray(root, ['data', 'posts', 'aweme_list']);
  const drafts: CanonicalMentionDraft[] = [];
  for (const post of posts) {
    const sourceId = tiktokPostId(post);
    const title = firstString(post, ['title', 'desc', 'description']);
    const username = firstString(post, ['author.unique_id', 'author.username', 'author.name', 'authorInfo.unique_id', 'authorInfo.username']);
    const displayName = firstString(post, ['author.nickname', 'author.displayName', 'authorInfo.nickname', 'authorInfo.displayName']);
    const sourceUrl = firstString(post, ['share_url', 'shareUrl', 'url', 'webVideoUrl']) ?? (sourceId && username ? `https://www.tiktok.com/@${username}/video/${sourceId}` : null);
    drafts.push({
      topicId: ctx.topicId,
      platform: 'tiktok',
      sourceType: 'video',
      sourceId,
      sourceUrl,
      sourceUrlHash: sourceHash('tiktok', sourceUrl, sourceId),
      title,
      text: title ?? '',
      language: null,
      author: {
        id: firstString(post, ['author.uid', 'author.id', 'authorInfo.uid', 'authorInfo.id']),
        username,
        displayName,
        profileUrl: username ? `https://www.tiktok.com/@${username}` : null,
        followersCount: firstNumber(post, ['authorStats.followerCount', 'author.follower_count', 'authorStats.follower_count']),
        verified: Boolean(firstValue(post, ['author.verified', 'authorInfo.verified'])),
      },
      publishedAt: toIsoDate(firstValue(post, ['create_time', 'createTime', 'created_at', 'date'])),
      metrics: {
        views: firstNumber(post, ['statistics.play_count', 'stats.playCount', 'play_count', 'playCount']),
        likes: firstNumber(post, ['statistics.digg_count', 'stats.diggCount', 'digg_count', 'like_count', 'likes']),
        comments: firstNumber(post, ['statistics.comment_count', 'stats.commentCount', 'comment_count', 'comments']),
        shares: firstNumber(post, ['statistics.share_count', 'stats.shareCount', 'share_count', 'shares']),
        saves: firstNumber(post, ['statistics.collect_count', 'stats.collectCount', 'collect_count']),
      },
    });
    if (drafts.length >= ctx.maxItems) break;
  }
  return drafts.filter((draft) => Boolean(draft.text || draft.title || draft.sourceUrl));
};

const instagramCaption = (post: unknown): string | null => {
  const direct = firstString(post, ['caption', 'text', 'description', 'accessibility_caption']);
  if (direct) return direct;
  return firstString(post, ['caption.text', 'edge_media_to_caption.edges.0.node.text']);
};

const instagramShortcode = (post: unknown): string | null => firstString(post, ['shortcode', 'code']);

const instagramSourceUrl = (post: unknown): string | null => {
  const url = firstString(post, ['permalink', 'url', 'display_url']);
  if (url) return url;
  const shortcode = instagramShortcode(post);
  return shortcode ? `https://www.instagram.com/p/${shortcode}/` : null;
};

const mapInstagramPosts = (posts: unknown[], ctx: IngestionContext, authorHint?: { id?: string; username?: string }): CanonicalMentionDraft[] => {
  const drafts: CanonicalMentionDraft[] = [];
  for (const post of posts) {
    const sourceId = firstString(post, ['id', 'pk', 'media_id']);
    const sourceUrl = instagramSourceUrl(post);
    const caption = instagramCaption(post);
    const owner = asRecord(firstValue(post, ['owner', 'user'])) ?? {};
    const username = firstString(owner, ['username']) ?? authorHint?.username ?? null;
    const displayName = firstString(owner, ['full_name', 'name']) ?? username;
    drafts.push({
      topicId: ctx.topicId,
      platform: 'instagram',
      sourceType: 'social_post',
      sourceId,
      sourceUrl,
      sourceUrlHash: sourceHash('instagram', sourceUrl, sourceId),
      title: null,
      text: caption ?? '',
      language: null,
      author: {
        id: firstString(owner, ['id', 'pk']) ?? authorHint?.id ?? null,
        username,
        displayName,
        profileUrl: username ? `https://www.instagram.com/${username}/` : null,
        followersCount: firstNumber(owner, ['followers', 'follower_count', 'edge_followed_by.count']),
        verified: Boolean(firstValue(owner, ['is_verified', 'verified'])),
      },
      publishedAt: toIsoDate(firstValue(post, ['taken_at_timestamp', 'timestamp', 'created_at', 'date'])),
      metrics: {
        views: firstNumber(post, ['video_view_count', 'video_play_count', 'play_count', 'views']),
        likes: firstNumber(post, ['like_count', 'likes', 'edge_media_preview_like.count']),
        comments: firstNumber(post, ['comment_count', 'comments_count', 'edge_media_to_comment.count']),
      },
    });
    if (drafts.length >= ctx.maxItems) break;
  }
  return drafts.filter((draft) => Boolean(draft.text || draft.sourceUrl));
};

const resolveInstagramUserIds = async (ctx: IngestionContext): Promise<Array<{ id: string; username?: string }>> => {
  const configuredIds = stringArrayConfig(ctx, ['ensembleInstagramUserIds', 'instagramUserIds', 'userIds']);
  const configuredNames = stringArrayConfig(ctx, ['ensembleInstagramUsernames', 'instagramUsernames', 'usernames']);
  const resolved: Array<{ id: string; username?: string }> = configuredIds.map((id) => ({ id }));
  for (const username of configuredNames) {
    const json = await ensembleDataRequest('instagram/user/info', { username });
    const data = asRecord(json.data);
    const id = firstString(data, ['pk', 'id', 'user_id']);
    if (id) resolved.push({ id, username });
  }
  if (resolved.length > 0) return resolved;

  const query = queryFromContext(ctx);
  if (!query || connectorConfig(ctx).discoverInstagramUsersFromKeywords === false) return [];
  const json = await ensembleDataRequest('instagram/search', { text: query });
  const users = firstArray(asRecord(json.data), ['users']).slice(0, 2);
  const discovered: Array<{ id: string; username?: string }> = [];
  for (const user of users) {
    const id = firstString(user, ['pk', 'id', 'user_id']);
    if (id) discovered.push({ id, username: firstString(user, ['username']) ?? undefined });
  }
  return discovered;
};

export const fetchEnsembleInstagramMentions = async (ctx: IngestionContext): Promise<CanonicalMentionDraft[]> => {
  const users = await resolveInstagramUserIds(ctx);
  const drafts: CanonicalMentionDraft[] = [];
  for (const user of users) {
    const remaining = ctx.maxItems - drafts.length;
    if (remaining <= 0) break;
    const json = await ensembleDataRequest('instagram/user/posts', {
      user_id: user.id,
      depth: depthFor(remaining, 10, 2),
      oldest_timestamp: oldestTimestamp(ctx),
      chunk_size: Math.min(20, Math.max(1, remaining)),
      start_cursor: '',
      alternative_method: false,
    });
    const root = asRecord(json.data) ?? json;
    drafts.push(...mapInstagramPosts(firstArray(root, ['posts', 'data']), ctx, user));
  }
  return drafts.slice(0, ctx.maxItems);
};
