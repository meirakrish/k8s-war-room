export const TASK_STATUSES = ["open", "claimed", "done", "failed"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const POST_KINDS = ["finding", "hypothesis", "question", "decision"] as const;
export type PostKind = (typeof POST_KINDS)[number];

/** Anything JSON can carry. Task input/result and post evidence are free-form, stored as JSON text. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface Task {
  id: number;
  type: string;
  status: TaskStatus;
  claimedBy: string | null;
  parentId: number | null;
  input: Json;
  result: Json;
  createdAt: string;
  updatedAt: string;
}

export interface Post {
  id: number;
  taskId: number;
  agent: string;
  kind: PostKind;
  content: string;
  evidence: Json;
  createdAt: string;
}

export interface BoardEvent {
  id: number;
  ts: string;
  actor: string;
  type: "task_created" | "task_claimed" | "task_completed" | "post_added";
  taskId: number | null;
  payload: Json;
}

export type ClaimResult = { claimed: true; task: Task } | { claimed: false; reason: string };
