import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { store } from '../../db/store.js';
import { requireAuth } from '../../middleware/auth.js';
import { errorResponse, ok } from '../../lib/api.js';
import { audit } from '../../services/audit.js';
import { getConnector } from '../../connectors/registry.js';
import { encrypt } from '../../lib/crypto.js';
import { searchProvidersStatus } from '../../connectors/search/router.js';
import type { Connector, ConnectorCredential } from '../../types.js';
import { publicConnector, redactInfrastructureText } from '../../lib/publicSources.js';

export const registerConnectorRoutes = (app: FastifyInstance) => {
  app.get('/', { preHandler: requireAuth() }, async (req, reply) => {
    const list = (store.list('connectors') as Connector[]).filter((c) => c.tenantId === req.tenant!.id);
    return ok(reply, list.map(publicConnector));
  });

  app.get('/web-search-status', { preHandler: requireAuth() }, async (_req, reply) =>
    ok(reply, {
      sources: searchProvidersStatus().map((provider, index) => ({
        name: `Search source ${index + 1}`,
        ready: provider.available,
        mode: provider.available ? 'available' : 'unavailable',
      })),
    }));

  app.post('/:id/test', { preHandler: requireAuth(['admin', 'analyst']) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = store.get('connectors', id) as Connector | undefined;
    if (!c || c.tenantId !== req.tenant!.id) return errorResponse(reply, 404, 'NOT_FOUND', 'Connector not found');
    const impl = getConnector(c.platform);
    if (!impl) return errorResponse(reply, 400, 'NOT_IMPLEMENTED', 'Source is not available');
    const health = await impl.testConnection();
    const updated: Connector = { ...c, status: health.status, lastHealthCheckAt: new Date().toISOString(), lastHealthMessage: health.message, updatedAt: new Date().toISOString() };
    store.put('connectors', id, updated);
    return ok(reply, { health: { ok: health.ok, status: health.status, message: redactInfrastructureText(health.message) }, connector: publicConnector(updated) });
  });

  const patchSchema = z.object({
    enabled: z.boolean().optional(),
    monthlyBudgetUsd: z.number().nullable().optional(),
    rateLimitPerMinute: z.number().nullable().optional(),
    config: z.record(z.unknown()).optional(),
  });

  app.patch('/:id', { preHandler: requireAuth(['admin', 'analyst']) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = store.get('connectors', id) as Connector | undefined;
    if (!c || c.tenantId !== req.tenant!.id) return errorResponse(reply, 404, 'NOT_FOUND', 'Connector not found');
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(reply, 400, 'INVALID_INPUT', 'Invalid patch', { issues: parsed.error.issues });
    const updated: Connector = { ...c, ...parsed.data, updatedAt: new Date().toISOString() };
    store.put('connectors', id, updated);
    audit({ tenantId: req.tenant!.id, actorUserId: req.user!.id, action: 'connector.update', entityType: 'connector', entityId: id, before: c, after: updated });
    return ok(reply, publicConnector(updated));
  });

  const credSchema = z.object({ payload: z.record(z.unknown()) });

  app.post('/:id/credentials', { preHandler: requireAuth(['admin']) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = store.get('connectors', id) as Connector | undefined;
    if (!c || c.tenantId !== req.tenant!.id) return errorResponse(reply, 404, 'NOT_FOUND', 'Connector not found');
    const parsed = credSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(reply, 400, 'INVALID_INPUT', 'Invalid credential payload', { issues: parsed.error.issues });
    const credId = `cred_${id}`;
    const cred: ConnectorCredential = {
      id: credId, tenantId: req.tenant!.id, connectorId: id,
      encryptedPayload: encrypt(JSON.stringify(parsed.data.payload)),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    store.put('credentials', credId, cred);
    const updated: Connector = { ...c, credentialConfigured: true, status: 'active', enabled: true, updatedAt: new Date().toISOString() };
    store.put('connectors', id, updated);
    audit({ tenantId: req.tenant!.id, actorUserId: req.user!.id, action: 'connector.credentials.set', entityType: 'connector', entityId: id });
    return ok(reply, { ok: true });
  });
};
