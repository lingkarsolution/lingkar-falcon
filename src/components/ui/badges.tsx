import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Sentiment } from "@/lib/api";

const map: Record<Sentiment, string> = {
  positive: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  neutral: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700",
  negative: "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900",
  mixed: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  unknown: "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-800",
};

export const SentimentBadge = ({ sentiment }: { sentiment: Sentiment }) => (
  <Badge variant="outline" className={cn("font-medium capitalize", map[sentiment])}>{sentiment}</Badge>
);

const sevMap: Record<string, string> = {
  low: "bg-slate-100 text-slate-700 border-slate-200",
  medium: "bg-amber-100 text-amber-800 border-amber-200",
  high: "bg-orange-100 text-orange-800 border-orange-200",
  critical: "bg-red-100 text-red-800 border-red-200",
};
export const SeverityBadge = ({ severity }: { severity: string }) => (
  <Badge variant="outline" className={cn("font-medium capitalize", sevMap[severity] ?? sevMap.low)}>{severity}</Badge>
);

const statusMap: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700 border-emerald-200",
  limited: "bg-amber-100 text-amber-700 border-amber-200",
  degraded: "bg-amber-100 text-amber-700 border-amber-200",
  failed: "bg-red-100 text-red-700 border-red-200",
  error: "bg-red-100 text-red-700 border-red-200",
  disabled: "bg-slate-100 text-slate-700 border-slate-200",
  paused: "bg-slate-100 text-slate-700 border-slate-200",
  not_configured: "bg-violet-100 text-violet-700 border-violet-200",
  budget_exceeded: "bg-rose-100 text-rose-700 border-rose-200",
};
export const ConnectorStatusBadge = ({ status }: { status: string }) => (
  <Badge variant="outline" className={cn("font-medium", statusMap[status] ?? statusMap.paused)}>
    {status.replace(/_/g, " ")}
  </Badge>
);

export const PlatformBadge = ({ platform }: { platform: string }) => (
  <Badge variant="secondary" className="font-mono text-[10px] uppercase">{platform}</Badge>
);
