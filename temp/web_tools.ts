
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Browser-shaped headers — DuckDuckGo's html endpoint serves anomaly /
// captcha pages to obvious bot traffic (notably POST requests and
// missing Sec-Fetch-* headers from cloud egress IPs). Mimicking a real
// Chrome navigation works.
const DDG_HEADERS: Record<string, string> = {
  "User-Agent": DEFAULT_UA,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "Referer": "https://duckduckgo.com/",
  "Cookie": "ah=us-en; l=us-en; ax=v442-1",
};

// ─── helpers ────────────────────────────────────────────────────────────

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function stripTags(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/**
 * DuckDuckGo wraps every result link in
 *   /l/?uddg=<url-encoded-real-url>&rut=...
 * so the visible href in the HTML page is a redirector. Unwrap it.
 */
function unwrapDdgUrl(href: string): string {
  try {
    if (href.startsWith("//")) href = "https:" + href;
    const u = new URL(href, "https://duckduckgo.com");
    if (u.pathname === "/l/" || u.pathname.endsWith("/l/")) {
      const real = u.searchParams.get("uddg");
      if (real) return decodeURIComponent(real);
    }
    return href;
  } catch {
    return href;
  }
}

// ─── web_search ─────────────────────────────────────────────────────────

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function duckDuckGoSearch(query: string, maxResults: number): Promise<SearchResult[]> {
  const endpoint = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  // GET with browser-shaped headers — POST gets blocked with HTTP 202 +
  // anomaly page from cloud / datacenter IPs.
  const resp = await fetch(endpoint, {
    method: "GET",
    headers: DDG_HEADERS,
    redirect: "follow",
  });
  if (!resp.ok) {
    throw new Error(`DuckDuckGo returned HTTP ${resp.status}`);
  }
  const html = await resp.text();
  if (/anomaly|unusual traffic|captcha/i.test(html) && !/result__a/.test(html)) {
    throw new Error("DuckDuckGo blocked the request (anomaly page returned)");
  }

  const results: SearchResult[] = [];
  // Each result looks like:
  //   <a class="result__a" href="...">TITLE</a>
  //   <a class="result__snippet" ...>SNIPPET</a>   (sometimes)
  //   <div class="result__snippet">SNIPPET</div>   (sometimes)
  const blockRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]*class="[^"]*result__a|<\/div>\s*<\/div>\s*<\/div>)/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) !== null) {
    const rawHref = m[1];
    const title = stripTags(m[2]);
    const tail = m[3] || "";
    const snipMatch = tail.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/i);
    const snippet = snipMatch ? stripTags(snipMatch[1]) : "";
    const url = unwrapDdgUrl(decodeHtmlEntities(rawHref));
    if (!url || !/^https?:/i.test(url)) continue;
    if (results.some((r) => r.url === url)) continue;
    results.push({ title, url, snippet });
    if (results.length >= maxResults) break;
  }
  return results;
}

export function webSearchTool() {
  return tool({
    description:
      "Search the public web via DuckDuckGo and return a ranked list of " +
      "{title, url, snippet} results. Use this when you need up-to-date " +
      "information that is not in the codebase (library docs, error " +
      "messages, API references). Follow up with `web_fetch` to read a " +
      "specific result page.",
    inputSchema: z.object({
      query: z.string().min(1).describe("Search query (natural language)."),
      max_results: z
        .number()
        .int()
        .min(1)
        .max(15)
        .optional()
        .describe("Max results to return (default 5)."),
    }),
    execute: async ({ query, max_results }) => {
      const max = max_results ?? 5;
      try {
        const results = await duckDuckGoSearch(query, max);
        if (results.length === 0) {
          return `No results for: ${query}`;
        }
        return results
          .map(
            (r, i) =>
              `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`,
          )
          .join("\n\n");
      } catch (ex: any) {
        return `web_search error: ${ex?.message || ex}`;
      }
    },
  });
}

// ─── web_fetch ──────────────────────────────────────────────────────────

const FETCH_DEFAULT_CHARS = 8000;
const FETCH_MAX_CHARS = 40000;

export function webFetchTool() {
  return tool({
    description:
      "Fetch a URL and return the page text (HTML stripped, scripts/styles " +
      "removed). Use this after `web_search` to read a specific result. " +
      "Returns at most ~8 KB of text by default; pass max_chars to raise " +
      "(hard cap 40 KB).",
    inputSchema: z.object({
      url: z.string().url().describe("Absolute http(s) URL to fetch."),
      max_chars: z
        .number()
        .int()
        .min(500)
        .max(FETCH_MAX_CHARS)
        .optional()
        .describe(`Max characters of text to return (default ${FETCH_DEFAULT_CHARS}).`),
    }),
    execute: async ({ url, max_chars }) => {
      const cap = max_chars ?? FETCH_DEFAULT_CHARS;
      try {
        const ac = new AbortController();
        const timeout = setTimeout(() => ac.abort(), 20_000);
        let resp: Response;
        try {
          resp = await fetch(url, {
            headers: {
              "User-Agent": DEFAULT_UA,
              "Accept": "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.5",
              "Accept-Language": "en-US,en;q=0.9",
            },
            redirect: "follow",
            signal: ac.signal,
          });
        } finally {
          clearTimeout(timeout);
        }
        if (!resp.ok) {
          return `web_fetch error: HTTP ${resp.status} ${resp.statusText} for ${url}`;
        }
        const ct = (resp.headers.get("content-type") || "").toLowerCase();
        const raw = await resp.text();
        let body: string;
        if (ct.includes("application/json")) {
          // Pretty-print JSON when possible.
          try {
            body = JSON.stringify(JSON.parse(raw), null, 2);
          } catch {
            body = raw;
          }
        } else if (ct.startsWith("text/") && !ct.includes("html")) {
          body = raw;
        } else {
          body = stripTags(raw);
        }
        if (body.length > cap) {
          body = body.slice(0, cap) + `\n\n[truncated — ${body.length - cap} chars omitted]`;
        }
        return `URL: ${url}\nContent-Type: ${ct || "unknown"}\n\n${body}`;
      } catch (ex: any) {
        if (ex?.name === "AbortError") return `web_fetch error: timeout fetching ${url}`;
        return `web_fetch error: ${ex?.message || ex}`;
      }
    },
  });
}

// ─── bundle ─────────────────────────────────────────────────────────────

export function buildWebTools(): ToolSet {
  return {
    web_search: webSearchTool(),
    web_fetch: webFetchTool(),
  };
}
