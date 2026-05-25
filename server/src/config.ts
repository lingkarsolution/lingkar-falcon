// Centralized env config for the OmniSense API.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_BROWSER_USER_AGENT, normalizeBrowserUserAgent } from './lib/browserHeaders.js';

const DEFAULT_ADMIN_EMAIL = 'admin@omnisense.local';
const DEFAULT_DATA_DIR = './.omnisense-data';

const loadEnvFile = (filePath: string): void => {
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const separator = normalized.indexOf('=');
    if (separator === -1) continue;
    const key = normalized.slice(0, separator).trim();
    let value = normalized.slice(separator + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
};

for (const candidate of [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '..', '.env')]) {
  loadEnvFile(candidate);
}

const legacyDataDirs = [process.env.CIVICFALCON_DATA_DIR, './.civicfalcon-data']
  .filter((dir): dir is string => Boolean(dir));
const browserUserAgent = normalizeBrowserUserAgent(process.env.BROWSER_USER_AGENT);

export const config = {
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? '0.0.0.0',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  sessionSecret: process.env.SESSION_SECRET ?? 'omnisense-dev-secret-change-me',
  dataDir: process.env.OMNISENSE_DATA_DIR ?? process.env.CIVICFALCON_DATA_DIR ?? process.env.DATA_DIR ?? DEFAULT_DATA_DIR,
  legacyDataDirs,
  databaseUrl: process.env.DATABASE_URL ?? '',
  blobSasUrl: process.env.DATA_STORAGE_SAS_URL ?? '',
  browserUserAgent,

  // LLM (OpenAI-compatible) — required for AI features
  llm: {
    baseUrl: process.env.LLM_BASE_URL ?? '',
    apiKey: process.env.LLM_API_KEY ?? '',
    model: process.env.LLM_MODEL ?? 'gpt-4o-mini',
    monthlyBudgetUsd: Number(process.env.LLM_MONTHLY_BUDGET_USD ?? 50),
  },

  // Web search providers (optional / fallback waterfall)
  brave: { apiKey: process.env.BRAVE_API_KEY ?? '' },
  searxng: { url: process.env.SEARXNG_BASE_URL ?? process.env.SEARXNG_URL ?? '' },
  tavily: { apiKey: process.env.TAVILY_API_KEY ?? '' },

  // Paid public social scraping provider. Preferred for TikTok, Instagram, Threads, and YouTube when configured.
  ensembleData: {
    baseUrl: process.env.ENSEMBLEDATA_BASE_URL ?? 'https://ensembledata.com/apis',
    token: process.env.ENSEMBLEDATA_TOKEN ?? '',
  },

  // Social platform connectors (all optional)
  youtube: { apiKey: process.env.YOUTUBE_API_KEY ?? '' },
  x: { bearerToken: process.env.X_BEARER_TOKEN ?? '' },
  facebook: { pageAccessToken: process.env.FACEBOOK_PAGE_ACCESS_TOKEN ?? process.env.FACEBOOK_ACCESS_TOKEN ?? '' },
  instagram: { accessToken: process.env.INSTAGRAM_ACCESS_TOKEN ?? '' },
  threads: { accessToken: process.env.THREADS_ACCESS_TOKEN ?? '' },
  reddit: {
    clientId: process.env.REDDIT_CLIENT_ID ?? '',
    clientSecret: process.env.REDDIT_CLIENT_SECRET ?? '',
    userAgent: normalizeBrowserUserAgent(process.env.REDDIT_USER_AGENT ?? browserUserAgent ?? DEFAULT_BROWSER_USER_AGENT),
  },
  newsapi: { apiKey: process.env.NEWSAPI_KEY ?? '' },

  // Demo admin
  adminEmail: process.env.ADMIN_EMAIL ?? DEFAULT_ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD ?? 'demo123',
} as const;

export type AppConfig = typeof config;
