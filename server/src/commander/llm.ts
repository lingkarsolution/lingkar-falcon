// AI SDK / OpenRouter LLM adapter. Keeps a small OpenAI-compatible response shape
// for older services while Commander uses streamText directly.
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText, streamText, type LanguageModel, type ModelMessage } from 'ai';
import { config } from '../config.js';

export type ChatMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string; tool_calls?: any[]; name?: string }
  | { role: 'tool'; tool_call_id: string; name: string; content: string };

export type ToolDef = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ChatRequest = {
  messages: ChatMessage[];
  tools?: ToolDef[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  timeoutMs?: number;
  stream?: boolean;
  onTextDelta?: (delta: string) => void | Promise<void>;
  onStreamEvent?: (event: { type: 'start' | 'text_delta' | 'reasoning_delta' | 'error' | 'finish'; text?: string; error?: string }) => void | Promise<void>;
};

export type ChatResponse = {
  id?: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string | null; tool_calls?: any[] };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

type ModelKind = 'chat' | 'completion';
const DEFAULT_LLM_TIMEOUT_MS = 60_000;

const JSON_PROVIDER_OPTIONS = {
  openrouter: {
    reasoning: { effort: 'none', exclude: true },
  },
} as const;

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

const openRouterApiKey = () => config.llm.apiKey || process.env.OPENROUTER_API_KEY || '';

const configuredModel = (): { modelId: string; kind: ModelKind } => {
  const raw = config.llm.model || 'openai/gpt-4o-mini';
  if (raw.startsWith('completion:')) return { modelId: raw.slice('completion:'.length), kind: 'completion' };
  if ((process.env.LLM_MODEL_TYPE ?? '').toLowerCase() === 'completion') return { modelId: raw, kind: 'completion' };
  return { modelId: raw.startsWith('chat:') ? raw.slice('chat:'.length) : raw, kind: 'chat' };
};

const openrouter = () => createOpenRouter({
  apiKey: openRouterApiKey(),
  baseURL: config.llm.baseUrl || undefined,
  appName: 'OmniSense Commander',
  appUrl: 'https://omnisense.local',
  compatibility: 'strict',
});

export const llmAvailable = (): boolean => Boolean(openRouterApiKey());

export const llmModelKind = (): ModelKind => configuredModel().kind;

export const llmSupportsTools = (): boolean => llmModelKind() === 'chat';

export const getLlmModel = (): LanguageModel => {
  const { modelId, kind } = configuredModel();
  const provider = openrouter();
  return kind === 'completion'
    ? provider.completion(modelId, { usage: { include: true } })
    : provider.chat(modelId, { usage: { include: true } });
};

export const chatCompletion = async (req: ChatRequest): Promise<ChatResponse> => {
  if (!llmAvailable()) throw new Error('LLM_NOT_CONFIGURED: set LLM_API_KEY or OPENROUTER_API_KEY');
  if (req.tools?.length) throw new Error('AI SDK tool calls are handled by Commander runtime');
  const controller = new AbortController();
  const timeoutMs = Math.max(1_000, req.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const messages = req.messages
    .filter((message) => message.role !== 'tool')
    .map((message) => ({ role: message.role, content: message.content ?? '' })) as ModelMessage[];

  const finalMessages = req.jsonMode
    ? [{ role: 'system', content: 'Return only valid JSON. Do not include markdown fences, prose, or commentary.' } as ModelMessage, ...messages]
    : messages;

  try {
    if (req.stream || req.onTextDelta || req.onStreamEvent) {
      let text = '';
      let finishReason = 'stop';
      await req.onStreamEvent?.({ type: 'start' });
      const result = streamText({
        model: getLlmModel(),
        messages: finalMessages,
        allowSystemInMessages: true,
        temperature: req.temperature ?? 0.2,
        maxOutputTokens: req.maxTokens,
        abortSignal: controller.signal,
        providerOptions: req.jsonMode ? JSON_PROVIDER_OPTIONS : undefined,
      });

      for await (const part of result.fullStream) {
        switch (part.type) {
          case 'text-delta':
            text += part.text;
            await req.onTextDelta?.(part.text);
            await req.onStreamEvent?.({ type: 'text_delta', text: part.text });
            break;
          case 'reasoning-delta':
            await req.onStreamEvent?.({ type: 'reasoning_delta', text: part.text });
            break;
          case 'error':
            await req.onStreamEvent?.({ type: 'error', error: errorMessage(part.error) });
            break;
          case 'finish':
            finishReason = String(part.finishReason ?? 'stop');
            break;
          default:
            break;
        }
      }
      await req.onStreamEvent?.({ type: 'finish' });
      return {
        choices: [{
          index: 0,
          message: { role: 'assistant', content: text },
          finish_reason: finishReason,
        }],
      };
    }

    const result = await generateText({
      model: getLlmModel(),
      messages: finalMessages,
      allowSystemInMessages: true,
      temperature: req.temperature ?? 0.2,
      maxOutputTokens: req.maxTokens,
      abortSignal: controller.signal,
      providerOptions: req.jsonMode ? JSON_PROVIDER_OPTIONS : undefined,
    });

    const promptTokens = result.usage.inputTokens ?? 0;
    const completionTokens = result.usage.outputTokens ?? 0;
    return {
      choices: [{
        index: 0,
        message: { role: 'assistant', content: result.text },
        finish_reason: result.finishReason,
      }],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: result.usage.totalTokens ?? promptTokens + completionTokens,
      },
    };
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`LLM request timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
};
