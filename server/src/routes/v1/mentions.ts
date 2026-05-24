import type { FastifyInstance } from 'fastify';
import { store } from '../../db/store.js';
import { requireAuth } from '../../middleware/auth.js';
import { errorResponse, ok, paginate } from '../../lib/api.js';
import type { Mention } from '../../types.js';

export const registerMentionRoutes = (app: FastifyInstance) => {
  app.get('/', { preHandler: requireAuth() }, async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    let list = (store.list('mentions') as Mention[]).filter((m) => m.tenantId === req.tenant!.id);
    if (q.topicId) list = list.filter((m) => m.topicId === q.topicId);
    const platform = q.platform ?? q.source;
    if (platform) list = list.filter((m) => m.platform === platform);
    if (q.sourceType) list = list.filter((m) => m.sourceType === q.sourceType);
    if (q.mediaType) {
      const mediaType = q.mediaType;
      list = list.filter((m) => {
        const media = m.media ?? [];
        if (mediaType === 'none' || mediaType === 'no_media') return media.length === 0;
        if (mediaType === 'other') return media.some((asset) => asset.type !== 'image' && asset.type !== 'video');
        return media.some((asset) => asset.type === mediaType);
      });
    }
    if (q.sentiment) list = list.filter((m) => m.nlp.sentiment === q.sentiment);
    if (q.search) {
      const needle = q.search.toLowerCase();
      list = list.filter((m) => m.text.toLowerCase().includes(needle));
    }
    const sortDirection = q.sort === 'oldest' ? 1 : -1;
    list = list.sort((a, b) =>
      sortDirection * (new Date(a.publishedAt ?? a.collectedAt).getTime() - new Date(b.publishedAt ?? b.collectedAt).getTime()));
    const limit = Math.min(200, Number(q.limit ?? 50));
    return ok(reply, paginate(list, limit, q.cursor ?? null));
  });

  app.get('/:id', { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const m = store.get('mentions', id) as Mention | undefined;
    if (!m || m.tenantId !== req.tenant!.id) return errorResponse(reply, 404, 'NOT_FOUND', 'Mention not found');
    return ok(reply, m);
  });

  app.get('/export.csv', { preHandler: requireAuth() }, async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    let list = (store.list('mentions') as Mention[]).filter((m) => m.tenantId === req.tenant!.id);
    if (q.topicId) list = list.filter((m) => m.topicId === q.topicId);
    const header = 'id,publishedAt,platform,sentiment,author,url,text\n';
    const rows = list.slice(0, 5000).map((m) => {
      const cells = [
        m.id, m.publishedAt ?? m.collectedAt, m.platform, m.nlp.sentiment,
        m.author?.displayName ?? m.author?.username ?? '',
        m.sourceUrl ?? '',
        '"' + (m.text ?? '').replace(/"/g, '""').replace(/\n/g, ' ') + '"',
      ];
      return cells.join(',');
    }).join('\n');
    reply.header('content-type', 'text/csv').header('content-disposition', 'attachment; filename="mentions.csv"');
    return reply.send(header + rows);
  });
};
