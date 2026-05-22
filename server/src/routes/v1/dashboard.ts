import type { FastifyInstance } from 'fastify';
import { store } from '../../db/store.js';
import { requireAuth } from '../../middleware/auth.js';
import { ok } from '../../lib/api.js';
import { dashboardSummary } from '../../services/analytics.js';
import type { Topic, Connector, RiskEvent, AlertEvent } from '../../types.js';

export const registerDashboardRoutes = (app: FastifyInstance) => {
  app.get('/summary', { preHandler: requireAuth() }, async (req, reply) => {
    const tenantId = req.tenant!.id;
    const topics = (store.list('topics') as Topic[]).filter((t) => t.tenantId === tenantId);
    const connectors = (store.list('connectors') as Connector[]).filter((c) => c.tenantId === tenantId);
    const risks = (store.list('riskEvents') as RiskEvent[]).filter((r) => r.tenantId === tenantId);
    const alerts = (store.list('alertEvents') as AlertEvent[]).filter((a) => a.tenantId === tenantId);
    return ok(reply, {
      ...dashboardSummary(tenantId),
      activeTopics: topics.filter((t) => t.status === 'active').length,
      totalTopics: topics.length,
      connectorsActive: connectors.filter((c) => c.status === 'active').length,
      connectorsTotal: connectors.length,
      activeRisks: risks.filter((r) => r.status === 'new' || r.status === 'reviewing').length,
      openAlerts: alerts.filter((a) => a.status === 'new').length,
      recentRisks: risks.sort((a, b) => b.score - a.score).slice(0, 5),
      recentAlerts: alerts.sort((a, b) => new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime()).slice(0, 10),
    });
  });
};
