// Web search providers — §31 provider waterfall.
import { sha256 } from '../../lib/crypto.js';
import { cache } from '../../lib/cache.js';
import { config } from '../../config.js';

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const DDG_HEADERS: Record<string, string> = {
  'User-Agent': DEFAULT_UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  Referer: 'https://duckduckgo.com/',
  Cookie: 'ah=us-en; l=us-en; ax=v442-1',
};

const FETCH_HEADERS: Record<string, string> = {
  'User-Agent': DEFAULT_UA,
  Accept: 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.5',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'cross-site',
  'Upgrade-Insecure-Requests': '1',
};

const decodeHtmlEntities = (value: string): string => value
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&#x27;/g, "'")
  .replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
  .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));

const stripTags = (html: string): string => decodeHtmlEntities(
  html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' '),
)
  .replace(/[ \t]+/g, ' ')
  .replace(/\s*\n\s*/g, '\n')
  .trim();

const unwrapDdgUrl = (href: string): string => {
  try {
    const normalized = href.startsWith('//') ? `https:${href}` : href;
    const url = new URL(normalized, 'https://duckduckgo.com');
    if (url.pathname === '/l/' || url.pathname.endsWith('/l/')) {
      const real = url.searchParams.get('uddg');
      if (real) return decodeURIComponent(real);
    }
    return normalized;
  } catch {
    return href;
  }
};

export type SearchResult = {
  title: string; url: string; snippet: string;
  publishedAt?: string; source?: string; score?: number;
};

export type SearchOptions = {
  maxResults?: number; freshnessDays?: number;
  region?: string; safeSearch?: 'off' | 'moderate' | 'strict';
  cacheTtlSec?: number;
};

export interface WebSearchProvider {
  name: string;
  costPerQueryUsd: number;
  isAvailable(): boolean;
  search(query: string, opts: SearchOptions): Promise<SearchResult[]>;
}

// Brave Search API — preferred paid
class BraveProvider implements WebSearchProvider {
  name = 'brave';
  costPerQueryUsd = 0.003;
  isAvailable() { return Boolean(config.brave.apiKey); }
  async search(query: string, opts: SearchOptions) {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(opts.maxResults ?? 10));
    if (opts.freshnessDays) url.searchParams.set('freshness', `pd${opts.freshnessDays}`);
    if (opts.safeSearch) url.searchParams.set('safesearch', opts.safeSearch);
    const r = await fetch(url, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': config.brave.apiKey },
    });
    if (!r.ok) throw new Error(`Brave HTTP ${r.status}`);
    const j: any = await r.json();
    return (j.web?.results ?? []).map((x: any) => ({
      title: x.title, url: x.url, snippet: x.description,
      publishedAt: x.age, source: 'brave',
    } as SearchResult));
  }
}

// DuckDuckGo Instant Answer — free, no key, zero-click only
class DDGInstantProvider implements WebSearchProvider {
  name = 'ddg_ia';
  costPerQueryUsd = 0;
  isAvailable() { return true; }
  async search(query: string) {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`DDG IA HTTP ${r.status}`);
    const j: any = await r.json();
    const out: SearchResult[] = [];
    if (j.AbstractURL) out.push({ title: j.Heading, url: j.AbstractURL, snippet: j.AbstractText, source: 'ddg_ia' });
    for (const t of j.RelatedTopics ?? []) {
      if (t.FirstURL) {
        out.push({
          title: String(t.Text ?? '').split(' - ')[0] || t.Text,
          url: t.FirstURL, snippet: t.Text, source: 'ddg_ia',
        });
      }
    }
    return out;
  }
}

// DuckDuckGo HTML endpoint — browser-shaped GET, better real-result coverage than Instant Answer.
class DDGHtmlProvider implements WebSearchProvider {
  name = 'ddg_html';
  costPerQueryUsd = 0;
  isAvailable() { return true; }
  async search(query: string, opts: SearchOptions) {
    const url = new URL('https://html.duckduckgo.com/html/');
    url.searchParams.set('q', query);
    if (opts.region) url.searchParams.set('kl', opts.region);
    const r = await fetch(url, { method: 'GET', headers: DDG_HEADERS, redirect: 'follow' });
    if (!r.ok) throw new Error(`DDG HTML HTTP ${r.status}`);
    const html = await r.text();
    if (/anomaly|unusual traffic|captcha/i.test(html) && !/result__a/.test(html)) {
      throw new Error('DuckDuckGo blocked the request with an anomaly page');
    }

    const results: SearchResult[] = [];
    const blockRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]*class="[^"]*result__a|<\/div>\s*<\/div>\s*<\/div>)/gi;
    let match: RegExpExecArray | null;
    while ((match = blockRe.exec(html)) !== null) {
      const title = stripTags(match[2]);
      const snippetMatch = (match[3] || '').match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/i);
      const snippet = snippetMatch ? stripTags(snippetMatch[1]) : '';
      const resultUrl = unwrapDdgUrl(decodeHtmlEntities(match[1]));
      if (!title || !/^https?:/i.test(resultUrl)) continue;
      if (results.some((item) => item.url === resultUrl)) continue;
      results.push({ title, url: resultUrl, snippet, source: 'ddg_html' });
      if (results.length >= (opts.maxResults ?? 10)) break;
    }
    return results;
  }
}

// SearXNG self-hosted aggregator
class SearxngProvider implements WebSearchProvider {
  name = 'searxng';
  costPerQueryUsd = 0;
  isAvailable() { return Boolean(config.searxng.url); }
  async search(query: string, opts: SearchOptions) {
    const safe = opts.safeSearch === 'strict' ? 2 : opts.safeSearch === 'off' ? 0 : 1;
    const url = `${config.searxng.url}/search?q=${encodeURIComponent(query)}&format=json&safesearch=${safe}`;
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`SearXNG HTTP ${r.status}`);
    const j: any = await r.json();
    return (j.results ?? []).slice(0, opts.maxResults ?? 10).map((x: any) => ({
      title: x.title, url: x.url, snippet: x.content, source: 'searxng', score: x.score,
    } as SearchResult));
  }
}

// Tavily — optional premium fallback
class TavilyProvider implements WebSearchProvider {
  name = 'tavily';
  costPerQueryUsd = 0.008;
  isAvailable() { return Boolean(config.tavily.apiKey); }
  async search(query: string, opts: SearchOptions) {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: config.tavily.apiKey,
        query, max_results: opts.maxResults ?? 10,
        search_depth: 'basic',
      }),
    });
    if (!r.ok) throw new Error(`Tavily HTTP ${r.status}`);
    const j: any = await r.json();
    return (j.results ?? []).map((x: any) => ({
      title: x.title, url: x.url, snippet: x.content, source: 'tavily', score: x.score,
    } as SearchResult));
  }
}

const providers: WebSearchProvider[] = [
  new SearxngProvider(),
  new DDGHtmlProvider(),
  new DDGInstantProvider(),
  new BraveProvider(),
  new TavilyProvider(),
];

export const webSearch = async (query: string, opts: SearchOptions = {}): Promise<{
  results: SearchResult[]; provider: string; cached: boolean;
}> => {
  const cacheKey = `search:${sha256(JSON.stringify({ query, opts }))}`;
  const hit = cache.get<{ results: SearchResult[]; provider: string }>(cacheKey);
  if (hit) return { ...hit, cached: true };

  const minResults = 3;
  const errors: string[] = [];
  for (const p of providers) {
    if (!p.isAvailable()) continue;
    try {
      const results = await p.search(query, opts);
      if (results.length >= minResults || providers.indexOf(p) === providers.length - 1) {
        const payload = { results, provider: p.name };
        cache.set(cacheKey, payload, opts.cacheTtlSec ?? 21600);
        return { ...payload, cached: false };
      }
    } catch (e) {
      errors.push(`${p.name}: ${(e as Error).message}`);
    }
  }
  return { results: [], provider: 'none', cached: false };
};

export const searchProvidersStatus = () =>
  providers.map((p) => ({ name: p.name, available: p.isAvailable(), costPerQueryUsd: p.costPerQueryUsd }));

const FETCH_DEFAULT_CHARS = 8000;
const FETCH_MAX_CHARS = 40000;

export const webFetch = async (targetUrl: string, maxChars = FETCH_DEFAULT_CHARS): Promise<{
  url: string; contentType: string; text: string; truncated: boolean; omittedChars: number;
}> => {
  const parsed = new URL(targetUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only http(s) URLs can be fetched');
  const cap = Math.min(Math.max(maxChars, 500), FETCH_MAX_CHARS);
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), 20_000);
  let response: Response;
  try {
    response = await fetch(parsed, { headers: FETCH_HEADERS, redirect: 'follow', signal: ac.signal });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const raw = await response.text();
  let text: string;
  if (contentType.includes('application/json')) {
    try { text = JSON.stringify(JSON.parse(raw), null, 2); } catch { text = raw; }
  } else if (contentType.startsWith('text/') && !contentType.includes('html')) {
    text = raw;
  } else {
    text = stripTags(raw);
  }

  const omittedChars = Math.max(0, text.length - cap);
  if (omittedChars > 0) text = `${text.slice(0, cap)}\n\n[truncated - ${omittedChars} chars omitted]`;
  return { url: response.url || parsed.toString(), contentType: contentType || 'unknown', text, truncated: omittedChars > 0, omittedChars };
};
