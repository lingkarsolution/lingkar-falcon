import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { store } from '../../db/store.js';
import { newId, newSessionToken, verifyPassword } from '../../lib/crypto.js';
import { setSessionCookie, clearSessionCookie, requireAuth } from '../../middleware/auth.js';
import { errorResponse, ok } from '../../lib/api.js';
import { audit } from '../../services/audit.js';

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export const registerAuthRoutes = (app: FastifyInstance) => {
  app.post('/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(reply, 400, 'INVALID_INPUT', 'Bad email or password format');
    const { email, password } = parsed.data;
    const user = (store.list('users') as any[]).find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return errorResponse(reply, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }
    const token = newSessionToken();
    const now = new Date();
    store.put('sessions', token, {
      token, userId: user.id, tenantId: user.tenantId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 7 * 24 * 3600_000).toISOString(),
    });
    setSessionCookie(reply, token);
    audit({ tenantId: user.tenantId, actorUserId: user.id, action: 'auth.login', entityType: 'session', entityId: token });
    return ok(reply, { user: { id: user.id, email: user.email, name: user.name, role: user.role }, tenantId: user.tenantId });
  });

  app.post('/logout', async (req, reply) => {
    if (req.session) {
      store.delete('sessions', req.session.token);
      audit({ tenantId: req.session.tenantId, actorUserId: req.session.userId, action: 'auth.logout', entityType: 'session', entityId: req.session.token });
    }
    clearSessionCookie(reply);
    return ok(reply, { ok: true });
  });

  app.get('/me', async (req, reply) => {
    if (!req.user || !req.tenant) return ok(reply, { user: null, tenant: null });
    const u = req.user!;
    return ok(reply, {
      user: { id: u.id, email: u.email, name: u.name, role: u.role },
      tenant: { id: req.tenant!.id, name: req.tenant!.name, slug: req.tenant!.slug },
    });
  });
};
