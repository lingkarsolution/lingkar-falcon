import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { store } from '../../db/store.js';
import { requireAuth } from '../../middleware/auth.js';
import { errorResponse, ok } from '../../lib/api.js';
import { generateTopicReport } from '../../services/reports.js';
import type { Report } from '../../types.js';

const genSchema = z.object({
  topicId: z.string(),
  title: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export const registerReportRoutes = (app: FastifyInstance) => {
  app.get('/', { preHandler: requireAuth() }, async (req, reply) => {
    const list = (store.list('reports') as Report[])
      .filter((r) => r.tenantId === req.tenant!.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return ok(reply, list);
  });

  app.post('/', { preHandler: requireAuth(['admin', 'analyst']) }, async (req, reply) => {
    const parsed = genSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(reply, 400, 'INVALID_INPUT', 'Invalid report request', { issues: parsed.error.issues });
    const r = await generateTopicReport({
      tenantId: req.tenant!.id, topicId: parsed.data.topicId, title: parsed.data.title,
      dateFrom: parsed.data.dateFrom, dateTo: parsed.data.dateTo, requestedBy: req.user!.id,
    });
    return ok(reply, r);
  });

  app.get('/:id/download', { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = store.get('reports', id) as Report | undefined;
    if (!r || r.tenantId !== req.tenant!.id) return errorResponse(reply, 404, 'NOT_FOUND', 'Report not found');
    if (!r.htmlContent) return errorResponse(reply, 404, 'NO_CONTENT', 'Report content unavailable');
    reply.header('content-type', 'text/html; charset=utf-8');
    return reply.send(r.htmlContent);
  });
};
