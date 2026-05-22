import type { FastifyReply, FastifyRequest } from 'fastify';
import { store } from '../db/store.js';
import type { Role, User, Session, Tenant } from '../types.js';
import { errorResponse } from '../lib/api.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
    tenant?: Tenant;
    session?: Session;
  }
}

const SESSION_COOKIE = 'cf_session';

export const setSessionCookie = (reply: FastifyReply, token: string) => {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 60 * 60 * 24 * 7,
  });
};

export const clearSessionCookie = (reply: FastifyReply) => {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
};

export const loadSession = async (request: FastifyRequest): Promise<void> => {
  const token = request.cookies?.[SESSION_COOKIE];
  if (!token) return;
  const session = store.get('sessions', token);
  if (!session) return;
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    store.delete('sessions', token);
    return;
  }
  const user = store.get('users', session.userId);
  const tenant = user ? store.get('tenants', user.tenantId) : undefined;
  if (!user || !tenant) return;
  request.user = user;
  request.tenant = tenant;
  request.session = session;
};

export const requireAuth = (allowed?: Role[]) =>
  async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      errorResponse(reply, 401, 'AUTH_REQUIRED', 'Authentication required');
      return reply;
    }
    if (allowed && !allowed.includes(request.user.role)) {
      errorResponse(reply, 403, 'FORBIDDEN', 'Insufficient role');
      return reply;
    }
    return undefined;
  };
