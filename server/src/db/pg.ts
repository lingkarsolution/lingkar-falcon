// Postgres snapshot persistence — single-row JSONB blob.
// Lets us keep the in-memory Store while still persisting durably to Azure Postgres.
import { config } from '../config.js';

let pool: any = null;

const resetPool = async (): Promise<void> => {
  const current = pool;
  pool = null;
  if (!current) return;
  try { await current.end(); } catch {}
};

const getPool = async () => {
  if (pool) return pool;
  if (!config.databaseUrl) return null;
  const { Pool } = await import('pg');
  pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });
  pool.on('error', (error: Error) => {
    console.error('[pg] idle client error:', error.message);
  });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS civicfalcon_state (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  return pool;
};

export const pgEnabled = (): boolean => Boolean(config.databaseUrl);

export const pgLoad = async (): Promise<unknown | null> => {
  try {
    const p = await getPool();
    if (!p) return null;
    const r = await p.query(`SELECT data FROM civicfalcon_state WHERE id = 'singleton' LIMIT 1`);
    return r.rows[0]?.data ?? null;
  } catch (error) {
    await resetPool();
    throw error;
  }
};

export const pgSave = async (data: unknown): Promise<void> => {
  try {
    const p = await getPool();
    if (!p) return;
    await p.query(
      `INSERT INTO civicfalcon_state (id, data, updated_at) VALUES ('singleton', $1::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [JSON.stringify(data)],
    );
  } catch (error) {
    await resetPool();
    throw error;
  }
};

export const pgClose = async (): Promise<void> => {
  if (pool) { await pool.end(); pool = null; }
};
