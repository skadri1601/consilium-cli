import { beforeEach, describe, expect, it } from "vitest";
import { globalTodos, TodoTracker } from "./todo-tracker";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const plainTheme = {
  dim: (s: string) => s,
  success: (s: string) => s,
  warning: (s: string) => s,
};

describe("TodoTracker", () => {
  beforeEach(() => {
    globalTodos.clear();
  });

  it("add returns a todo with UUID id and pending status", () => {
    const tracker = new TodoTracker();
    const todo = tracker.add("Write tests");
    expect(todo.id).toMatch(UUID_RE);
    expect(todo.text).toBe("Write tests");
    expect(todo.status).toBe("pending");
    expect(todo.updatedAt).toBeTypeOf("number");
  });

  it("update changes the status of an existing todo", () => {
    const tracker = new TodoTracker();
    const todo = tracker.add("Implement feature");
    tracker.update(todo.id, "in_progress");
    expect(tracker.list()[0]?.status).toBe("in_progress");
    tracker.update(todo.id, "completed");
    expect(tracker.list()[0]?.status).toBe("completed");
  });

  it("update on an unknown id is a no-op", () => {
    const tracker = new TodoTracker();
    tracker.add("Real one");
    tracker.update("nonexistent-id", "failed");
    expect(tracker.list()[0]?.status).toBe("pending");
  });

  it("remove deletes a todo", () => {
    const tracker = new TodoTracker();
    const a = tracker.add("Keep me");
    const b = tracker.add("Remove me");
    tracker.remove(b.id);
    const list = tracker.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(a.id);
  });

  it("list returns all todos as defensive copies", () => {
    const tracker = new TodoTracker();
    tracker.add("One");
    tracker.add("Two");
    const list = tracker.list();
    list[0]!.text = "Mutated";
    expect(tracker.list()[0]?.text).toBe("One");
  });

  it("render produces empty message when no todos", () => {
    const tracker = new TodoTracker();
    expect(tracker.render(plainTheme).toLowerCase()).toContain("no todos");
  });

  it("render produces a checklist with status markers", () => {
    const tracker = new TodoTracker();
    const a = tracker.add("Alpha");
    const b = tracker.add("Beta");
    const c = tracker.add("Gamma");
    const d = tracker.add("Delta");
    tracker.update(a.id, "completed");
    tracker.update(b.id, "in_progress");
    tracker.update(d.id, "failed");
    void c;

    const out = tracker.render(plainTheme);
    expect(out).toContain("[ ]");
    expect(out).toContain("[~]");
    expect(out).toContain("[x]");
    expect(out).toContain("[!]");
    expect(out).toContain("Alpha");
    expect(out).toContain("Beta");
    expect(out).toContain("Gamma");
    expect(out).toContain("Delta");
  });

  it("render sorts by status (in_progress, pending, completed, failed)", async () => {
    const tracker = new TodoTracker();
    const done = tracker.add("Done task");
    tracker.update(done.id, "completed");
    await new Promise((r) => setTimeout(r, 2));
    const pending = tracker.add("Pending task");
    await new Promise((r) => setTimeout(r, 2));
    const active = tracker.add("Active task");
    tracker.update(active.id, "in_progress");

    const out = tracker.render(plainTheme);
    const activeIdx = out.indexOf("Active task");
    const pendingIdx = out.indexOf("Pending task");
    const doneIdx = out.indexOf("Done task");
    expect(activeIdx).toBeGreaterThan(-1);
    expect(activeIdx).toBeLessThan(pendingIdx);
    expect(pendingIdx).toBeLessThan(doneIdx);
  });

  it("render pads text so columns line up", () => {
    const tracker = new TodoTracker();
    tracker.add("Short");
    tracker.add("A much longer todo entry");
    const out = tracker.render(plainTheme);
    const lines = out.split("\n");
    expect(lines[0]).toContain("Short");
    expect(lines[0]!.length).toBe(lines[1]!.length);
  });

  it("clear empties the tracker", () => {
    const tracker = new TodoTracker();
    tracker.add("One");
    tracker.add("Two");
    tracker.clear();
    expect(tracker.list()).toEqual([]);
  });

  it("globalTodos is a singleton TodoTracker instance", () => {
    globalTodos.add("Persisted");
    expect(globalTodos.list()).toHaveLength(1);
    globalTodos.clear();
    expect(globalTodos.list()).toEqual([]);
  });
});
