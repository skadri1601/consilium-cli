import { randomUUID } from "node:crypto";
import { style } from "./visual-system";

export type TodoStatus = "pending" | "in_progress" | "completed" | "failed";

export type Todo = {
  id: string;
  text: string;
  status: TodoStatus;
  updatedAt: number;
};

export type TodoTheme = {
  dim: (s: string) => string;
  success: (s: string) => string;
  warning: (s: string) => string;
};

const STATUS_ORDER: Record<TodoStatus, number> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
  failed: 3,
};

const MARKER: Record<TodoStatus, string> = {
  pending: "[ ]",
  in_progress: "[~]",
  completed: "[x]",
  failed: "[!]",
};

export class TodoTracker {
  private items: Todo[] = [];

  add(text: string): Todo {
    const todo: Todo = {
      id: randomUUID(),
      text: text.trim(),
      status: "pending",
      updatedAt: Date.now(),
    };
    this.items.push(todo);
    return { ...todo };
  }

  update(id: string, status: TodoStatus): void {
    const item = this.items.find((t) => t.id === id);
    if (!item) return;
    item.status = status;
    item.updatedAt = Date.now();
  }

  remove(id: string): void {
    this.items = this.items.filter((t) => t.id !== id);
  }

  list(): Todo[] {
    return this.items.map((t) => ({ ...t }));
  }

  clear(): void {
    this.items = [];
  }

  render(theme?: TodoTheme): string {
    if (this.items.length === 0) {
      const t = theme ?? defaultTheme();
      return t.dim("No TODOs.");
    }

    const t = theme ?? defaultTheme();
    const sorted = [...this.items].sort((a, b) => {
      const ord = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (ord !== 0) return ord;
      return a.updatedAt - b.updatedAt;
    });

    const maxTextLen = sorted.reduce(
      (acc, item) => Math.max(acc, item.text.length),
      0,
    );

    const lines = sorted.map((item) => {
      const padded = item.text.padEnd(maxTextLen, " ");
      switch (item.status) {
        case "completed":
          return `  ${t.success(MARKER.completed)} ${t.dim(padded)}`;
        case "in_progress":
          return `  ${t.warning(MARKER.in_progress)} ${padded}`;
        case "failed":
          return `  ${t.warning(MARKER.failed)} ${padded}`;
        case "pending":
        default:
          return `  ${t.dim(MARKER.pending)} ${padded}`;
      }
    });

    return lines.join("\n");
  }
}

function defaultTheme(): TodoTheme {
  const s = style();
  return {
    dim: s.dim,
    success: s.success,
    warning: s.warning,
  };
}

export const globalTodos: TodoTracker = new TodoTracker();
