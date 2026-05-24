import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { store } from '../../db/store.js';
import { requireAuth } from '../../middleware/auth.js';
import { errorResponse, ok } from '../../lib/api.js';
import { chatCompletion, llmAvailable } from '../../commander/llm.js';
import { chatAboutTopicSentiment, generateDailyBrief, generateSentimentStrategy, getLatestSentimentStrategy } from '../../services/insights.js';
import { clusterTopic } from '../../services/clustering.js';
import { detectRiskEvents } from '../../services/risk.js';
import { analyzeMentionsSentimentBulk } from '../../services/sentiment.js';
import type { Topic, Insight, IssueCluster, RiskEvent } from '../../types.js';

const topicIdSchema = z.object({ topicId: z.string() });
const sentimentSchema = z.object({
  topicId: z.string(),
  mentionIds: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(250).default(100),
});
const topicChatSchema = z.object({
  message: z.string().min(1).max(4000),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(6000),
  })).max(12).default([]),
});
const topicDescriptionSchema = z.object({
  title: z.string().trim().min(2).max(160),
});

const cleanGeneratedDescription = (value: string): string => value
  .replace(/^["'`]+|["'`]+$/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 600);

export const registerAIRoutes = (app: FastifyInstance) => {
  app.post('/topic-description', { preHandler: requireAuth(['admin', 'analyst']) }, async (req, reply) => {
    const parsed = topicDescriptionSchema.safeParse(req.body ?? {});
    if (!parsed.success) return errorResponse(reply, 400, 'INVALID_INPUT', 'Invalid topic title', { issues: parsed.error.issues });
    if (!llmAvailable()) return errorResponse(reply, 503, 'LLM_NOT_CONFIGURED', 'LLM is not configured');
    try {
      const response = await chatCompletion({
        temperature: 0.25,
        maxTokens: 180,
        messages: [
          {
            role: 'system',
            content: 'You write concise monitored-topic descriptions for an OSINT and public sentiment intelligence system. The description will be used by analysts and by relevance filters to disambiguate noisy social/news data. Write 1-2 plain sentences, max 420 characters. Include the likely subject, domain, and what should count as related evidence. Avoid markdown, labels, quotes, bullets, and generic filler.',
          },
          {
            role: 'user',
            content: `Generate a monitored topic description for this title: ${parsed.data.title}`,
          },
        ],
      });
      const description = cleanGeneratedDescription(response.choices[0]?.message.content ?? '');
      if (!description) return errorResponse(reply, 502, 'EMPTY_LLM_RESPONSE', 'LLM returned an empty description');
      return ok(reply, { description, llmEnabled: true, generatedAt: new Date().toISOString() });
    } catch (error) {
      return errorResponse(reply, 500, 'TOPIC_DESCRIPTION_ERROR', (error as Error).message);
    }
  });

  app.post('/daily-brief', { preHandler: requireAuth(['admin', 'analyst']) }, async (req, reply) => {
    const parsed = topicIdSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(reply, 400, 'INVALID_INPUT', 'topicId required');
    const t = store.get('topics', parsed.data.topicId) as Topic | undefined;
    if (!t || t.tenantId !== req.tenant!.id) return errorResponse(reply, 404, 'NOT_FOUND', 'Topic not found');
    const insight = await generateDailyBrief(req.tenant!.id, t.id);
    return ok(reply, insight);
  });

  app.get('/topics/:id/insights', { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const list = (store.list('insights') as Insight[])
      .filter((i) => i.tenantId === req.tenant!.id && i.topicId === id)
      .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
    return ok(reply, list);
  });

  app.get('/topics/:id/sentiment-strategy', { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = store.get('topics', id) as Topic | undefined;
    if (!t || t.tenantId !== req.tenant!.id) return errorResponse(reply, 404, 'NOT_FOUND', 'Topic not found');
    return ok(reply, getLatestSentimentStrategy(req.tenant!.id, id));
  });

  app.post('/topics/:id/sentiment-strategy', { preHandler: requireAuth(['admin', 'analyst']) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = store.get('topics', id) as Topic | undefined;
    if (!t || t.tenantId !== req.tenant!.id) return errorResponse(reply, 404, 'NOT_FOUND', 'Topic not found');
    const strategy = await generateSentimentStrategy(req.tenant!.id, id);
    return ok(reply, strategy);
  });

  app.post('/topics/:id/chat', { preHandler: requireAuth(['admin', 'analyst']) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = store.get('topics', id) as Topic | undefined;
    if (!t || t.tenantId !== req.tenant!.id) return errorResponse(reply, 404, 'NOT_FOUND', 'Topic not found');
    const parsed = topicChatSchema.safeParse(req.body ?? {});
    if (!parsed.success) return errorResponse(reply, 400, 'INVALID_INPUT', 'Invalid chat request', { issues: parsed.error.issues });
    try {
      const result = await chatAboutTopicSentiment({
        tenantId: req.tenant!.id,
        topicId: id,
        message: parsed.data.message,
        history: parsed.data.history,
      });
      return ok(reply, result);
    } catch (error) {
      return errorResponse(reply, 500, 'TOPIC_CHAT_ERROR', (error as Error).message);
    }
  });

  app.post('/cluster', { preHandler: requireAuth(['admin', 'analyst']) }, async (req, reply) => {
    const parsed = topicIdSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(reply, 400, 'INVALID_INPUT', 'topicId required');
    const clusters = clusterTopic(req.tenant!.id, parsed.data.topicId);
    return ok(reply, clusters);
  });

  app.get('/topics/:id/clusters', { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const list = (store.list('issueClusters') as IssueCluster[]).filter((c) => c.tenantId === req.tenant!.id && c.topicId === id);
    return ok(reply, list);
  });

  app.post('/detect-risk', { preHandler: requireAuth(['admin', 'analyst']) }, async (req, reply) => {
    const parsed = topicIdSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(reply, 400, 'INVALID_INPUT', 'topicId required');
    clusterTopic(req.tenant!.id, parsed.data.topicId);
    const events = detectRiskEvents(req.tenant!.id, parsed.data.topicId);
    return ok(reply, events);
  });

  app.post('/analyze-sentiment', { preHandler: requireAuth(['admin', 'analyst']) }, async (req, reply) => {
    const parsed = sentimentSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(reply, 400, 'INVALID_INPUT', 'Invalid sentiment request', { issues: parsed.error.issues });
    const t = store.get('topics', parsed.data.topicId) as Topic | undefined;
    if (!t || t.tenantId !== req.tenant!.id) return errorResponse(reply, 404, 'NOT_FOUND', 'Topic not found');
    const result = await analyzeMentionsSentimentBulk({
      tenantId: req.tenant!.id,
      topicId: t.id,
      mentionIds: parsed.data.mentionIds,
      limit: parsed.data.limit,
    });
    return ok(reply, result);
  });

  app.get('/topics/:id/risk-events', { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const list = (store.list('riskEvents') as RiskEvent[]).filter((r) => r.tenantId === req.tenant!.id && r.topicId === id);
    return ok(reply, list);
  });
};
