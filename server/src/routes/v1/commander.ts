import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { store } from '../../db/store.js';
import { requireAuth } from '../../middleware/auth.js';
import { errorResponse, ok } from '../../lib/api.js';
import { runCommander, runCommanderStreaming, type CommanderStreamEvent } from '../../commander/runtime.js';
import { TOOLS } from '../../commander/tools.js';
import type { Conversation, ConversationTurn } from '../../types.js';

const messageSchema = z.object({
  message: z.string().min(1),
  conversationId: z.string().optional(),
});

export const registerCommanderRoutes = (app: FastifyInstance) => {
  app.get('/tools', { preHandler: requireAuth() }, async (_req, reply) =>
    ok(reply, TOOLS.map((t) => ({ name: t.name, description: t.description, requiresRole: t.requiresRole ?? null }))));

  app.get('/conversations', { preHandler: requireAuth() }, async (req, reply) =>
    ok(reply, (store.list('conversations') as Conversation[])
      .filter((c) => c.tenantId === req.tenant!.id && c.userId === req.user!.id)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())));

  app.get('/conversations/:id/turns', { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const conv = store.get('conversations', id) as Conversation | undefined;
    if (!conv || conv.tenantId !== req.tenant!.id) return errorResponse(reply, 404, 'NOT_FOUND', 'Conversation not found');
    const turns = (store.list('conversationTurns') as ConversationTurn[])
      .filter((t) => t.conversationId === id)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return ok(reply, { conversation: conv, turns });
  });

  app.post('/messages', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(reply, 400, 'INVALID_INPUT', 'Invalid message', { issues: parsed.error.issues });
    try {
      const result = await runCommander({
        ctx: { tenantId: req.tenant!.id, userId: req.user!.id, userRole: req.user!.role },
        userMessage: parsed.data.message,
        conversationId: parsed.data.conversationId,
      });
      const conv = store.get('conversations', result.conversationId);
      if (conv) store.put('conversations', conv.id, { ...conv, updatedAt: new Date().toISOString() });
      return ok(reply, result);
    } catch (e) {
      return errorResponse(reply, 500, 'COMMANDER_ERROR', (e as Error).message);
    }
  });

  app.post('/messages/stream', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(reply, 400, 'INVALID_INPUT', 'Invalid message', { issues: parsed.error.issues });

    const abort = new AbortController();
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const write = (event: CommanderStreamEvent) => {
      if (reply.raw.writableEnded) return;
      reply.raw.write(`event: ${event.type}\n`);
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    req.raw.on('close', () => {
      if (!reply.raw.writableEnded) abort.abort();
    });

    try {
      await runCommanderStreaming({
        ctx: { tenantId: req.tenant!.id, userId: req.user!.id, userRole: req.user!.role },
        userMessage: parsed.data.message,
        conversationId: parsed.data.conversationId,
        abortSignal: abort.signal,
        onEvent: write,
      });
    } catch (e) {
      write({ type: 'error', message: (e as Error).message });
    } finally {
      if (!reply.raw.writableEnded) reply.raw.end();
    }
  });
};
