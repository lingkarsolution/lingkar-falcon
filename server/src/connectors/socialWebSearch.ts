import { sha256 } from '../lib/crypto.js';
import type { Platform, SourceType } from '../types.js';
import type { CanonicalMentionDraft, IngestionContext } from './types.js';
import { webSearch, type SearchResult } from './search/router.js';

type SocialSearchMode = 'auto' | 'web' | 'paid';

const SOCIAL_HOSTS: Record<string, Platform> = {
  'x.com': 'x',
  'twitter.com': 'x',
  'instagram.com': 'instagram',
  'www.instagram.com': 'instagram',
  'facebook.com': 'facebook',
  'www.facebook.com': 'facebook',
  'm.facebook.com': 'facebook',
  'tiktok.com': 'tiktok',
  'www.tiktok.com': 'tiktok',
  'threads.net': 'threads',
  'www.threads.net': 'threads',
  'youtube.com': 'youtube',
  'www.youtube.com': 'youtube',
  'youtu.be': 'youtube',
};

const PLATFORM_QUERY: Record<Platform, { site: string; sourceType: SourceType }> = {
  x: { site: 'site:x.com', sourceType: 'social_post' },
  instagram: { site: 'site:instagram.com', sourceType: 'social_post' },
  facebook: { site: 'site:facebook.com', sourceType: 'social_post' },
  tiktok: { site: 'site:tiktok.com', sourceType: 'video' },
  threads: { site: 'site:threads.net', sourceType: 'social_post' },
  youtube: { site: 'site:youtube.com/watch', sourceType: 'video' },
  news: { site: '', sourceType: 'web_page' },
  rss: { site: '', sourceType: 'rss_item' },
  web: { site: '', sourceType: 'web_page' },
  gdelt: { site: '', sourceType: 'news_article' },
  reddit: { site: 'site:reddit.com', sourceType: 'social_post' },
  bluesky: { site: 'site:bsky.app', sourceType: 'social_post' },
  mastodon: { site: '', sourceType: 'social_post' },
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const textList = (ctx: IngestionContext, keys: string[]): string[] => {
  const config = asRecord(ctx.connectorConfig);
  for (const key of keys) {
    const value = config[key];
    if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
    if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
};

const normalizeToken = (value: string): string => value.trim().replace(/^[@#]+/, '').trim();

const uniqueStrings = (items: string[]): string[] => [...new Set(items.map((item) => item.trim()).filter(Boolean))];

const quoteTerm = (value: string): string => {
  const normalized = value.trim();
  if (!normalized) return '';
  if (/^[-#@\w.:/]+$/u.test(normalized)) return normalized;
  return `"${normalized.replace(/"/g, '')}"`;
};

const costMode = (ctx: IngestionContext): string => String(asRecord(ctx.connectorConfig).costMode ?? 'balanced').toLowerCase();

const socialSearchMode = (ctx: IngestionContext): SocialSearchMode => {
  const config = asRecord(ctx.connectorConfig);
  const raw = String(config.socialSearchProvider ?? config.socialSearchMode ?? config.searchProvider ?? '').toLowerCase();
  if (['web', 'free', 'open', 'duckduckgo', 'ddg', 'searxng'].includes(raw)) return 'web';
  if (['paid', 'api', 'ensemble', 'ensembledata'].includes(raw)) return 'paid';
  return 'auto';
};

export const shouldUseSocialWebSearchFirst = (ctx: IngestionContext): boolean => {
  const config = asRecord(ctx.connectorConfig);
  if (config.preferWebSearch === false || config.useWebSearchForSocial === false) return false;
  return socialSearchMode(ctx) !== 'paid';
};

export const paidSocialApiAllowed = (ctx: IngestionContext): boolean => {
  const config = asRecord(ctx.connectorConfig);
  if (config.allowPaidSocialSearch === false || config.useEnsembleDataForSearch === false) return false;
  const searchMode = socialSearchMode(ctx);
  if (searchMode === 'web') return false;
  const mode = costMode(ctx);
  if (mode === 'free_only') return false;
  if (mode === 'manual_paid' && searchMode !== 'paid') return false;
  return true;
};

const freshnessDays = (ctx: IngestionContext): number => {
  const explicit = Number(asRecord(ctx.connectorConfig).freshnessDays ?? asRecord(ctx.connectorConfig).days);
  if (Number.isFinite(explicit) && explicit > 0) return Math.min(90, Math.max(1, Math.round(explicit)));
  if (!ctx.dateFrom) return 30;
  const days = Math.ceil((Date.now() - new Date(ctx.dateFrom).getTime()) / 86_400_000);
  return Math.min(90, Math.max(1, Number.isFinite(days) ? days : 30));
};

const regionCode = (ctx: IngestionContext): string | undefined => {
  const region = (ctx.regions ?? []).join(' ').toLowerCase();
  if (region.includes('indonesia') || region.includes('jakarta') || region.includes('java') || region.includes('bali')) return 'id-id';
  return undefined;
};

const stringConfig = (ctx: IngestionContext, keys: string[]): string[] => {
  const config = asRecord(ctx.connectorConfig);
  for (const key of keys) {
    const value = config[key];
    if (typeof value === 'string' && value.trim()) return [value.trim()];
  }
  return [];
};

const termsFromContext = (ctx: IngestionContext): string[] => uniqueStrings([
  ...ctx.keywords.filter((keyword) => !keyword.trim().startsWith('#') && !keyword.trim().startsWith('@')),
  ...stringConfig(ctx, ['searchFocus', 'query', 'keyword']),
  ...textList(ctx, ['includeKeywords', 'extraKeywords']),
  ...textList(ctx, ['exactPhrases']),
].map(normalizeToken));

const hashtagsFromContext = (ctx: IngestionContext): string[] => uniqueStrings([
  ...ctx.keywords.filter((keyword) => keyword.trim().startsWith('#')),
  ...textList(ctx, ['hashtags', 'hashtag']),
].map(normalizeToken));

const handlesFromContext = (ctx: IngestionContext, platform: Platform): string[] => uniqueStrings([
  ...ctx.keywords.filter((keyword) => keyword.trim().startsWith('@')),
  ...textList(ctx, ['handles', 'usernames', 'username']),
  ...textList(ctx, [`${platform}Handles`, `${platform}Usernames`, `${platform}Username`]),
].map((value) => normalizeToken(value.replace(/^https?:\/\/[^/]+\//i, '').split(/[/?#]/)[0] ?? value)));

const excludedTermsFromContext = (ctx: IngestionContext): string[] => uniqueStrings([
  ...ctx.excludeKeywords,
  ...textList(ctx, ['excludeKeywords']),
  ...textList(ctx, ['excludeHashtags']).map(normalizeToken),
  ...textList(ctx, ['excludeHandles']).map(normalizeToken),
].map(normalizeToken));

const hashtagTerm = (platform: Platform, hashtag: string): string => {
  if (platform === 'instagram') return `"instagram.com/explore/tags/${hashtag}"`;
  if (platform === 'tiktok') return `"tiktok.com/tag/${hashtag}"`;
  if (platform === 'youtube') return `"youtube.com/hashtag/${hashtag}"`;
  return `#${hashtag}`;
};

const handleTerm = (platform: Platform, handle: string): string => {
  if (platform === 'x') return `"x.com/${handle}"`;
  if (platform === 'instagram') return `"instagram.com/${handle}"`;
  if (platform === 'facebook') return `"facebook.com/${handle}"`;
  if (platform === 'tiktok') return `"tiktok.com/@${handle}"`;
  if (platform === 'threads') return `"threads.net/@${handle}"`;
  if (platform === 'youtube') return `"youtube.com/@${handle}"`;
  return quoteTerm(handle);
};

const buildSocialWebQueries = (ctx: IngestionContext, platform: Platform): string[] => {
  const spec = PLATFORM_QUERY[platform];
  if (!spec?.site) return [];
  const terms = termsFromContext(ctx).slice(0, 5).map(quoteTerm).filter(Boolean);
  const hashtags = hashtagsFromContext(ctx).slice(0, 5);
  const handles = handlesFromContext(ctx, platform).slice(0, 5);
  const hashtagTerms = hashtags.map((hashtag) => hashtagTerm(platform, hashtag));
  const handleTerms = handles.map((handle) => handleTerm(platform, handle));
  const excludedTerms = excludedTermsFromContext(ctx).slice(0, 6).map((term) => `-${quoteTerm(term)}`).filter(Boolean);
  const exclusionQuery = excludedTerms.length > 0 ? ` ${excludedTerms.join(' ')}` : '';
  const primaryTerms = [...terms, ...hashtagTerms].filter(Boolean);
  const queries = [
    primaryTerms.length > 0 ? `${spec.site} (${primaryTerms.join(' OR ')})${exclusionQuery}` : '',
    handleTerms.length > 0 ? `${spec.site} (${handleTerms.join(' OR ')})${exclusionQuery}` : '',
  ];
  return uniqueStrings(queries).slice(0, Number(asRecord(ctx.connectorConfig).maxWebSearchQueries ?? 2));
};

const platformFromUrl = (url: string): Platform | null => {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return SOCIAL_HOSTS[host] ?? null;
  } catch {
    return null;
  }
};

const sourceIdFromUrl = (url: string, platform: Platform): string | null => {
  try {
    const parsed = new URL(url);
    if (platform === 'youtube') return parsed.searchParams.get('v') ?? parsed.pathname.split('/').filter(Boolean).pop() ?? null;
    if (platform === 'x') return parsed.pathname.match(/\/status\/(\d+)/)?.[1] ?? null;
    if (platform === 'instagram') return parsed.pathname.match(/\/(?:p|reel|tv)\/([^/?#]+)/)?.[1] ?? null;
    if (platform === 'tiktok') return parsed.pathname.match(/\/video\/(\d+)/)?.[1] ?? null;
    if (platform === 'threads') return parsed.pathname.match(/\/(?:post|t)\/([^/?#]+)/)?.[1] ?? null;
    if (platform === 'facebook') return parsed.pathname.split('/').filter(Boolean).slice(-2).join('/') || null;
    return parsed.pathname.split('/').filter(Boolean).pop() ?? null;
  } catch {
    return null;
  }
};

const authorFromUrl = (url: string, platform: Platform): CanonicalMentionDraft['author'] => {
  try {
    const path = new URL(url).pathname.split('/').filter(Boolean);
    const username = platform === 'tiktok'
      ? path.find((part) => part.startsWith('@'))?.replace(/^@/, '') ?? null
      : platform === 'youtube' && path[0]?.startsWith('@')
        ? path[0].replace(/^@/, '')
        : path[0] && !['watch', 'hashtag', 'explore', 'p', 'reel', 'tv', 'status', 'post', 't'].includes(path[0])
          ? path[0].replace(/^@/, '')
          : null;
    return username ? { username, displayName: username, profileUrl: profileUrl(platform, username) } : null;
  } catch {
    return null;
  }
};

const profileUrl = (platform: Platform, username: string): string | null => {
  if (platform === 'x') return `https://x.com/${username}`;
  if (platform === 'instagram') return `https://www.instagram.com/${username}/`;
  if (platform === 'facebook') return `https://www.facebook.com/${username}`;
  if (platform === 'tiktok') return `https://www.tiktok.com/@${username}`;
  if (platform === 'threads') return `https://www.threads.net/@${username}`;
  if (platform === 'youtube') return `https://www.youtube.com/@${username}`;
  return null;
};

const resultToDraft = (ctx: IngestionContext, platform: Platform, result: SearchResult): CanonicalMentionDraft | null => {
  if (platformFromUrl(result.url) !== platform) return null;
  const spec = PLATFORM_QUERY[platform];
  const sourceId = sourceIdFromUrl(result.url, platform);
  const text = [result.title, result.snippet].map((value) => value?.trim()).filter(Boolean).join('\n');
  if (!text && !result.url) return null;
  return {
    topicId: ctx.topicId,
    platform,
    sourceType: spec.sourceType,
    sourceId,
    sourceUrl: result.url,
    sourceUrlHash: sha256(result.url),
    title: result.title || null,
    text,
    language: null,
    author: authorFromUrl(result.url, platform),
    publishedAt: result.publishedAt ?? null,
    media: [],
    metrics: { engagementTotal: 0 },
  };
};

export const fetchSocialWebSearchMentions = async (ctx: IngestionContext, platform: Platform): Promise<CanonicalMentionDraft[]> => {
  const queries = buildSocialWebQueries(ctx, platform);
  if (queries.length === 0) return [];
  const requested = Math.max(1, Number(ctx.maxItems));
  const drafts: CanonicalMentionDraft[] = [];
  const seenUrls = new Set<string>();
  for (const query of queries) {
    const { results } = await webSearch(query, {
      maxResults: Math.min(Math.max(requested, 10), 30),
      freshnessDays: freshnessDays(ctx),
      region: regionCode(ctx),
      safeSearch: 'moderate',
      cacheTtlSec: 21_600,
      provider: socialSearchMode(ctx) === 'web' ? 'auto' : undefined,
    });
    for (const result of results) {
      if (seenUrls.has(result.url)) continue;
      const draft = resultToDraft(ctx, platform, result);
      if (!draft) continue;
      seenUrls.add(result.url);
      drafts.push(draft);
      if (drafts.length >= requested) break;
    }
    if (drafts.length >= requested) break;
  }
  return drafts;
};