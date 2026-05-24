import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { store } from '../../db/store.js';
import { requireAuth } from '../../middleware/auth.js';
import { errorResponse, ok } from '../../lib/api.js';
import { enqueueIngestion } from '../../services/ingestion.js';
import type { IngestionJob, IngestionJobItemOutcome } from '../../types.js';

const triggerSchema = z.object({
  topicId: z.string(),
  connectorId: z.string(),
  maxItems: z.number().int().min(1).max(250).default(50),
  days: z.number().int().min(1).max(90).default(30),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

const jobWithoutItemOutcomes = (job: IngestionJob): IngestionJob => {
  const { itemOutcomes, ...metadata } = job.metadata ?? {};
  void itemOutcomes;
  return { ...job, metadata };
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
    const errors = store.list('ingestionJobErrors').filter((e: any) => e.ingestionJobId === id);
    return ok(reply, { job: jobWithoutItemOutcomes(j), errors, items: itemOutcomesFor(j) });
  });
};
