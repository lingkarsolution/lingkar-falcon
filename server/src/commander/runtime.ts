// Commander runtime — AI SDK streaming with tool execution, RBAC, and persistence.
import { streamText, stepCountIs, tool, type ModelMessage, type ToolSet } from 'ai';
import { getLlmModel, llmAvailable, llmSupportsTools, llmModelKind } from './llm.js';
import { TOOLS } from './tools.js';
import { COMMANDER_SYSTEM_PROMPT } from './systemPrompt.js';
import { store } from '../db/store.js';
import { newId } from '../lib/crypto.js';
import type { ToolContext } from './tools.js';
import type { Conversation, ConversationTurn } from '../types.js';

const MAX_STEPS = 8;
const MAX_TOOL_OUTPUT_CHARS = 8000;
const MAX_HISTORY_TURNS = 24;

export type CommanderTurn = {
  role: 'assistant' | 'tool' | 'user';
  content: string;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
  toolStatus?: 'ok' | 'error' | 'rejected_budget' | 'rejected_rbac';
};

export type CommanderRunResult = {
  conversationId: string;
  finalMessage: string;
  turns: CommanderTurn[];
};

export type CommanderStreamEvent =
  | { type: 'conversation'; conversationId: string; title?: string | null }
  | { type: 'user'; id: string; content: string; createdAt: string }
  | { type: 'assistant_start'; id: string; createdAt: string }
  | { type: 'assistant_delta'; id: string; delta: string }
  | { type: 'thinking_delta'; id: string; delta: string }
  | { type: 'tool_call'; id: string; toolName: string; input: unknown; createdAt: string }
  | { type: 'tool_result'; id: string; toolName: string; input: unknown; output: unknown; status: CommanderTurn['toolStatus']; durationMs: number; createdAt: string }
  | { type: 'error'; message: string }
  | { type: 'done'; conversationId: string; finalMessage: string };

const truncate = (value: string) => value.length <= MAX_TOOL_OUTPUT_CHARS
  ? value
  : `${value.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n[...truncated]`;

const now = () => new Date().toISOString();

const contentToText = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  try { return JSON.stringify(content); } catch { return String(content); }
};

const compactForModel = (output: unknown): unknown => {
  const serialized = JSON.stringify(output ?? null);
  if (serialized.length <= MAX_TOOL_OUTPUT_CHARS) return output;
  return { truncated: true, preview: truncate(serialized) };
};

const roleRank = { viewer: 0, analyst: 1, admin: 2 } as const;

const ensureConversation = (params: { ctx: ToolContext; conversationId?: string; userMessage: string }): Conversation => {
  if (params.conversationId) {
    const existing = store.get('conversations', params.conversationId) as Conversation | undefined;
    if (existing && existing.tenantId === params.ctx.tenantId && existing.userId === params.ctx.userId) return existing;
  }

  const conversationId = newId('conv');
  const createdAt = now();
  const conversation: Conversation = {
    id: conversationId,
    tenantId: params.ctx.tenantId,
    userId: params.ctx.userId,
    title: params.userMessage.slice(0, 60),
    createdAt,
    updatedAt: createdAt,
  };
  store.put('conversations', conversationId, conversation);
  return conversation;
};

const modelHistory = (conversationId: string): ModelMessage[] => (store.list('conversationTurns') as ConversationTurn[])
  .filter((turn) => turn.conversationId === conversationId && (turn.role === 'user' || turn.role === 'assistant'))
  .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  .slice(-MAX_HISTORY_TURNS)
  .map((turn) => ({ role: turn.role, content: contentToText(turn.content) })) as ModelMessage[];

const buildAiTools = (params: {
  ctx: ToolContext;
  conversationId: string;
  persistTurn: (role: 'user' | 'assistant' | 'tool' | 'system', content: unknown) => string;
  emit: (event: CommanderStreamEvent) => Promise<void>;
}): ToolSet => Object.fromEntries(TOOLS.map((commanderTool) => [
  commanderTool.name,
  tool({
    description: commanderTool.description,
    inputSchema: commanderTool.inputSchema as any,
    execute: async (input: unknown, options) => {
      const startedAt = Date.now();
      const toolCallId = options.toolCallId || newId('toolcall');
      await params.emit({ type: 'tool_call', id: toolCallId, toolName: commanderTool.name, input, createdAt: now() });
      await params.emit({ type: 'thinking_delta', id: 'thinking', delta: `Using ${commanderTool.name}.\n` });

      let output: unknown;
      let status: CommanderTurn['toolStatus'] = 'ok';
      let normalizedInput = input;

      if (commanderTool.requiresRole && roleRank[params.ctx.userRole] < roleRank[commanderTool.requiresRole]) {
        output = { error: 'rbac_denied', required: commanderTool.requiresRole, have: params.ctx.userRole };
        status = 'rejected_rbac';
      } else {
        const validation = commanderTool.inputSchema.safeParse(input ?? {});
        if (!validation.success) {
          output = { error: 'invalid_input', issues: validation.error.issues };
          status = 'error';
        } else {
          normalizedInput = validation.data;
          try {
            output = await commanderTool.execute(validation.data, params.ctx);
          } catch (error) {
            output = { error: 'tool_exception', message: (error as Error).message };
            status = 'error';
          }
        }
      }

      const durationMs = Date.now() - startedAt;
      const turnId = params.persistTurn('tool', { name: commanderTool.name, input: normalizedInput, output, status });
      const invocationId = newId('toolinv');
      store.put('toolInvocations', invocationId, {
        id: invocationId,
        tenantId: params.ctx.tenantId,
        conversationId: params.conversationId,
        turnId,
        toolName: commanderTool.name,
        input: normalizedInput,
        output,
        status: status ?? 'ok',
        durationMs,
        estimatedCostUsd: null,
        errorMessage: status !== 'ok' ? truncate(JSON.stringify(output)).slice(0, 500) : null,
        createdAt: now(),
      });

      await params.emit({ type: 'tool_result', id: toolCallId, toolName: commanderTool.name, input: normalizedInput, output, status, durationMs, createdAt: now() });
      await params.emit({ type: 'thinking_delta', id: 'thinking', delta: `Finished ${commanderTool.name} in ${durationMs}ms.\n` });

      if (status !== 'ok') return { status, error: compactForModel(output) };
      return compactForModel(output);
    },
  }),
])) as ToolSet;

export const runCommanderStreaming = async (params: {
  ctx: ToolContext;
  userMessage: string;
  conversationId?: string;
  abortSignal?: AbortSignal;
  onEvent?: (event: CommanderStreamEvent) => void | Promise<void>;
}): Promise<CommanderRunResult> => {
  const emit = async (event: CommanderStreamEvent) => { await params.onEvent?.(event); };
  const conversation = ensureConversation(params);
  const conversationId = conversation.id;
  await emit({ type: 'conversation', conversationId, title: conversation.title });

  const persistTurn = (role: 'user' | 'assistant' | 'tool' | 'system', content: unknown) => {
    const id = newId('turn');
    store.put('conversationTurns', id, {
      id,
      tenantId: params.ctx.tenantId,
      conversationId,
      role,
      content,
      createdAt: now(),
    });
    return id;
  };

  const userTurnId = persistTurn('user', params.userMessage);
  const userTurn = store.get('conversationTurns', userTurnId) as ConversationTurn;
  await emit({ type: 'user', id: userTurnId, content: params.userMessage, createdAt: userTurn.createdAt });

  const turns: CommanderTurn[] = [{ role: 'user', content: params.userMessage }];
  const assistantTurnId = newId('turn');
  const assistantCreatedAt = now();
  await emit({ type: 'assistant_start', id: assistantTurnId, createdAt: assistantCreatedAt });

  if (!llmAvailable()) {
    const message = 'AI assistance is not configured yet. Ask an administrator to enable it before using Commander chat.';
    store.put('conversationTurns', assistantTurnId, {
      id: assistantTurnId,
      tenantId: params.ctx.tenantId,
      conversationId,
      role: 'assistant',
      content: message,
      createdAt: assistantCreatedAt,
    });
    turns.push({ role: 'assistant', content: message });
    await emit({ type: 'assistant_delta', id: assistantTurnId, delta: message });
    await emit({ type: 'done', conversationId, finalMessage: message });
    return { conversationId, finalMessage: message, turns };
  }

  let assistantText = '';
  let thinkingSeen = false;
  const tools = llmSupportsTools() ? buildAiTools({ ctx: params.ctx, conversationId, persistTurn, emit }) : undefined;
  if (!tools) {
    await emit({
      type: 'thinking_delta',
      id: 'thinking',
      delta: `LLM_MODEL_TYPE=completion is active; streaming text is enabled but tool calls are unavailable for this model kind (${llmModelKind()}).\n`,
    });
  }

  try {
    const result = streamText({
      model: getLlmModel(),
      system: COMMANDER_SYSTEM_PROMPT,
      messages: modelHistory(conversationId),
      tools,
      toolChoice: tools ? 'auto' : undefined,
      stopWhen: stepCountIs(MAX_STEPS),
      temperature: 0.2,
      abortSignal: params.abortSignal,
    });

    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'start-step':
          if (!thinkingSeen) {
            thinkingSeen = true;
            await emit({ type: 'thinking_delta', id: 'thinking', delta: 'Inspecting the conversation and selecting the right data layer.\n' });
          }
          break;
        case 'reasoning-delta':
          await emit({ type: 'thinking_delta', id: part.id, delta: part.text });
          break;
        case 'tool-input-start':
          await emit({ type: 'thinking_delta', id: 'thinking', delta: `Preparing ${part.toolName} input.\n` });
          break;
        case 'text-delta':
          assistantText += part.text;
          await emit({ type: 'assistant_delta', id: assistantTurnId, delta: part.text });
          break;
        case 'tool-error':
          await emit({ type: 'error', message: `Tool ${part.toolName} failed: ${contentToText(part.error)}` });
          break;
        case 'error':
          await emit({ type: 'error', message: contentToText(part.error) });
          break;
        default:
          break;
      }
    }
  } catch (error) {
    const message = (error as Error).name === 'AbortError' ? 'Commander response was cancelled.' : (error as Error).message;
    await emit({ type: 'error', message });
    if (!assistantText.trim()) assistantText = message;
  }

  if (!assistantText.trim()) {
    assistantText = 'I completed the available steps, but the model did not return a final narrative answer.';
    await emit({ type: 'assistant_delta', id: assistantTurnId, delta: assistantText });
  }

  store.put('conversationTurns', assistantTurnId, {
    id: assistantTurnId,
    tenantId: params.ctx.tenantId,
    conversationId,
    role: 'assistant',
    content: assistantText,
    createdAt: assistantCreatedAt,
  });
  const updated = store.get('conversations', conversationId) as Conversation | undefined;
  if (updated) store.put('conversations', conversationId, { ...updated, updatedAt: now() });

  turns.push({ role: 'assistant', content: assistantText });
  await emit({ type: 'done', conversationId, finalMessage: assistantText });
  return { conversationId, finalMessage: assistantText, turns };
};

export const runCommander = async (params: {
  ctx: ToolContext;
  userMessage: string;
  conversationId?: string;
}): Promise<CommanderRunResult> => {
  const turns: CommanderTurn[] = [];
  let final: CommanderRunResult | null = null;
  final = await runCommanderStreaming({
    ...params,
    onEvent: (event) => {
      if (event.type === 'tool_result') {
        turns.push({
          role: 'tool',
          content: truncate(JSON.stringify(event.output)),
          toolName: event.toolName,
          toolInput: event.input,
          toolOutput: event.output,
          toolStatus: event.status,
        });
      }
    },
  });
  return { ...final, turns: final.turns.length ? final.turns : turns };
};
