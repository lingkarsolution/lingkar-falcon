import type { FastifyReply } from 'fastify';

export const ok = <T>(reply: FastifyReply, data: T, meta?: Record<string, unknown>) =>
  reply.send({ ok: true, data, ...(meta ? { meta } : {}) });

export const errorResponse = (
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
) => reply.status(status).send({ ok: false, error: { code, message, ...(details ? { details } : {}) } });

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const paginate = <T>(items: T[], limit = 50, cursor?: string | null) => {
  const startIdx = cursor ? Number(Buffer.from(cursor, 'base64').toString('utf8')) || 0 : 0;
  const slice = items.slice(startIdx, startIdx + limit);
  const hasNext = startIdx + limit < items.length;
  const nextCursor = hasNext
    ? Buffer.from(String(startIdx + limit)).toString('base64')
    : null;
  const prevCursor = startIdx > 0
    ? Buffer.from(String(Math.max(0, startIdx - limit))).toString('base64')
    : null;
  return {
    items: slice,
    pageInfo: {
      nextCursor, previousCursor: prevCursor,
      hasNextPage: hasNext, hasPreviousPage: startIdx > 0,
    },
    totalEstimate: items.length,
  };
};
