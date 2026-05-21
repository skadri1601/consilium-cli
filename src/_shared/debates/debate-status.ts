export type DebateStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "deleted"
  | "cancelled"
  | "archived";

export const DEBATE_STATUSES: DebateStatus[] = [
  "pending",
  "processing",
  "completed",
  "failed",
  "deleted",
  "cancelled",
  "archived",
];
