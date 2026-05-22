import { XMLParser } from 'fast-xml-parser';
import { sha256 } from '../lib/crypto.js';
import { webSearch, type SearchResult } from '../connectors/search/router.js';
import type { CanonicalMentionDraft } from '../connectors/types.js';

export const INDONESIAN_NEWS_SOURCES = [
  'kompas.com',
  'detik.com',
  'cnnindonesia.com',
  'tempo.co',
  'antaranews.com',
  'tirto.id',
  'kumparan.com',
  'liputan6.com',
  'cnbcindonesia.com',
  'bisnis.com',
  'kontan.co.id',
] as const;

const INDONESIAN_RSS_FEEDS: Array<{ domain: string; url: string }> = [
  { domain: 'tempo.co', url: 'https://rss.tempo.co/nasional' },
  { domain: 'antaranews.com', url: 'https://www.antaranews.com/rss/terkini.xml' },
  { domain: 'cnnindonesia.com', url: 'https://www.cnnindonesia.com/nasional/rss' },
  { domain: 'cnbcindonesia.com', url: 'https://www.cnbcindonesia.com/news/rss' },
  { domain: 'kompas.com', url: 'https://www.kompas.com/rss' },
  { domain: 'detik.com', url: 'https://rss.detik.com/index.php/detikcom' },
  { domain: 'liputan6.com', url: 'https://www.liputan6.com/feed/rss' },
];

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

export type IndonesianNewsItem = SearchResult & {
  sourceDomain: string;
  searchQuery: string;
};

export type IndonesianNewsSearchResult = {
  query: string;
  sources: string[];
  providerPriority: string[];
  results: IndonesianNewsItem[];
  errors: string[];
};

const normalizeQuery = (value: string): string => value.replace(/\s+/g, ' ').trim();

const hostFor = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const matchesSource = (host: string, source: string): boolean => host === source || host.endsWith(`.${source}`);

const fetchWithTimeout = async (url: string, timeoutMs = 12_000): Promise<Response> => {
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { headers: { Accept: 'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.5' }, signal: ac.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const stripHtml = (value: string): string => value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const parseRssDate = (value?: string): string | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

const queryTokens = (query: string): string[] => query.toLowerCase().split(/\W+/).filter((token) => token.length > 3);

const scoreText = (text: string, tokens: string[]): number => {
  const lower = text.toLowerCase();
  if (tokens.length === 0) return 1;
  return tokens.reduce((score, token) => score + (lower.includes(token) ? 1 : 0), 0);
};

const sourceList = (sources?: string[]): string[] => {
  const cleaned = (sources ?? INDONESIAN_NEWS_SOURCES).map((source) => source.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, ''));
  return [...new Set(cleaned)].filter(Boolean).slice(0, 10);
};

const rssFallback = async (query: string, maxResults: number, sources: string[]): Promise<IndonesianNewsItem[]> => {
  const tokens = queryTokens(query);
  const allowed = new Set(sources);
  const feeds = INDONESIAN_RSS_FEEDS.filter((feed) => allowed.size === 0 || allowed.has(feed.domain));
  const settled = await Promise.allSettled(feeds.map(async (feed) => {
    const response = await fetchWithTimeout(feed.url);
    if (!response.ok) throw new Error(`${feed.domain} RSS HTTP ${response.status}`);
    const parsed = parser.parse(await response.text());
    const items: any[] = parsed?.rss?.channel?.item ?? parsed?.feed?.entry ?? [];
    const arr = Array.isArray(items) ? items : [items];
    return arr.filter(Boolean).slice(0, 20).map((item) => {
      const rawLink = item.link?.['@_href'] ?? item.link ?? item.guid ?? '';
      const url = String(rawLink).trim();
      const title = stripHtml(String(item.title ?? ''));
      const snippet = stripHtml(String(item.description ?? item.summary ?? item['content:encoded'] ?? ''));
      const text = `${title} ${snippet}`.trim();
      return {
        title,
        url,
        snippet,
        source: 'rss_fallback',
        publishedAt: parseRssDate(item.pubDate ?? item.published ?? item.updated),
        sourceDomain: feed.domain,
        searchQuery: `${query} rss:${feed.domain}`,
        score: scoreText(text, tokens),
      } satisfies IndonesianNewsItem;
    }).filter((item) => item.title && item.url);
  }));

  const items = settled.flatMap((item) => item.status === 'fulfilled' ? item.value : []);
  const relevant = items.filter((item) => (item.score ?? 0) > 0);
  const ranked = (relevant.length || tokens.length > 0 ? relevant : items)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || new Date(b.publishedAt ?? 0).getTime() - new Date(a.publishedAt ?? 0).getTime());
  return ranked.slice(0, maxResults);
};

export const searchIndonesianNews = async (input: {
  query: string;
  maxResults?: number;
  freshnessDays?: number;
  sources?: string[];
}): Promise<IndonesianNewsSearchResult> => {
  const query = normalizeQuery(input.query || 'berita terkini indonesia');
  const sources = sourceList(input.sources);
  const maxResults = Math.min(50, Math.max(1, input.maxResults ?? 20));
  const perSource = Math.max(1, Math.min(3, Math.ceil(maxResults / Math.max(1, sources.length))));
  const errors: string[] = [];

  const settled = await Promise.allSettled(sources.map(async (sourceDomain) => {
    const searchQuery = `${query} site:${sourceDomain}`;
    const response = await webSearch(searchQuery, {
      maxResults: perSource,
      freshnessDays: input.freshnessDays ?? 30,
      category: 'news',
      region: 'id-ID',
      cacheTtlSec: 1800,
    });
    if (response.errors?.length) errors.push(...response.errors.map((error) => `${sourceDomain}: ${error}`));
    return response.results
      .map((result) => ({ ...result, sourceDomain: hostFor(result.url) || sourceDomain, searchQuery }))
      .filter((result) => matchesSource(result.sourceDomain, sourceDomain));
  }));

  const deduped = new Map<string, IndonesianNewsItem>();
  for (const item of settled) {
    if (item.status === 'rejected') {
      errors.push((item.reason as Error).message);
      continue;
    }
    for (const result of item.value) {
      if (!result.url || deduped.has(result.url)) continue;
      deduped.set(result.url, result);
    }
  }

  if (deduped.size < maxResults) {
    try {
      const broadQuery = `${query} berita indonesia`;
      const broad = await webSearch(broadQuery, {
        maxResults: Math.min(20, Math.max(maxResults * 3, maxResults - deduped.size)),
        freshnessDays: input.freshnessDays ?? 30,
        category: 'news',
        region: 'id-ID',
        cacheTtlSec: 1800,
      });
      if (broad.errors?.length) errors.push(...broad.errors.map((error) => `broad: ${error}`));
      for (const result of broad.results) {
        if (!result.url || deduped.has(result.url)) continue;
        const sourceDomain = hostFor(result.url);
        if (!sources.some((source) => matchesSource(sourceDomain, source))) continue;
        deduped.set(result.url, {
          ...result,
          sourceDomain,
          searchQuery: broadQuery,
        });
      }
    } catch (error) {
      errors.push((error as Error).message);
    }
  }

  if (deduped.size < maxResults) {
    const rssItems = await rssFallback(query, maxResults - deduped.size, sources);
    for (const result of rssItems) {
      if (!result.url || deduped.has(result.url)) continue;
      deduped.set(result.url, result);
    }
  }

  return {
    query,
    sources,
    providerPriority: ['searxng', 'ddg_html', 'ddg_ia'],
    results: [...deduped.values()].slice(0, maxResults),
    errors,
  };
};

export const indonesianNewsToDrafts = (topicId: string, items: IndonesianNewsItem[]): CanonicalMentionDraft[] =>
  items.map((item) => ({
    topicId,
    platform: 'web',
    sourceType: 'news_article',
    sourceId: item.url,
    sourceUrl: item.url,
    sourceUrlHash: sha256(item.url),
    title: item.title,
    text: [item.title, item.snippet, `Source: ${item.sourceDomain}`].filter(Boolean).join('\n'),
    language: 'id',
    author: { displayName: item.sourceDomain, profileUrl: `https://${item.sourceDomain}` },
    publishedAt: item.publishedAt ?? null,
    metrics: { engagementTotal: 0 },
  }));