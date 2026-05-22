import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
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
  service: 'civicfalcon',
  storage: pgEnabled() ? 'postgres' : 'file',
  llm: llmAvailable(),
  time: new Date().toISOString(),
}));

await app.register(registerV1Routes, { prefix: '/api/v1' });

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
  app.log.info(`CivicFalcon API running on http://${host}:${port}`);
  app.log.info(`Storage: ${pgEnabled() ? 'PostgreSQL' : 'JSON file'} | LLM: ${llmAvailable() ? 'enabled' : 'fallback'}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
