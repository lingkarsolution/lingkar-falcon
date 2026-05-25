import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { store } from '../../db/store.js';
import { requireAuth } from '../../middleware/auth.js';
import { errorResponse, ok } from '../../lib/api.js';
import { redactInfrastructureText } from '../../lib/publicSources.js';
import { enqueueIngestion } from '../../services/ingestion.js';
import type { IngestionJob, IngestionJobItemOutcome } from '../../types.js';

const triggerSchema = z.object({
  topicId: z.string(),
  connectorId: z.string(),
  maxItems: z.number().int().min(1).max(250).default(50),
  days: z.number().int().min(1).max(90).default(30),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const sanitizeMetadata = (source: Record<string, unknown>): Record<string, unknown> => {
  const metadata = { ...source };
  if (typeof metadata.errorMessage === 'string') {
    metadata.errorMessage = redactInfrastructureText(metadata.errorMessage) ?? 'Source request failed.';
  }
  const progress = metadata.ingestionProgress;
  if (progress && typeof progress === 'object' && !Array.isArray(progress)) {
    const progressRecord = progress as Record<string, unknown>;
    const stream = progressRecord.llmStream;
    metadata.ingestionProgress = {
      ...progressRecord,
      ...(stream && typeof stream === 'object' && !Array.isArray(stream)
        ? {
            llmStream: {
              ...(stream as Record<string, unknown>),
              error: typeof (stream as Record<string, unknown>).error === 'string'
                ? redactInfrastructureText((stream as Record<string, unknown>).error as string) ?? 'Source request failed.'
                : (stream as Record<string, unknown>).error,
            },
          }
        : {}),
    };
  }
  return metadata;
};

const jobWithoutItemOutcomes = (job: IngestionJob): IngestionJob => {
  const { itemOutcomes, ...metadata } = job.metadata ?? {};
  void itemOutcomes;
  return {
    ...job,
    metadata: sanitizeMetadata(metadata),
  };
};

const itemOutcomesFor = (job: IngestionJob): IngestionJobItemOutcome[] =>
  Array.isArray(job.metadata?.itemOutcomes) ? job.metadata.itemOutcomes as IngestionJobItemOutcome[] : [];

export const registerIngestionRoutes = (app: FastifyInstance) => {
  app.post('/trigger', { preHandler: requireAuth(['admin', 'analyst']) }, async (req, reply) => {
    const parsed = triggerSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(reply, 400, 'INVALID_INPUT', 'Invalid trigger', { issues: parsed.error.issues });
    const job = await enqueueIngestion({
      tenantId: req.tenant!.id, topicId: parsed.data.topicId, connectorId: parsed.data.connectorId,
      jobType: 'manual', requestedBy: req.user!.id, maxItems: parsed.data.maxItems,
      days: parsed.data.days, dateFrom: parsed.data.dateFrom, dateTo: parsed.data.dateTo,
      metadata: parsed.data.metadata,
    });
    return ok(reply, job);
  });

  app.get('/jobs', { preHandler: requireAuth() }, async (req, reply) => {
    const list = (store.list('ingestionJobs') as IngestionJob[])
      .filter((j) => j.tenantId === req.tenant!.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 100)
      .map(jobWithoutItemOutcomes);
    return ok(reply, list);
  });

  app.get('/jobs/:id', { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const j = store.get('ingestionJobs', id) as IngestionJob | undefined;
    if (!j || j.tenantId !== req.tenant!.id) return errorResponse(reply, 404, 'NOT_FOUND', 'Job not found');
    const errors = store.list('ingestionJobErrors')
      .filter((e: any) => e.ingestionJobId === id)
      .map((e: any) => ({ ...e, message: redactInfrastructureText(e.message) ?? 'Source request failed.' }));
    return ok(reply, { job: jobWithoutItemOutcomes(j), errors, items: itemOutcomesFor(j) });
  });

  app.post('/jobs/:id/cancel', { preHandler: requireAuth(['admin', 'analyst']) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const j = store.get('ingestionJobs', id) as IngestionJob | undefined;
    if (!j || j.tenantId !== req.tenant!.id) return errorResponse(reply, 404, 'NOT_FOUND', 'Job not found');
    if (j.status !== 'queued') {
      return errorResponse(reply, 409, 'NOT_CANCELLABLE', `Only queued jobs can be cancelled. Current status: ${j.status}`);
    }
    const updated: IngestionJob = { ...j, status: 'cancelled', finishedAt: new Date().toISOString(), metadata: { ...(j.metadata ?? {}), cancelledBy: req.user!.id, cancelledAt: new Date().toISOString() } };
    store.put('ingestionJobs', id, updated);
    await store.flush();
    return ok(reply, jobWithoutItemOutcomes(updated));
  });

  app.post('/jobs/cancel-queued', { preHandler: requireAuth(['admin', 'analyst']) }, async (req, reply) => {
    const cancelled: string[] = [];
    const cancelledAt = new Date().toISOString();
    for (const j of store.list('ingestionJobs') as IngestionJob[]) {
      if (j.tenantId !== req.tenant!.id) continue;
      if (j.status !== 'queued') continue;
      store.put('ingestionJobs', j.id, { ...j, status: 'cancelled', finishedAt: cancelledAt, metadata: { ...(j.metadata ?? {}), cancelledBy: req.user!.id, cancelledAt } });
      cancelled.push(j.id);
    }
    if (cancelled.length > 0) await store.flush();
    return ok(reply, { cancelled, count: cancelled.length });
  });
};
