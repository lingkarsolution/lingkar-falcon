// In-memory store with periodic JSON persistence.
// Architected to be swapped for Drizzle/Postgres in v1.0 without touching services.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { pgEnabled, pgLoad, pgSave } from './pg.js';
import type {
  Tenant, User, Topic, Connector, ConnectorCredential, ConnectorUsageEvent,
  IngestionJob, IngestionJobError, Mention, Insight, IssueCluster, RiskEvent,
  Actor, AlertRule, AlertEvent, Report, AuditLog, Session,
  Conversation, ConversationTurn, ToolInvocation,
  Location, MentionGeoEnrichment, TopicCityBaseline, TopicCityTrend, SchemaMigration,
  TrendSnapshot,
} from '../types.js';

type Tables = {
  tenants: Record<string, Tenant>;
  users: Record<string, User>;
  topics: Record<string, Topic>;
  connectors: Record<string, Connector>;
  credentials: Record<string, ConnectorCredential>;
  connectorUsageEvents: Record<string, ConnectorUsageEvent>;
  locations: Record<string, Location>;
  mentionGeoEnrichments: Record<string, MentionGeoEnrichment>;
  topicCityBaselines: Record<string, TopicCityBaseline>;
  topicCityTrends: Record<string, TopicCityTrend>;
  trendSnapshots: Record<string, TrendSnapshot>;
  ingestionJobs: Record<string, IngestionJob>;
  ingestionJobErrors: Record<string, IngestionJobError>;
  mentions: Record<string, Mention>;
  insights: Record<string, Insight>;
  issueClusters: Record<string, IssueCluster>;
  riskEvents: Record<string, RiskEvent>;
  actors: Record<string, Actor>;
  alertRules: Record<string, AlertRule>;
  alertEvents: Record<string, AlertEvent>;
  reports: Record<string, Report>;
  auditLogs: Record<string, AuditLog>;
  sessions: Record<string, Session>;
  conversations: Record<string, Conversation>;
  conversationTurns: Record<string, ConversationTurn>;
  toolInvocations: Record<string, ToolInvocation>;
  schemaMigrations: Record<string, SchemaMigration>;
};

const empty = (): Tables => ({
  tenants: {}, users: {}, topics: {}, connectors: {}, credentials: {},
  connectorUsageEvents: {}, locations: {}, mentionGeoEnrichments: {},
  topicCityBaselines: {}, topicCityTrends: {}, trendSnapshots: {}, ingestionJobs: {}, ingestionJobErrors: {},
  mentions: {}, insights: {}, issueClusters: {}, riskEvents: {},
  actors: {}, alertRules: {}, alertEvents: {}, reports: {}, auditLogs: {},
  sessions: {}, conversations: {}, conversationTurns: {}, toolInvocations: {},
  schemaMigrations: {},
});

const dateFields = ['updatedAt', 'finishedAt', 'createdAt', 'collectedAt', 'generatedAt', 'detectedAt', 'startedAt', 'appliedAt'] as const;

const snapshotFreshness = (data: Tables) => {
  let latestTime = 0;
  for (const table of Object.values(data)) {
    for (const record of Object.values(table) as Array<Record<string, unknown>>) {
      for (const field of dateFields) {
        const value = record[field];
        if (typeof value !== 'string') continue;
        const time = Date.parse(value);
        if (Number.isFinite(time) && time > latestTime) latestTime = time;
      }
    }
  }
  return {
    latestTime,
    mentions: Object.keys(data.mentions).length,
    ingestionJobs: Object.keys(data.ingestionJobs).length,
    completedIngestionJobs: Object.values(data.ingestionJobs).filter((job) => job.status === 'completed').length,
  };
};

const shouldPreferFileSnapshot = (databaseData: Tables, fileData: Tables): boolean => {
  const databaseFreshness = snapshotFreshness(databaseData);
  const fileFreshness = snapshotFreshness(fileData);
  if (fileFreshness.mentions > databaseFreshness.mentions && fileFreshness.ingestionJobs >= databaseFreshness.ingestionJobs) return true;
  if (fileFreshness.completedIngestionJobs > databaseFreshness.completedIngestionJobs && fileFreshness.mentions >= databaseFreshness.mentions) return true;
  if (fileFreshness.latestTime > databaseFreshness.latestTime + 1000) return true;
  if (fileFreshness.latestTime < databaseFreshness.latestTime - 1000) return false;
  return false;
};

class Store {
  data: Tables = empty();
  private dirty = false;
  private version = 0;
  private flushInFlight: Promise<void> | null = null;
  private dataFile = path.join(config.dataDir, 'omnisense.json');
  private legacyDataFiles = [...new Set([
    path.join(config.dataDir, 'civicfalcon.json'),
    ...config.legacyDataDirs.map((dir) => path.join(dir, 'civicfalcon.json')),
  ])];

  private async readDataFile(): Promise<string | null> {
    for (const candidate of [this.dataFile, ...this.legacyDataFiles]) {
      try { return await fs.readFile(candidate, 'utf8'); } catch {}
    }
    return null;
  }

  private async readFileSnapshot(): Promise<Tables | null> {
    const raw = await this.readDataFile();
    if (!raw) return null;
    try {
      return { ...empty(), ...JSON.parse(raw) as Partial<Tables> };
    } catch {
      return null;
    }
  }

  async load(): Promise<void> {
    if (pgEnabled()) {
      try {
        const parsed = (await pgLoad()) as Tables | null;
        const databaseData = parsed ? { ...empty(), ...parsed } : empty();
        const fileData = await this.readFileSnapshot();
        if (fileData && shouldPreferFileSnapshot(databaseData, fileData)) {
          console.warn('[store] Local snapshot is newer than PostgreSQL snapshot; loading local data and resyncing PostgreSQL.');
          this.data = fileData;
          this.markDirty();
          await this.flush();
          return;
        }
        this.data = databaseData;
        return;
      } catch (e) {
        console.error('[store] Postgres load failed, falling back to file:', (e as Error).message);
      }
    }
    try {
      await fs.mkdir(config.dataDir, { recursive: true });
      const fileData = await this.readFileSnapshot();
      if (!fileData) {
        this.data = empty();
        return;
      }
      this.data = fileData;
    } catch {
      this.data = empty();
    }
  }

  async flush(): Promise<void> {
    if (this.flushInFlight) return this.flushInFlight;
    this.flushInFlight = this.flushUntilClean().finally(() => { this.flushInFlight = null; });
    return this.flushInFlight;
  }

  private async flushUntilClean(): Promise<void> {
    while (this.dirty) await this.flushOnce();
  }

  private async flushOnce(): Promise<void> {
    const flushedVersion = this.version;
    if (pgEnabled()) {
      try {
        await pgSave(this.data);
        if (this.version === flushedVersion) this.dirty = false;
        return;
      } catch (e) {
        console.error('[store] Postgres save failed, falling back to file:', (e as Error).message);
      }
    }
    await fs.mkdir(config.dataDir, { recursive: true });
    await fs.writeFile(this.dataFile, JSON.stringify(this.data), 'utf8');
    if (this.version === flushedVersion) this.dirty = false;
  }

  markDirty(): void { this.dirty = true; this.version++; }

  list<K extends keyof Tables>(table: K): Tables[K][keyof Tables[K]][] {
    return Object.values(this.data[table]) as Tables[K][keyof Tables[K]][];
  }

  get<K extends keyof Tables>(table: K, id: string): Tables[K][keyof Tables[K]] | undefined {
    return (this.data[table] as Record<string, unknown>)[id] as Tables[K][keyof Tables[K]] | undefined;
  }

  put<K extends keyof Tables>(table: K, id: string, value: Tables[K][keyof Tables[K]]): void {
    (this.data[table] as Record<string, unknown>)[id] = value;
    this.markDirty();
  }

  delete<K extends keyof Tables>(table: K, id: string): void {
    delete (this.data[table] as Record<string, unknown>)[id];
    this.markDirty();
  }
}

export const store = new Store();

// Periodic flush
setInterval(() => { store.flush().catch(() => {}); }, 5000).unref();

process.on('beforeExit', () => { store.flush().catch(() => {}); });
