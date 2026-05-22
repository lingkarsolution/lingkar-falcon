// Audit logging — write-only ledger of mutating actions.
import { store } from '../db/store.js';
import { newId } from '../lib/crypto.js';

export const audit = (params: {
  tenantId: string; actorUserId?: string | null;
  action: string; entityType: string; entityId?: string | null;
  before?: unknown; after?: unknown;
}): void => {
  const id = newId('aud');
  store.put('auditLogs', id, {
    id, tenantId: params.tenantId, actorUserId: params.actorUserId ?? null,
    action: params.action, entityType: params.entityType, entityId: params.entityId ?? null,
    before: params.before, after: params.after,
    createdAt: new Date().toISOString(),
  });
};
