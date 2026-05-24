import { config } from '../config.js';
import { sha256 } from '../lib/crypto.js';
import type { MentionMediaAsset, Platform } from '../types.js';
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
  if (record) return firstString(record, ['text', 'simpleText', 'title', 'name', 'caption', 'runs.0.text', 'accessibility.accessibilityData.label']);
  return null;
};

const firstString = (source: unknown, paths: string[]): string | null => textValue(firstValue(source, paths));

const extractUrl = (value: unknown): string | null => {
  if (typeof value === 'string') return /^https?:\/\//i.test(value.trim()) ? value.trim() : null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = extractUrl(item);
      if (url) return url;
    }
  }
  const record = asRecord(value);
  if (!record) return null;
  for (const key of ['url', 'src', 'uri', 'media_url', 'media_url_https', 'display_url', 'thumbnail_url', 'cover_url', 'play_addr', 'download_addr', 'url_list', 'thumbnails', 'candidates']) {
    const url = extractUrl(record[key]);
    if (url) return url;
  }
  return null;
};

const firstUrl = (source: unknown, paths: string[]): string | null => {
  for (const path of paths) {
    const url = extractUrl(getPath(source, path));
    if (url) return url;
  }
  return null;
};

const firstNumber = (source: unknown, paths: string[]): number | null => {
  const value = firstValue(source, paths);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = textValue(value);
  if (text) {
    const normalized = text.replace(/,/g, '').trim();
    const match = normalized.match(/(-?\d+(?:\.\d+)?)\s*([kmb])?/i);
    if (!match) return null;
    const parsed = Number(match[1]);
    if (!Number.isFinite(parsed)) return null;
    const suffix = match[2]?.toLowerCase();
    const multiplier = suffix === 'k' ? 1_000 : suffix === 'm' ? 1_000_000 : suffix === 'b' ? 1_000_000_000 : 1;
    return Math.round(parsed * multiplier);
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

const ensembleEmpty = (platform: Platform, reason: string): Error =>
  new Error(`EnsembleData ${platform} returned no items: ${reason}`);

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

const mediaAsset = (type: MentionMediaAsset['type'], sourceUrl: string | null, options: { thumbnailUrl?: string | null; transcript?: string | null } = {}): MentionMediaAsset[] => {
  if (!sourceUrl) return [];
  return [{
    id: `media_${sha256(`${type}:${sourceUrl}`).slice(0, 16)}`,
    type,
    sourceUrl,
    thumbnailUrl: options.thumbnailUrl ?? null,
    transcript: options.transcript ?? null,
    status: 'queued',
  }];
};

const youtubeVideoId = (post: unknown): string | null => {
  const direct = firstString(post, ['videoId', 'video_id', 'id.videoId', 'id', 'video.id', 'video.videoId', 'watchEndpoint.videoId', 'navigationEndpoint.watchEndpoint.videoId']);
  if (direct && /^[a-zA-Z0-9_-]{8,}$/.test(direct)) return direct;
  const url = firstString(post, ['url', 'videoUrl', 'video_url', 'watchUrl', 'navigationEndpoint.commandMetadata.webCommandMetadata.url']);
  if (!url) return direct;
  const match = url.match(/[?&]v=([a-zA-Z0-9_-]+)/) ?? url.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? direct;
};

const youtubeRenderer = (post: unknown): unknown =>
  asRecord(getPath(post, 'videoRenderer'))
  ?? asRecord(getPath(post, 'compactVideoRenderer'))
  ?? asRecord(getPath(post, 'gridVideoRenderer'))
  ?? asRecord(getPath(post, 'reelItemRenderer'))
  ?? post;

const youtubeWatchUrl = (post: unknown, sourceId: string | null): string | null => {
  const raw = firstString(post, ['url', 'videoUrl', 'video_url', 'watchUrl', 'navigationEndpoint.commandMetadata.webCommandMetadata.url', 'commandMetadata.webCommandMetadata.url']);
  if (raw?.startsWith('http')) return raw;
  if (raw?.startsWith('/')) return `https://www.youtube.com${raw}`;
  return sourceId ? `https://www.youtube.com/watch?v=${sourceId}` : null;
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
  for (const rawPost of posts) {
    const post = youtubeRenderer(rawPost);
    const sourceId = youtubeVideoId(post);
    const sourceUrl = youtubeWatchUrl(post, sourceId);
    const title = firstString(post, ['title', 'title.runs.0.text', 'title.simpleText', 'name', 'headline']);
    const description = firstString(post, ['description', 'descriptionSnippet', 'detailedMetadataSnippets.0.snippetText', 'snippet', 'text', 'shortDescription']);
    const thumbnailUrl = firstUrl(post, ['thumbnail.thumbnails', 'thumbnail', 'thumbnail.url', 'thumbnails', 'thumbnails.high.url', 'thumbnails.medium.url', 'snippet.thumbnails.high.url', 'snippet.thumbnails.medium.url']);
    const channelId = firstString(post, ['channelId', 'channel_id', 'channel.id', 'owner.id', 'longBylineText.runs.0.navigationEndpoint.browseEndpoint.browseId', 'ownerText.runs.0.navigationEndpoint.browseEndpoint.browseId', 'shortBylineText.runs.0.navigationEndpoint.browseEndpoint.browseId']);
    const channelName = firstString(post, ['channelTitle', 'channel_title', 'channel.name', 'owner.name', 'author', 'author.name', 'longBylineText.runs.0.text', 'ownerText.runs.0.text', 'shortBylineText.runs.0.text']);
    const channelPath = firstString(post, ['longBylineText.runs.0.navigationEndpoint.browseEndpoint.canonicalBaseUrl', 'ownerText.runs.0.navigationEndpoint.browseEndpoint.canonicalBaseUrl', 'shortBylineText.runs.0.navigationEndpoint.browseEndpoint.canonicalBaseUrl']);
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
        profileUrl: channelPath ? `https://www.youtube.com${channelPath}` : channelId ? `https://www.youtube.com/channel/${channelId}` : null,
      },
      publishedAt: toIsoDate(firstValue(post, ['publishedAt', 'published_at', 'publishedTime', 'published_time', 'date'])),
      media: mediaAsset('video', sourceUrl, { thumbnailUrl, transcript: cleanText(title, description) }),
      metrics: {
        views: firstNumber(post, ['viewCount', 'views', 'stats.views', 'viewCountText', 'viewCountText.simpleText', 'shortViewCountText', 'shortViewCountText.simpleText']),
        likes: firstNumber(post, ['likeCount', 'likes', 'stats.likes']),
        comments: firstNumber(post, ['commentCount', 'comments', 'stats.comments']),
      },
    });
    if (drafts.length >= ctx.maxItems) break;
  }
  return drafts.filter((draft) => Boolean(draft.text || draft.title || draft.sourceUrl));
};

const tiktokAweme = (post: unknown): unknown => asRecord(getPath(post, 'aweme_info')) ?? asRecord(getPath(post, 'awemeInfo')) ?? post;

const tiktokPostId = (post: unknown, wrapper?: unknown): string | null =>
  firstString(post, ['aweme_id', 'awemeId', 'id', 'video.id'])
  ?? firstString(wrapper, ['doc_id', 'provider_doc_id_str']);

const threadsPostsFromResult = (item: unknown): unknown[] => {
  const nested = [
    ...firstArray(item, ['node.thread.thread_items']),
    ...firstArray(item, ['node.thread.threadItems']),
    ...firstArray(item, ['thread.thread_items']),
    ...firstArray(item, ['thread.threadItems']),
    ...firstArray(item, ['thread_items']),
    ...firstArray(item, ['threadItems']),
  ]
    .map((entry) => asRecord(getPath(entry, 'post')) ?? entry)
    .filter((entry) => asRecord(entry));
  if (nested.length > 0) return nested;
  return [asRecord(getPath(item, 'node.post')) ?? asRecord(getPath(item, 'post')) ?? item];
};

const threadsText = (post: unknown): string | null => {
  const direct = firstString(post, ['text', 'caption.text', 'caption', 'title', 'body', 'description']);
  if (direct) return direct;
  const fragments = firstArray(post, ['text_post_app_info.text_fragments.fragments', 'textPostAppInfo.textFragments.fragments'])
    .map((fragment) => firstString(fragment, ['plaintext', 'text', 'snippet']))
    .filter((fragment): fragment is string => Boolean(fragment));
  return fragments.length > 0 ? fragments.join('') : null;
};

const threadsShortcode = (post: unknown): string | null => {
  const direct = firstString(post, ['shortcode', 'code', 'media.shortcode']);
  if (direct) return direct;
  const url = firstString(post, ['permalink', 'url', 'text_post_app_info.share_info.share_url']);
  return url?.match(/\/post\/([^/?#]+)/i)?.[1] ?? url?.match(/\/t\/([^/?#]+)/i)?.[1] ?? null;
};

const threadsSourceUrl = (post: unknown, username: string | null, sourceId: string | null): string | null => {
  const explicit = firstString(post, ['permalink', 'url', 'text_post_app_info.share_info.share_url', 'share_url']);
  if (explicit) return explicit;
  const shortcode = threadsShortcode(post);
  if (shortcode && username) return `https://www.threads.net/@${username}/post/${shortcode}`;
  if (shortcode) return `https://www.threads.net/t/${shortcode}`;
  return sourceId ? `https://www.threads.net/t/${sourceId}` : null;
};

const mapThreadsPosts = (posts: unknown[], ctx: IngestionContext): CanonicalMentionDraft[] => {
  const drafts: CanonicalMentionDraft[] = [];
  for (const rawPost of posts.flatMap(threadsPostsFromResult)) {
    const post = rawPost;
    const sourceId = firstString(post, ['id', 'pk', 'media_id', 'mediaId']);
    const text = threadsText(post) ?? '';
    const username = firstString(post, ['username', 'user.username', 'owner.username', 'user.name']);
    const displayName = firstString(post, ['user.full_name', 'user.fullName', 'owner.name', 'full_name', 'name']) ?? username;
    const sourceUrl = threadsSourceUrl(post, username, sourceId);
    const mediaType = String(firstValue(post, ['media_type', 'mediaType', '__typename']) ?? '').toLowerCase();
    const videoUrl = firstUrl(post, ['video_versions', 'video_versions.0.url', 'video_url', 'videoUrl', 'media.video_versions', 'media.video_url']);
    const imageUrl = firstUrl(post, ['image_versions2.candidates', 'image_versions2', 'image_url', 'imageUrl', 'media_url', 'mediaUrl', 'carousel_media.0.image_versions2.candidates']);
    const thumbnailUrl = firstUrl(post, ['thumbnail_url', 'thumbnailUrl', 'image_versions2.candidates', 'media.thumbnail_url']);
    const likes = firstNumber(post, ['like_count', 'likeCount', 'metrics.likes', 'text_post_app_info.like_count']);
    const replies = firstNumber(post, ['reply_count', 'replyCount', 'text_post_app_info.reply_count', 'text_post_app_info.direct_reply_count']);
    const reposts = firstNumber(post, ['reshare_count', 'reshareCount', 'repost_count', 'repostCount']);
    const quotes = firstNumber(post, ['quote_count', 'quoteCount']);
    drafts.push({
      topicId: ctx.topicId,
      platform: 'threads',
      sourceType: 'social_post',
      sourceId,
      sourceUrl,
      sourceUrlHash: sourceHash('threads', sourceUrl, sourceId),
      title: null,
      text,
      language: null,
      author: {
        id: firstString(post, ['user.pk', 'user.id', 'owner.id', 'user_id', 'userId']),
        username,
        displayName,
        profileUrl: username ? `https://www.threads.net/@${username}` : null,
        followersCount: firstNumber(post, ['user.follower_count', 'user.followerCount', 'follower_count']),
        verified: Boolean(firstValue(post, ['user.is_verified', 'user.isVerified', 'is_verified'])),
      },
      publishedAt: toIsoDate(firstValue(post, ['timestamp', 'taken_at', 'taken_at_timestamp', 'created_at', 'createdAt'])),
      media: videoUrl || mediaType.includes('video') ? mediaAsset('video', videoUrl ?? sourceUrl, { thumbnailUrl: thumbnailUrl ?? imageUrl, transcript: text }) : mediaAsset('image', imageUrl, { transcript: text }),
      metrics: {
        likes,
        comments: replies,
        reposts,
        quotes,
        views: firstNumber(post, ['view_count', 'viewCount', 'play_count', 'playCount']),
        engagementTotal: (likes ?? 0) + (replies ?? 0) + (reposts ?? 0) + (quotes ?? 0),
      },
    });
    if (drafts.length >= ctx.maxItems) break;
  }
  return drafts.filter((draft) => Boolean(draft.text || draft.sourceUrl));
};

export const fetchEnsembleThreadsMentions = async (ctx: IngestionContext): Promise<CanonicalMentionDraft[]> => {
  const keyword = queryFromContext(ctx);
  if (!keyword) return [];
  const json = await ensembleDataRequest('threads/keyword/search', {
    name: keyword,
    sorting: '1',
  });
  const root = json.data ?? json;
  const posts = Array.isArray(root) ? root : firstArray(root, ['posts', 'data']);
  return mapThreadsPosts(posts, ctx).slice(0, ctx.maxItems);
};

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
  for (const rawPost of posts) {
    const post = tiktokAweme(rawPost);
    const sourceId = tiktokPostId(post, rawPost);
    const title = firstString(post, ['title', 'desc', 'description']);
    const username = firstString(post, ['author.unique_id', 'author.username', 'author.name', 'authorInfo.unique_id', 'authorInfo.username']);
    const displayName = firstString(post, ['author.nickname', 'author.displayName', 'authorInfo.nickname', 'authorInfo.displayName']);
    const sourceUrl = firstString(post, ['share_url', 'shareUrl', 'url', 'webVideoUrl']) ?? (sourceId && username ? `https://www.tiktok.com/@${username}/video/${sourceId}` : null);
    const videoUrl = firstUrl(post, ['video.play_addr.url_list', 'video.download_addr.url_list', 'video.download_no_watermark_addr.url_list', 'video.playAddr.urlList', 'video.downloadAddr.urlList', 'play_addr.url_list', 'download_addr.url_list', 'videoUrl', 'video_url']);
    const thumbnailUrl = firstUrl(post, ['video.cover.url_list', 'video.origin_cover.url_list', 'video.dynamic_cover.url_list', 'cover.url_list', 'cover', 'thumbnail', 'image_post_info.images.0.display_image.url_list']);
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
      media: mediaAsset('video', videoUrl ?? sourceUrl, { thumbnailUrl, transcript: title }),
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
    const isVideo = Boolean(firstValue(post, ['is_video', 'video_url', 'video_versions.0.url'])) || String(firstValue(post, ['media_type', 'product_type']) ?? '').toLowerCase().includes('video');
    const imageUrl = firstUrl(post, ['display_url', 'thumbnail_url', 'image_versions2.candidates', 'carousel_media.0.image_versions2.candidates', 'media_url']);
    const videoUrl = firstUrl(post, ['video_url', 'video_versions', 'carousel_media.0.video_versions', 'media_url']);
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
      media: isVideo ? mediaAsset('video', videoUrl ?? sourceUrl, { thumbnailUrl: imageUrl, transcript: caption }) : mediaAsset('image', imageUrl, { transcript: caption }),
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
    const id = firstString(data, ['pk', 'id', 'user_id', 'user.pk', 'user.id', 'user.user_id']);
    if (id) resolved.push({ id, username });
  }
  if (resolved.length > 0) return resolved;

  const query = queryFromContext(ctx);
  if (!query || connectorConfig(ctx).discoverInstagramUsersFromKeywords === false) return [];
  const json = await ensembleDataRequest('instagram/search', { text: query });
  const users = firstArray(asRecord(json.data), ['users']).slice(0, 2);
  const discovered: Array<{ id: string; username?: string }> = [];
  for (const user of users) {
    const id = firstString(user, ['pk', 'id', 'user_id', 'user.pk', 'user.id', 'user.user_id']);
    if (id) discovered.push({ id, username: firstString(user, ['username', 'user.username']) ?? undefined });
  }
  return discovered;
};

export const fetchEnsembleInstagramMentions = async (ctx: IngestionContext): Promise<CanonicalMentionDraft[]> => {
  const users = await resolveInstagramUserIds(ctx);
  if (users.length === 0) {
    throw ensembleEmpty('instagram', 'Instagram EnsembleData does not provide broad post keyword search. Configure ensembleInstagramUsernames/instagramUsernames or ensembleInstagramUserIds/instagramUserIds on the Instagram connector, or use a topic keyword that resolves to public Instagram users.');
  }
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

const twitterUserIds = async (ctx: IngestionContext): Promise<Array<{ id: string; username?: string }>> => {
  const configuredIds = stringArrayConfig(ctx, ['ensembleTwitterUserIds', 'twitterUserIds', 'xUserIds', 'userIds']);
  const configuredNames = stringArrayConfig(ctx, ['ensembleTwitterUsernames', 'twitterUsernames', 'xUsernames', 'usernames']);
  const resolved: Array<{ id: string; username?: string }> = configuredIds.map((id) => ({ id }));
  for (const username of configuredNames) {
    const json = await ensembleDataRequest('twitter/user/info', { name: username });
    const data = asRecord(json.data);
    const id = firstString(data, ['rest_id', 'id']);
    if (id) resolved.push({ id, username });
  }
  return resolved;
};

export const fetchEnsembleXMentions = async (ctx: IngestionContext): Promise<CanonicalMentionDraft[]> => {
  const users = await twitterUserIds(ctx);
  if (users.length === 0) {
    throw ensembleEmpty('x', 'Twitter/X EnsembleData exposes user timeline and post lookup endpoints, not broad keyword search. Configure ensembleTwitterUsernames/xUsernames or ensembleTwitterUserIds/xUserIds on the X connector.');
  }
  const drafts: CanonicalMentionDraft[] = [];
  for (const user of users) {
    const remaining = ctx.maxItems - drafts.length;
    if (remaining <= 0) break;
    const json = await ensembleDataRequest('twitter/user/tweets', { id: user.id });
    const tweets = firstArray(json, ['data']).slice(0, remaining);
    for (const tweet of tweets) {
      const sourceId = firstString(tweet, ['rest_id', 'id']);
      const text = firstString(tweet, ['legacy.full_text', 'legacy.text', 'full_text', 'text']) ?? '';
      const username = firstString(tweet, ['core.user_results.result.legacy.screen_name']) ?? user.username ?? null;
      const displayName = firstString(tweet, ['core.user_results.result.legacy.name']) ?? username;
      const sourceUrl = sourceId ? (username ? `https://x.com/${username}/status/${sourceId}` : `https://x.com/i/status/${sourceId}`) : null;
      const likes = firstNumber(tweet, ['legacy.favorite_count', 'favorite_count', 'likes']);
      const replies = firstNumber(tweet, ['legacy.reply_count', 'reply_count', 'replies']);
      const reposts = firstNumber(tweet, ['legacy.retweet_count', 'retweet_count', 'retweets']);
      const quotes = firstNumber(tweet, ['legacy.quote_count', 'quote_count']);
      const mediaUrl = firstUrl(tweet, ['legacy.extended_entities.media', 'legacy.entities.media', 'extended_entities.media', 'entities.media']);
      const videoUrl = firstUrl(tweet, ['legacy.extended_entities.media.0.video_info.variants', 'extended_entities.media.0.video_info.variants']);
      const mediaType = String(firstValue(tweet, ['legacy.extended_entities.media.0.type', 'extended_entities.media.0.type', 'legacy.entities.media.0.type']) ?? '').toLowerCase();
      drafts.push({
        topicId: ctx.topicId,
        platform: 'x',
        sourceType: 'social_post',
        sourceId,
        sourceUrl,
        sourceUrlHash: sourceHash('x', sourceUrl, sourceId),
        title: null,
        text,
        language: firstString(tweet, ['legacy.lang', 'lang']),
        author: {
          id: user.id,
          username,
          displayName,
          profileUrl: username ? `https://x.com/${username}` : null,
          followersCount: firstNumber(tweet, ['core.user_results.result.legacy.followers_count']),
          verified: Boolean(firstValue(tweet, ['core.user_results.result.is_blue_verified', 'core.user_results.result.legacy.verified'])),
        },
        publishedAt: toIsoDate(firstValue(tweet, ['legacy.created_at', 'created_at', 'date'])),
        media: mediaType.includes('video') || videoUrl ? mediaAsset('video', videoUrl ?? sourceUrl, { thumbnailUrl: mediaUrl, transcript: text }) : mediaAsset('image', mediaUrl, { transcript: text }),
        metrics: {
          likes,
          comments: replies,
          shares: reposts,
          reposts,
          quotes,
          views: firstNumber(tweet, ['views.count', 'view_count', 'views']),
          engagementTotal: (likes ?? 0) + (replies ?? 0) + (reposts ?? 0) + (quotes ?? 0),
        },
      });
      if (drafts.length >= ctx.maxItems) break;
    }
  }
  return drafts.filter((draft) => Boolean(draft.text || draft.sourceUrl));
};
