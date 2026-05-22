import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { store } from '../../db/store.js';
import { newId } from '../../lib/crypto.js';
import { requireAuth } from '../../middleware/auth.js';
import { errorResponse, ok } from '../../lib/api.js';
import { audit } from '../../services/audit.js';
import { evaluateAlerts } from '../../services/alerts.js';
import type { AlertRule, AlertEvent } from '../../types.js';

const ruleSchema = z.object({
  name: z.string().min(2),
  type: z.enum(['volume_spike', 'negative_sentiment_spike', 'risk_event', 'actor_mention', 'keyword']),
  topicId: z.string().nullable().optional(),
  enabled: z.boolean().default(true),
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  config: z.record(z.unknown()).default({}),
  channels: z.array(z.string()).default(['inapp']),
});

export const registerAlertRoutes = (app: FastifyInstance) => {
  app.get('/rules', { preHandler: requireAuth() }, async (req, reply) => {
    return ok(reply, (store.list('alertRules') as AlertRule[]).filter((r) => r.tenantId === req.tenant!.id));
  });

  app.post('/rules', { preHandler: requireAuth(['admin', 'analyst']) }, async (req, reply) => {
    const parsed = ruleSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(reply, 400, 'INVALID_INPUT', 'Invalid rule', { issues: parsed.error.issues });
    const id = newId('rule');
    const now = new Date().toISOString();
    const rule: AlertRule = {
      id, tenantId: req.tenant!.id, createdBy: req.user!.id,
      topicId: parsed.data.topicId ?? null, name: parsed.data.name,
      type: parsed.data.type, enabled: parsed.data.enabled,
      severity: parsed.data.severity, config: parsed.data.config, channels: parsed.data.channels,
      createdAt: now, updatedAt: now,
    };
    store.put('alertRules', id, rule);
    audit({ tenantId: req.tenant!.id, actorUserId: req.user!.id, action: 'alert_rule.create', entityType: 'alert_rule', entityId: id, after: rule });
    return ok(reply, rule);
  });

  app.delete('/rules/:id', { preHandler: requireAuth(['admin', 'analyst']) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = store.get('alertRules', id) as AlertRule | undefined;
    if (!r || r.tenantId !== req.tenant!.id) return errorResponse(reply, 404, 'NOT_FOUND', 'Rule not found');
    store.delete('alertRules', id);
    return ok(reply, { deleted: id });
  });

  app.post('/evaluate', { preHandler: requireAuth(['admin', 'analyst']) }, async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    return ok(reply, evaluateAlerts(req.tenant!.id, q.topicId));
  });

  app.get('/events', { preHandler: requireAuth() }, async (req, reply) => {
    const list = (store.list('alertEvents') as AlertEvent[])
      .filter((a) => a.tenantId === req.tenant!.id)
      .sort((a, b) => new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime());
    return ok(reply, list);
  });

  app.post('/events/:id/ack', { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const a = store.get('alertEvents', id) as AlertEvent | undefined;
    if (!a || a.tenantId !== req.tenant!.id) return errorResponse(reply, 404, 'NOT_FOUND', 'Alert not found');
    const updated: AlertEvent = { ...a, status: 'acknowledged', acknowledgedAt: new Date().toISOString(), acknowledgedBy: req.user!.id };
    store.put('alertEvents', id, updated);
    return ok(reply, updated);
  });
};
