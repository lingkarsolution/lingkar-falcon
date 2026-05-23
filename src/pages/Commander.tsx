import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Send, MessagesSquare, BrainCircuit, Loader2, CheckCircle2, AlertTriangle, Globe2 } from "lucide-react";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";

interface Conversation { id: string; title: string; createdAt: string; updatedAt: string }
interface ConversationTurn {
  id: string; conversationId: string;
  role: "user" | "assistant" | "tool" | "system";
  content: unknown;
  createdAt: string;
}

type ToolStatus = "ok" | "error" | "rejected_budget" | "rejected_rbac" | "running";

type ToolCallView = {
  id: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  status: ToolStatus;
  durationMs?: number;
  createdAt?: string;
};

type ChatBubble = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  thinking?: string;
  tools?: ToolCallView[];
  streaming?: boolean;
  error?: string;
};

type StreamEvent =
  | { type: "conversation"; conversationId: string; title?: string | null }
  | { type: "user"; id: string; content: string; createdAt: string }
  | { type: "assistant_start"; id: string; createdAt: string }
  | { type: "assistant_delta"; id: string; delta: string }
  | { type: "thinking_delta"; id: string; delta: string }
  | { type: "tool_call"; id: string; toolName: string; input: unknown; createdAt: string }
  | { type: "tool_result"; id: string; toolName: string; input: unknown; output: unknown; status: ToolStatus; durationMs: number; createdAt: string }
  | { type: "error"; message: string }
  | { type: "done"; conversationId: string; finalMessage: string };

const stringify = (value: unknown, limit = 5000) => {
  let text: string;
  if (typeof value === "string") text = value;
  else {
    try { text = JSON.stringify(value, null, 2); } catch { text = String(value); }
  }
  return text.length > limit ? `${text.slice(0, limit)}\n...truncated` : text;
};

const groupTurns = (turns: ConversationTurn[]): ChatBubble[] => {
  const bubbles: ChatBubble[] = [];
  let pendingTools: ToolCallView[] = [];

  for (const turn of turns) {
    if (turn.role === "user") {
      if (pendingTools.length) {
        bubbles.push({ id: `tools-${turn.id}`, role: "assistant", content: "", tools: pendingTools });
        pendingTools = [];
      }
      bubbles.push({ id: turn.id, role: "user", content: stringify(turn.content), createdAt: turn.createdAt });
      continue;
    }

    if (turn.role === "tool") {
      const toolContent = turn.content as { name?: string; input?: unknown; output?: unknown; status?: ToolStatus } | null;
      pendingTools.push({
        id: turn.id,
        toolName: toolContent?.name ?? "tool",
        input: toolContent?.input,
        output: toolContent?.output,
        status: toolContent?.status ?? "ok",
        createdAt: turn.createdAt,
      });
      continue;
    }

    if (turn.role === "assistant") {
      bubbles.push({
        id: turn.id,
        role: "assistant",
        content: stringify(turn.content),
        createdAt: turn.createdAt,
        tools: pendingTools,
      });
      pendingTools = [];
    }
  }

  if (pendingTools.length) bubbles.push({ id: `tools-tail-${pendingTools[0]?.id}`, role: "assistant", content: "", tools: pendingTools });
  return bubbles;
};

const upsertTool = (tools: ToolCallView[] = [], next: ToolCallView) => {
  const existing = tools.findIndex((item) => item.id === next.id);
  if (existing === -1) return [...tools, next];
  return tools.map((item) => item.id === next.id ? { ...item, ...next } : item);
};

function ToolPanel({ toolCall }: { toolCall: ToolCallView }) {
  const ok = toolCall.status === "ok";
  const running = toolCall.status === "running";
  return (
    <details className="group rounded-md border border-border bg-background/80 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 outline-none">
        {running ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />}
        <span className="min-w-0 flex-1 truncate font-medium">{toolCall.toolName}</span>
        {toolCall.durationMs !== undefined && <span className="text-[11px] text-muted-foreground">{toolCall.durationMs}ms</span>}
        <Badge variant="outline" className="h-5 rounded-md px-1.5 text-[10px]">{toolCall.status}</Badge>
      </summary>
      <div className="grid gap-2 border-t border-border p-3 md:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <p className="font-medium text-muted-foreground">Input</p>
          <pre className="max-h-56 overflow-auto rounded-md bg-muted p-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words">{stringify(toolCall.input)}</pre>
        </div>
        <div className="min-w-0 space-y-1">
          <p className="font-medium text-muted-foreground">Result</p>
          <pre className="max-h-56 overflow-auto rounded-md bg-muted p-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words">{toolCall.output === undefined ? "Waiting for result..." : stringify(toolCall.output)}</pre>
        </div>
      </div>
    </details>
  );
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ ...props }: any) => <h1 className="mb-3 mt-4 text-xl font-semibold leading-tight first:mt-0" {...props} />,
        h2: ({ ...props }: any) => <h2 className="mb-2 mt-4 text-lg font-semibold leading-tight first:mt-0" {...props} />,
        h3: ({ ...props }: any) => <h3 className="mb-2 mt-3 text-base font-semibold leading-tight first:mt-0" {...props} />,
        p: ({ ...props }: any) => <p className="my-2 leading-relaxed first:mt-0 last:mb-0" {...props} />,
        a: ({ ...props }: any) => <a className="font-medium text-primary underline underline-offset-4" target="_blank" rel="noreferrer" {...props} />,
        ul: ({ ...props }: any) => <ul className="my-2 list-disc space-y-1 pl-5" {...props} />,
        ol: ({ ...props }: any) => <ol className="my-2 list-decimal space-y-1 pl-5" {...props} />,
        li: ({ ...props }: any) => <li className="leading-relaxed" {...props} />,
        blockquote: ({ ...props }: any) => <blockquote className="my-3 border-l-2 border-border pl-3 text-muted-foreground" {...props} />,
        table: ({ ...props }: any) => (
          <div className="my-3 overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[520px] border-collapse text-left text-xs" {...props} />
          </div>
        ),
        thead: ({ ...props }: any) => <thead className="bg-muted/70" {...props} />,
        th: ({ ...props }: any) => <th className="border-b border-border px-3 py-2 font-semibold" {...props} />,
        td: ({ ...props }: any) => <td className="border-t border-border px-3 py-2 align-top" {...props} />,
        code: ({ className, children, ...props }: any) => {
          const inline = !className;
          return inline
            ? <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...props}>{children}</code>
            : <code className={cn("font-mono text-xs", className)} {...props}>{children}</code>;
        },
        pre: ({ ...props }: any) => <pre className="my-3 overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed" {...props} />,
        hr: ({ ...props }: any) => <hr className="my-4 border-border" {...props} />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function AssistantBubble({ bubble }: { bubble: ChatBubble }) {
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-3xl rounded-lg rounded-bl-sm border border-border bg-card px-4 py-3 text-sm shadow-sm">
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="font-medium text-foreground">Commander</span>
          {bubble.streaming && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        </div>
        {bubble.thinking?.trim() && (
          <details className="mb-2 rounded-md border border-violet-200 bg-violet-50/70 dark:border-violet-900 dark:bg-violet-950/20">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-violet-800 outline-none dark:text-violet-200">
              <BrainCircuit className="h-3.5 w-3.5" />
              Thinking
            </summary>
            <p className="border-t border-violet-200 px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-violet-900 dark:border-violet-900 dark:text-violet-100">{bubble.thinking}</p>
          </details>
        )}
        {!!bubble.tools?.length && <div className="mb-3 space-y-2">{bubble.tools.map((toolCall) => <ToolPanel key={toolCall.id} toolCall={toolCall} />)}</div>}
        {bubble.content ? (
          <div className="min-w-0 text-foreground">
            <MarkdownContent content={bubble.content} />
          </div>
        ) : bubble.streaming ? (
          <div className="text-muted-foreground">Streaming response...</div>
        ) : null}
        {bubble.error && <p className="mt-2 text-xs text-destructive">{bubble.error}</p>}
      </div>
    </div>
  );
}

function UserBubble({ bubble }: { bubble: ChatBubble }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-2xl rounded-lg rounded-br-sm bg-primary px-4 py-2 text-sm leading-relaxed text-primary-foreground shadow-sm whitespace-pre-wrap break-words">
        {bubble.content}
      </div>
    </div>
  );
}

export default function Commander() {
  const qc = useQueryClient();
  const [convId, setConvId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatBubble[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const assistantIdRef = useRef<string>("");
  const userIdRef = useRef<string>("");

  const conversations = useQuery({
    queryKey: qk.conversations,
    queryFn: () => api.get<Conversation[]>("/commander/conversations"),
  });

  const turns = useQuery({
    queryKey: convId ? qk.conversation(convId) : ["conv-empty"],
    queryFn: () => convId
      ? api.get<{ conversation: Conversation; turns: ConversationTurn[] }>(`/commander/conversations/${convId}/turns`)
      : Promise.resolve({ conversation: {} as Conversation, turns: [] }),
    enabled: !!convId,
  });

  const persistedMessages = useMemo(() => groupTurns(turns.data?.turns ?? []), [turns.data?.turns]);

  useEffect(() => {
    if (!streaming) setMessages(persistedMessages);
  }, [persistedMessages, streaming]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const updateAssistant = (updater: (bubble: ChatBubble) => ChatBubble) => {
    const id = assistantIdRef.current;
    setMessages((prev) => prev.map((bubble) => bubble.id === id && bubble.role === "assistant" ? updater(bubble) : bubble));
  };

  const handleStreamEvent = (event: StreamEvent) => {
    if (event.type === "conversation") {
      setConvId(event.conversationId);
      return;
    }
    if (event.type === "user") {
      setMessages((prev) => prev.map((bubble) => bubble.id === userIdRef.current ? { ...bubble, id: event.id, createdAt: event.createdAt } : bubble));
      userIdRef.current = event.id;
      return;
    }
    if (event.type === "assistant_start") {
      const previousId = assistantIdRef.current;
      assistantIdRef.current = event.id;
      setMessages((prev) => prev.map((bubble) => bubble.id === previousId ? { ...bubble, id: event.id, createdAt: event.createdAt, streaming: true } : bubble));
      return;
    }
    if (event.type === "assistant_delta") {
      updateAssistant((bubble) => ({ ...bubble, content: `${bubble.content}${event.delta}`, streaming: true }));
      return;
    }
    if (event.type === "thinking_delta") {
      updateAssistant((bubble) => ({ ...bubble, thinking: `${bubble.thinking ?? ""}${event.delta}`, streaming: true }));
      return;
    }
    if (event.type === "tool_call") {
      updateAssistant((bubble) => ({
        ...bubble,
        tools: upsertTool(bubble.tools, { id: event.id, toolName: event.toolName, input: event.input, status: "running", createdAt: event.createdAt }),
        streaming: true,
      }));
      return;
    }
    if (event.type === "tool_result") {
      updateAssistant((bubble) => ({
        ...bubble,
        tools: upsertTool(bubble.tools, { id: event.id, toolName: event.toolName, input: event.input, output: event.output, status: event.status, durationMs: event.durationMs, createdAt: event.createdAt }),
        streaming: true,
      }));
      return;
    }
    if (event.type === "error") {
      setStreamError(event.message);
      updateAssistant((bubble) => ({ ...bubble, error: event.message, streaming: false }));
      return;
    }
    if (event.type === "done") {
      updateAssistant((bubble) => ({ ...bubble, streaming: false }));
      setConvId(event.conversationId);
      setStreaming(false);
      qc.invalidateQueries({ queryKey: qk.conversations });
      qc.invalidateQueries({ queryKey: qk.conversation(event.conversationId) });
    }
  };

  const parseSseBlock = (block: string) => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    handleStreamEvent(JSON.parse(data) as StreamEvent);
  };

  const sendMessage = async () => {
    const message = input.trim();
    if (!message || streaming) return;

    const localUserId = `local-user-${Date.now()}`;
    const localAssistantId = `local-assistant-${Date.now()}`;
    userIdRef.current = localUserId;
    assistantIdRef.current = localAssistantId;
    setStreamError(null);
    setStreaming(true);
    setInput("");
    setMessages((prev) => [
      ...prev,
      { id: localUserId, role: "user", content: message },
      { id: localAssistantId, role: "assistant", content: "", thinking: "", tools: [], streaming: true },
    ]);

    try {
      const response = await fetch("/api/v1/commander/messages/stream", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, conversationId: convId ?? undefined }),
      });
      if (!response.ok || !response.body) throw new Error(`Commander stream failed: HTTP ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let marker = buffer.search(/\r?\n\r?\n/);
        while (marker !== -1) {
          const block = buffer.slice(0, marker);
          buffer = buffer.slice(buffer[marker] === "\r" ? marker + 4 : marker + 2);
          parseSseBlock(block);
          marker = buffer.search(/\r?\n\r?\n/);
        }
      }
      if (buffer.trim()) parseSseBlock(buffer);
    } catch (error) {
      const messageText = (error as Error).message;
      setStreamError(messageText);
      updateAssistant((bubble) => ({ ...bubble, error: messageText, streaming: false }));
      setStreaming(false);
    }
  };

  const startNewChat = () => {
    if (streaming) return;
    setConvId(null);
    setMessages([]);
    setStreamError(null);
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-0">
      <aside className="hidden w-72 shrink-0 border-r border-border bg-muted/20 p-3 md:block">
        <Button variant="outline" className="w-full justify-start rounded-md" onClick={startNewChat} disabled={streaming}>
          <Sparkles className="mr-2 h-4 w-4" /> New chat
        </Button>
        <div className="px-2 pb-1 pt-4 text-xs font-medium uppercase text-muted-foreground">History</div>
        <div className="space-y-1 overflow-y-auto pr-1">
          {(conversations.data ?? []).map((conversation) => (
            <button
              key={conversation.id}
              onClick={() => { if (!streaming) setConvId(conversation.id); }}
              className={cn(
                "w-full rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
                convId === conversation.id && "bg-accent",
              )}
            >
              <p className="truncate font-medium">{conversation.title}</p>
              <p className="text-[10px] text-muted-foreground">{new Date(conversation.updatedAt).toLocaleDateString()}</p>
            </button>
          ))}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4 sm:px-6">
          <MessagesSquare className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Commander AI</h2>
          <Badge variant="outline" className="ml-1 hidden rounded-md sm:inline-flex">multi-skill agent</Badge>
          <Badge variant="secondary" className="ml-auto rounded-md"><Globe2 className="mr-1 h-3 w-3" /> OSINT first</Badge>
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
          {messages.length === 0 && (
            <Card className="mx-auto max-w-2xl rounded-lg">
              <CardContent className="space-y-4 p-6">
                <div className="space-y-2">
                  <p className="text-lg font-semibold">Ask Commander</p>
                  <p className="text-sm text-muted-foreground">It can search monitoring data, live web results, reports, risks, actors, connectors, and topic analytics.</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {["Search web and fetch context about the latest subsidy policy", "Summarize sentiment for my active topics", "Find amplifiers for the most negative topic", "Generate a report from the latest mentions"].map((example) => (
                    <Button key={example} variant="outline" className="h-auto justify-start rounded-md px-3 py-2 text-left text-xs whitespace-normal" onClick={() => setInput(example)}>
                      {example}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          {messages.map((bubble) => bubble.role === "user" ? <UserBubble key={bubble.id} bubble={bubble} /> : <AssistantBubble key={bubble.id} bubble={bubble} />)}
          {streamError && <p className="mx-auto max-w-3xl text-xs text-destructive">{streamError}</p>}
        </div>

        <footer className="shrink-0 border-t border-border p-3 sm:p-4">
          <div className="mx-auto flex max-w-3xl gap-2">
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask Commander..."
              rows={2}
              className="min-h-12 resize-none rounded-md"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
            />
            <Button className="h-auto rounded-md px-4" onClick={() => void sendMessage()} disabled={!input.trim() || streaming}>
              {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
