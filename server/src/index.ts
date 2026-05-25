import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { store } from './db/store.js';
import { pgClose, pgEnabled } from './db/pg.js';
import { seedIfEmpty } from './db/seed.js';
import { loadSession } from './middleware/auth.js';
import { registerV1Routes } from './routes/v1/index.js';
import { llmAvailable } from './commander/llm.js';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

await app.register(helmet, { contentSecurityPolicy: false });
await app.register(cors, { origin: config.corsOrigin, credentials: true });
await app.register(cookie, { secret: config.sessionSecret });
await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

app.addHook('preHandler', loadSession);

app.get('/api/health', async () => ({
  ok: true,
  service: 'omnisense',
  storage: pgEnabled() ? 'postgres' : 'file',
  llm: llmAvailable(),
  time: new Date().toISOString(),
}));

await app.register(registerV1Routes, { prefix: '/api/v1' });

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const webDistDir = path.resolve(currentDir, '..', '..', 'dist');
const webIndexFile = path.join(webDistDir, 'index.html');

const getStaticFilePath = (requestUrl: string): string | null => {
  try {
    const url = new URL(requestUrl, 'http://omnisense.local');
    const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const candidate = path.resolve(webDistDir, relativePath);
    if (!candidate.startsWith(webDistDir + path.sep) && candidate !== webDistDir) return null;
    if (!existsSync(candidate) || !statSync(candidate).isFile()) return null;
    return relativePath;
  } catch {
    return null;
  }
};

const isApiRequest = (requestUrl: string): boolean => {
  try {
    const url = new URL(requestUrl, 'http://omnisense.local');
    return url.pathname === '/api' || url.pathname.startsWith('/api/');
  } catch {
    return requestUrl === '/api' || requestUrl.startsWith('/api/');
  }
};

if (existsSync(webIndexFile)) {
  await app.register(fastifyStatic, { root: webDistDir, wildcard: false });

  app.get('/*', async (request, reply) => {
    if (isApiRequest(request.url)) {
      return reply.code(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Route not found' } });
    }

    const staticFilePath = getStaticFilePath(request.url);
    return reply.sendFile(staticFilePath ?? 'index.html');
  });

  app.log.info(`Serving OmniSense web app from ${webDistDir}`);
} else {
  app.log.warn(`Web app build not found at ${webDistDir}; API-only mode enabled`);
}

await store.load();
await seedIfEmpty();

const port = config.port;
const host = config.host;

const shutdown = async () => {
  app.log.info('Shutting down…');
  try { await store.flush(); } catch (e) { app.log.error(e); }
  try { await pgClose(); } catch (e) { app.log.error(e); }
  try { await app.close(); } catch (e) { app.log.error(e); }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  await app.listen({ port, host });
  app.log.info(`OmniSense API running on http://${host}:${port}`);
  app.log.info(`Storage: ${pgEnabled() ? 'PostgreSQL' : 'JSON file'} | LLM: ${llmAvailable() ? 'enabled' : 'fallback'}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
