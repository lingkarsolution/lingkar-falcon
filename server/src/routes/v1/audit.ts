import type { FastifyInstance } from 'fastify';
import { store } from '../../db/store.js';
import { requireAuth } from '../../middleware/auth.js';
import { ok } from '../../lib/api.js';
import type { AuditLog } from '../../types.js';

export const registerAuditRoutes = (app: FastifyInstance) => {
  app.get('/', { preHandler: requireAuth() }, async (req, reply) => {
    const list = (store.list('auditLogs') as AuditLog[])
      .filter((a) => a.tenantId === req.tenant!.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 500);
    return ok(reply, list);
  });
};
