// GDELT DOC 2.0 API: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
// Free, no key. Searches the last three months of global news article text.
import { sha256 } from '../lib/crypto.js';
import { cache } from '../lib/cache.js';
import { webSearch } from './search/router.js';
import type { SourceConnector, CanonicalMentionDraft, IngestionContext, ConnectorHealth } from './types.js';

const BASE = 'https://api.gdeltproject.org/api/v2/doc/doc';
const DEFAULT_TIMESPAN_DAYS = 30;
const MAX_RECORDS = 250;

export type GdeltArticle = {
  title: string;
  url: string;
  domain?: string | null;
  language?: string | null;
  sourceCountry?: string | null;
  publishedAt?: string | null;
  socialImage?: string | null;
};

export type GdeltSearchResult = {
  query: string;
  url: string;
  count: number;
  articles: GdeltArticle[];
};

type GdeltSearchInput = {
  query: string;
  maxRecords?: number;
  timespanDays?: number;
  dateFrom?: string;
  dateTo?: string;
  sort?: 'datedesc' | 'dateasc' | 'hybridrel' | 'tonedesc' | 'toneasc';
};

const fetchWithTimeout = async (url: string, timeoutMs = 25_000): Promise<Response> => {
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: {
        Accept: 'application/json,text/plain;q=0.9,*/*;q=0.5',
        'User-Agent': 'CivicFalcon/0.1 OSINT connector (GDELT DOC 2.0)',
      },
      signal: ac.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
};

const quoteTerm = (term: string): string => {
  const value = term.trim();
  if (!value) return '';
  if (/^(domain|domainis|image(?:facetone|numfaces|ocrmeta|tag|webcount|webtag)|near\d*|repeat\d*|sourcecountry|sourcelang|theme|tone|toneabs):/i.test(value)) {
    return value;
  }
  if (/^".*"$/.test(value)) return value;
  return /\s|[^\w-]/.test(value) ? `"${value.replace(/"/g, '')}"` : value;
};

const buildTopicQuery = (ctx: IngestionContext): string => {
  const include = ctx.keywords.map(quoteTerm).filter(Boolean);
  if (include.length === 0) return '';
  const base = include.length === 1 ? include[0] : `(${include.join(' OR ')})`;
  const exclude = ctx.excludeKeywords.map(quoteTerm).filter(Boolean).map((term) => `-${term}`);
  return [base, ...exclude].join(' ');
};

const toGdeltDate = (iso?: string): string | null => {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
};

export const parseGdeltDate = (value?: string): string | null => {
  if (!value) return null;
  const compact = value.replace(/[^0-9]/g, '');
  const match = compact.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`;
};

const buildGdeltUrl = (input: GdeltSearchInput): URL => {
  const url = new URL(BASE);
  url.searchParams.set('query', input.query);
  url.searchParams.set('mode', 'artlist');
  url.searchParams.set('maxrecords', String(Math.min(MAX_RECORDS, Math.max(1, input.maxRecords ?? 50))));
  url.searchParams.set('format', 'json');
  url.searchParams.set('sort', input.sort ?? 'datedesc');

  const start = toGdeltDate(input.dateFrom);
  const end = toGdeltDate(input.dateTo);
  if (start) url.searchParams.set('startdatetime', start);
  if (end) url.searchParams.set('enddatetime', end);
  if (!start && !end) {
    const days = Math.min(90, Math.max(1, input.timespanDays ?? DEFAULT_TIMESPAN_DAYS));
    url.searchParams.set('timespan', `${days}d`);
  }
  return url;
};

const normalizeArticle = (article: any): GdeltArticle | null => {
  const url = String(article.url ?? '').trim();
  const title = String(article.title ?? '').trim();
  if (!url || !title) return null;
  return {
    title,
    url,
    domain: article.domain ?? null,
    language: article.language ?? null,
    sourceCountry: article.sourcecountry ?? article.sourceCountry ?? null,
    publishedAt: parseGdeltDate(article.seendate ?? article.seenDate),
    socialImage: article.socialimage ?? article.socialImage ?? null,
  };
};

const simplifyQuery = (query: string): string => query
  .replace(/[()]/g, ' ')
  .replace(/\bOR\b/gi, ' ')
  .replace(/-/g, ' ')
  .replace(/"/g, '')
  .replace(/\s+/g, ' ')
  .trim();

export const searchGdeltArticles = async (input: GdeltSearchInput): Promise<GdeltSearchResult> => {
  const query = input.query.trim();
  if (!query) return { query, url: '', count: 0, articles: [] };

  const candidates = [...new Set([query, simplifyQuery(query)].filter(Boolean))];
  let lastError: Error | null = null;
  for (const candidate of candidates) {
    const url = buildGdeltUrl({ ...input, query: candidate });
    const cacheKey = `gdelt:${sha256(url.toString())}`;
    const cached = cache.get<GdeltSearchResult>(cacheKey);
    if (cached) return cached;

    try {
      const response = await fetchWithTimeout(url.toString(), 35_000);
      if (!response.ok) throw new Error(`GDELT HTTP ${response.status}`);

      const text = await response.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`GDELT returned non-JSON response: ${text.slice(0, 180)}`);
      }

      const articles = (Array.isArray(data.articles) ? data.articles : [])
        .map(normalizeArticle)
        .filter(Boolean) as GdeltArticle[];
      const result = { query: candidate, url: url.toString(), count: articles.length, articles };
      cache.set(cacheKey, result, 900);
      return result;
    } catch (error) {
      lastError = error as Error;
    }
  }

  throw lastError ?? new Error('GDELT request failed');
};

export const searchGdeltArticlesFallback = async (input: GdeltSearchInput): Promise<GdeltSearchResult> => {
  const query = simplifyQuery(input.query) || input.query.trim();
  if (!query) return { query, url: '', count: 0, articles: [] };
  const maxRecords = Math.min(MAX_RECORDS, Math.max(1, input.maxRecords ?? 50));
  const days = Math.min(90, Math.max(1, input.timespanDays ?? DEFAULT_TIMESPAN_DAYS));
  const response = await webSearch(`${query} berita indonesia`, {
    maxResults: Math.min(30, maxRecords),
    freshnessDays: days,
    category: 'news',
    region: 'id-ID',
    cacheTtlSec: 1800,
  });
  const articles = response.results.map((result) => {
    let domain: string | null = null;
    try { domain = new URL(result.url).hostname.replace(/^www\./, ''); } catch {}
    return {
      title: result.title,
      url: result.url,
      domain,
      language: null,
      sourceCountry: null,
      publishedAt: result.publishedAt ?? null,
      socialImage: null,
    } satisfies GdeltArticle;
  });
  return { query, url: `websearch:fallback:${response.provider}`, count: articles.length, articles };
};

export const gdeltConnector: SourceConnector = {
  platform: 'gdelt',

  async testConnection(): Promise<ConnectorHealth> {
    try {
      const result = await searchGdeltArticles({ query: 'climate', maxRecords: 1, timespanDays: 1 });
      return { ok: true, status: 'active', message: `GDELT DOC 2.0 reachable (${result.count} sample records)`, details: { endpoint: BASE } };
    } catch (e) {
      try {
        const fallback = await searchGdeltArticlesFallback({ query: 'climate', maxRecords: 1, timespanDays: 1 });
        return { ok: true, status: 'limited', message: `GDELT primary failed (${(e as Error).message}); web-search fallback returned ${fallback.count} sample records`, details: { endpoint: BASE, fallback: fallback.url } };
      } catch {
        const message = (e as Error).name === 'AbortError'
          ? 'GDELT timed out after 35s and fallback failed'
          : `GDELT error: ${(e as Error).message}`;
        return { ok: false, status: 'failed', message };
      }
    }
  },

  async fetchMentions(ctx: IngestionContext): Promise<CanonicalMentionDraft[]> {
    const query = buildTopicQuery(ctx);
    if (!query) return [];

    const timespanDays = Number(ctx.connectorConfig?.timespanDays ?? ctx.connectorConfig?.historicalDays ?? DEFAULT_TIMESPAN_DAYS);
    let result: GdeltSearchResult;
    try {
      result = await searchGdeltArticles({
        query,
        maxRecords: ctx.maxItems,
        timespanDays,
        dateFrom: ctx.dateFrom,
        dateTo: ctx.dateTo,
        sort: 'datedesc',
      });
    } catch {
      result = await searchGdeltArticlesFallback({ query, maxRecords: ctx.maxItems, timespanDays });
    }
    if (result.count === 0) result = await searchGdeltArticlesFallback({ query, maxRecords: ctx.maxItems, timespanDays });

    return result.articles.slice(0, ctx.maxItems).map((article) => ({
      topicId: ctx.topicId,
      platform: 'gdelt',
      sourceType: 'news_article',
      sourceId: article.url,
      sourceUrl: article.url,
      sourceUrlHash: sha256(article.url),
      title: article.title,
      text: [article.title, article.domain ? `Source: ${article.domain}` : null, article.sourceCountry ? `Country: ${article.sourceCountry}` : null]
        .filter(Boolean)
        .join('\n'),
      language: article.language ?? null,
      author: { displayName: article.domain ?? 'GDELT', profileUrl: article.domain ? `https://${article.domain}` : null },
      publishedAt: article.publishedAt ?? null,
      metrics: { views: null, likes: null, comments: null, shares: null, engagementTotal: 0, reachEstimate: null },
    }));
  },
};
