import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface Props {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  tint?: "default" | "purple" | "rose" | "mint" | "sky" | "amber";
}

const tintMap = {
  default: "bg-card",
  purple: "bg-violet-50 dark:bg-violet-950/30",
  rose: "bg-rose-50 dark:bg-rose-950/30",
  mint: "bg-emerald-50 dark:bg-emerald-950/30",
  sky: "bg-sky-50 dark:bg-sky-950/30",
  amber: "bg-amber-50 dark:bg-amber-950/30",
};

export const MetricCard = ({ label, value, hint, icon: Icon, tint = "default" }: Props) => (
  <Card className={cn("border-border", tintMap[tint])}>
    <CardContent className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-2 text-3xl font-semibold text-foreground tabular-nums">{value}</p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {Icon && <Icon className="h-5 w-5 text-muted-foreground" />}
      </div>
    </CardContent>
  </Card>
);
