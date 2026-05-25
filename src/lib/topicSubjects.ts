import {
  Building2,
  CalendarDays,
  CircleAlert,
  Globe2,
  Package,
  User,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Topic, TopicSubjectType } from "@/lib/api";

export type TopicSubjectOption = {
  value: TopicSubjectType;
  label: string;
  helper: string;
  icon: LucideIcon;
};

export const topicSubjectOptions: TopicSubjectOption[] = [
  { value: "public_figure", label: "Public figure", helper: "People with public visibility", icon: UserRound },
  { value: "organization", label: "Organization", helper: "Companies, parties, agencies", icon: Building2 },
  { value: "issue", label: "Issue", helper: "Policy, crisis, public concern", icon: CircleAlert },
  { value: "group", label: "Group", helper: "Communities or movements", icon: Users },
  { value: "brand", label: "Brand / product", helper: "Products, services, competitors", icon: Package },
  { value: "event", label: "Event", helper: "Campaigns, launches, incidents", icon: CalendarDays },
  { value: "normal_user", label: "Normal user", helper: "Individual account monitoring", icon: User },
  { value: "general", label: "General topic", helper: "Broad keyword discovery", icon: Globe2 },
];

export const topicSubjectMeta: Record<TopicSubjectType, TopicSubjectOption> = Object.fromEntries(
  topicSubjectOptions.map((option) => [option.value, option]),
) as Record<TopicSubjectType, TopicSubjectOption>;

const topicSubjectValues = new Set<string>(topicSubjectOptions.map((option) => option.value));

export const isTopicSubjectType = (value: unknown): value is TopicSubjectType =>
  typeof value === "string" && topicSubjectValues.has(value);

export const topicSubjectFromTopic = (topic: Pick<Topic, "category" | "monitoringBrief">): TopicSubjectType => {
  const subjectType = topic.monitoringBrief?.subjectType ?? topic.category;
  return isTopicSubjectType(subjectType) ? subjectType : "general";
};