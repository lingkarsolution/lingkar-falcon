import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { errorResponse, ok } from '../../lib/api.js';
import { requireAuth } from '../../middleware/auth.js';
import { latestTrendSnapshot, monitorTrend, refreshTrendSnapshot } from '../../services/trends.js';
import type { Platform } from '../../types.js';

const refreshSchema = z.object({
  platforms: z.array(z.enum(['x', 'tiktok', 'instagram', 'youtube', 'facebook', 'reddit', 'news'])).optional(),
  limitPerPlatform: z.number().int().min(1).max(20).default(10),
});

export const registerTrendRoutes = (app: FastifyInstance) => {
  app.get('/', { preHandler: requireAuth() }, async (req, reply) => {
    return ok(reply, latestTrendSnapshot(req.tenant!.id));
  });

  app.post('/refresh', { preHandler: requireAuth(['admin', 'analyst']) }, async (req, reply) => {
    const parsed = refreshSchema.safeParse(req.body ?? {});
    if (!parsed.success) return errorResponse(reply, 400, 'INVALID_INPUT', 'Invalid refresh request', { issues: parsed.error.issues });
    const snapshot = await refreshTrendSnapshot(req.tenant!.id, {
      platforms: parsed.data.platforms as Platform[] | undefined,
      limitPerPlatform: parsed.data.limitPerPlatform,
    });
    return ok(reply, snapshot);
  });

  app.post('/:id/monitor', { preHandler: requireAuth(['admin', 'analyst']) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const topic = await monitorTrend(req.tenant!.id, req.user!.id, id);
    if (!topic) return errorResponse(reply, 404, 'NOT_FOUND', 'Trend not found in latest cached snapshot');
    return ok(reply, topic);
  });
};