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

class Store {
  data: Tables = empty();
  private dirty = false;
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

  async load(): Promise<void> {
    if (pgEnabled()) {
      try {
        const parsed = (await pgLoad()) as Tables | null;
        this.data = parsed ? { ...empty(), ...parsed } : empty();
        return;
      } catch (e) {
        console.error('[store] Postgres load failed, falling back to file:', (e as Error).message);
      }
    }
    try {
      await fs.mkdir(config.dataDir, { recursive: true });
      const raw = await this.readDataFile();
      if (!raw) {
        this.data = empty();
        return;
      }
      const parsed = JSON.parse(raw) as Tables;
      this.data = { ...empty(), ...parsed };
    } catch {
      this.data = empty();
    }
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    if (pgEnabled()) {
      try {
        await pgSave(this.data);
        this.dirty = false;
        return;
      } catch (e) {
        console.error('[store] Postgres save failed, falling back to file:', (e as Error).message);
      }
    }
    await fs.mkdir(config.dataDir, { recursive: true });
    await fs.writeFile(this.dataFile, JSON.stringify(this.data), 'utf8');
    this.dirty = false;
  }

  markDirty(): void { this.dirty = true; }

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
