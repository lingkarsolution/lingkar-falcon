# OmniSense — API & Service Registration Checklist

OSINT-first ordering. Start with the FREE row, only add paid ones when you need that platform's data.

## Tier 0 — Required (you must have these)

| Service | Why | Cost | Where |
|---|---|---|---|
| **LLM provider** (OpenRouter recommended) | Commander AI, NLP enrichment, daily briefs, reports | Pay-per-token (~$0.50/M for Qwen) | https://openrouter.ai/keys |

Set: `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`.

## Tier 1 — Free, no key needed (enabled automatically)

| Connector | Notes |
|---|---|
| **GDELT 2.0 DOC API** | Global news + sentiment, 15-min refresh. |
| **RSS / Atom feeds** | Add any feed URL per topic. |
| **Reddit `/r/*.json`** | Public, rate-limited. |
| **DuckDuckGo HTML** | Web-search fallback. |

No registration. Always on.

## Tier 2 — Free with self-hosting (recommended power-ups)

| Service | Why register | Sign-up |
|---|---|---|
| **SearXNG** | Unlimited free web search, full privacy | Self-host: https://docs.searxng.org/admin/installation.html → set `SEARXNG_BASE_URL` |

## Tier 3 — Free tier with API key

| Service | Free quota | Sign-up | Env var |
|---|---|---|---|
| **Brave Search API** | 2,000 queries/month | https://api.search.brave.com/app/keys | `BRAVE_API_KEY` |
| **Tavily** | 1,000 queries/month | https://app.tavily.com | `TAVILY_API_KEY` |
| **NewsAPI.org** | 100 requests/day (dev tier) | https://newsapi.org/register | `NEWSAPI_KEY` |
| **YouTube Data API v3** | 10,000 quota units/day | https://console.cloud.google.com → enable "YouTube Data API v3" → credentials → API key | `YOUTUBE_API_KEY` |

## Tier 4 — Paid (only if you need the platform)

| Service | Tier | Sign-up | Env var |
|---|---|---|---|
| **EnsembleData Social Media Scraping APIs** | Free trial + paid units | https://dashboard.ensembledata.com/register | `ENSEMBLEDATA_TOKEN` |
| **X (Twitter) API v2** | Basic $200/mo or Pro $5,000/mo | https://developer.twitter.com/en/portal/dashboard | `X_BEARER_TOKEN` |
| **Facebook Graph API** | App review required; Public Posts only | https://developers.facebook.com/apps | `FACEBOOK_ACCESS_TOKEN` |
| **Instagram Graph API** | Business account + FB app + review | https://developers.facebook.com/docs/instagram-api | `INSTAGRAM_ACCESS_TOKEN` |

## EnsembleData coverage notes

- **TikTok** — supported through EnsembleData (`/tt/keyword/search`, `/tt/hashtag/posts`, user posts, comments, etc.). Official TikTok Research API remains a separate approval path and is not enabled by default.
- **YouTube** — supported through EnsembleData (`/youtube/search`, hashtag search, channel videos/shorts/streams, comments). Falls back to official YouTube Data API v3 when `YOUTUBE_API_KEY` is set.
- **Instagram** — supported through EnsembleData for public user/media/reel/post data. Falls back to Instagram Graph API for owned business/creator media when `INSTAGRAM_ACCESS_TOKEN` is set.
- **Facebook** — not present as a tag/path in the current EnsembleData OpenAPI spec, so OmniSense keeps Facebook on the official Graph API.

## Recommended on-prem / cloud infra

| Service | Why | Env var |
|---|---|---|
| **Azure Database for PostgreSQL Flex** (or any Postgres) | Durable multi-instance state. Falls back to local JSON file if unset. | `DATABASE_URL` |
| **Azure Blob Storage container SAS** | Persist generated HTML reports off-server. Falls back to in-DB blob. | `DATA_STORAGE_SAS_URL` |

## Onboarding flow

1. Generate a random 32-byte `SESSION_SECRET` (`openssl rand -hex 32`).
2. Set `ADMIN_EMAIL` + `ADMIN_PASSWORD` (used once to seed the admin user).
3. Set `LLM_API_KEY` from OpenRouter (cheapest practical option).
4. Optional but recommended: set `DATABASE_URL` and `DATA_STORAGE_SAS_URL`.
5. Optional power-ups: register Brave + Tavily + NewsAPI + YouTube keys.
6. Boot the server. Visit **Settings → Connectors** to inspect tier/status.
7. Visit **/connectors** to set per-platform credentials via the UI (admin-only). Paid keys can be set in `.env` or via the encrypted credentials API.
