import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearGoal,
  getGoalForSession,
  listLoopsForSession,
  listSchedulesForSession,
  persistGoal,
  persistLoop,
  persistSchedule,
  removeLoop,
  removeSchedule,
  updateLoopLastRun,
  updateScheduleNextRun,
  type LoopRegistration,
  type ScheduleRegistration,
} from "./autonomy-store";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "consilium-autonomy-"));
});

afterEach(() => {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function makeLoop(overrides: Partial<LoopRegistration> = {}): LoopRegistration {
  return {
    id: "loop_1",
    sessionId: "ses_a",
    intervalMs: 60_000,
    prompt: "check status",
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

function makeSchedule(
  overrides: Partial<ScheduleRegistration> = {},
): ScheduleRegistration {
  return {
    id: "sched_1",
    sessionId: "ses_a",
    spec: "5m",
    intervalMs: 300_000,
    nextRunAt: 1_700_000_300_000,
    prompt: "digest",
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("loop persistence", () => {
  it("persist + list round-trips a loop", () => {
    const reg = makeLoop();
    persistLoop(reg, tmpDir);
    const loaded = listLoopsForSession("ses_a", tmpDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.id).toBe("loop_1");
    expect(loaded[0]?.prompt).toBe("check status");
  });

  it("persists multiple loops for one session", () => {
    persistLoop(makeLoop({ id: "l1" }), tmpDir);
    persistLoop(makeLoop({ id: "l2", prompt: "second" }), tmpDir);
    const loaded = listLoopsForSession("ses_a", tmpDir);
    expect(loaded).toHaveLength(2);
    const ids = loaded.map((r) => r.id).sort();
    expect(ids).toEqual(["l1", "l2"]);
  });

  it("updates an existing loop in place when id matches", () => {
    persistLoop(makeLoop({ id: "l1", prompt: "v1" }), tmpDir);
    persistLoop(makeLoop({ id: "l1", prompt: "v2" }), tmpDir);
    const loaded = listLoopsForSession("ses_a", tmpDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.prompt).toBe("v2");
  });

  it("removeLoop removes only the matching id", () => {
    persistLoop(makeLoop({ id: "l1" }), tmpDir);
    persistLoop(makeLoop({ id: "l2" }), tmpDir);
    removeLoop("ses_a", "l1", tmpDir);
    const loaded = listLoopsForSession("ses_a", tmpDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.id).toBe("l2");
  });

  it("removeLoop deletes the file when the last entry is removed", () => {
    persistLoop(makeLoop({ id: "only" }), tmpDir);
    removeLoop("ses_a", "only", tmpDir);
    expect(listLoopsForSession("ses_a", tmpDir)).toEqual([]);
  });

  it("returns [] for a session with no persisted loops", () => {
    expect(listLoopsForSession("ses_none", tmpDir)).toEqual([]);
  });

  it("updateLoopLastRun records lastRunAt timestamp", () => {
    persistLoop(makeLoop({ id: "l1" }), tmpDir);
    updateLoopLastRun("ses_a", "l1", 1_700_000_999_999, tmpDir);
    const loaded = listLoopsForSession("ses_a", tmpDir);
    expect(loaded[0]?.lastRunAt).toBe(1_700_000_999_999);
  });
});

describe("schedule persistence", () => {
  it("persist + list round-trips a schedule", () => {
    persistSchedule(makeSchedule(), tmpDir);
    const loaded = listSchedulesForSession("ses_a", tmpDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.spec).toBe("5m");
    expect(loaded[0]?.nextRunAt).toBe(1_700_000_300_000);
  });

  it("removeSchedule removes only matching id", () => {
    persistSchedule(makeSchedule({ id: "s1" }), tmpDir);
    persistSchedule(makeSchedule({ id: "s2" }), tmpDir);
    removeSchedule("ses_a", "s1", tmpDir);
    const loaded = listSchedulesForSession("ses_a", tmpDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.id).toBe("s2");
  });

  it("updateScheduleNextRun updates both timestamps", () => {
    persistSchedule(makeSchedule({ id: "s1" }), tmpDir);
    updateScheduleNextRun(
      "ses_a",
      "s1",
      1_700_001_000_000,
      1_700_000_500_000,
      tmpDir,
    );
    const loaded = listSchedulesForSession("ses_a", tmpDir);
    expect(loaded[0]?.nextRunAt).toBe(1_700_001_000_000);
    expect(loaded[0]?.lastRunAt).toBe(1_700_000_500_000);
  });
});

describe("goal persistence", () => {
  it("persist + get round-trips a goal", () => {
    persistGoal(
      { sessionId: "ses_a", text: "ship launch", setAt: 1_700_000_000_000 },
      tmpDir,
    );
    const loaded = getGoalForSession("ses_a", tmpDir);
    expect(loaded?.text).toBe("ship launch");
  });

  it("returns null when no goal is persisted", () => {
    expect(getGoalForSession("ses_none", tmpDir)).toBeNull();
  });

  it("clearGoal removes the goal", () => {
    persistGoal({ sessionId: "ses_a", text: "ship", setAt: 1 }, tmpDir);
    clearGoal("ses_a", tmpDir);
    expect(getGoalForSession("ses_a", tmpDir)).toBeNull();
  });

  it("clearGoal is a no-op when nothing is persisted", () => {
    expect(() => clearGoal("ses_none", tmpDir)).not.toThrow();
  });

  it("overwrites an existing goal when persistGoal is called again", () => {
    persistGoal({ sessionId: "ses_a", text: "first", setAt: 1 }, tmpDir);
    persistGoal({ sessionId: "ses_a", text: "second", setAt: 2 }, tmpDir);
    const loaded = getGoalForSession("ses_a", tmpDir);
    expect(loaded?.text).toBe("second");
    expect(loaded?.setAt).toBe(2);
  });
});

describe("session isolation", () => {
  it("loops in different sessions do not collide", () => {
    persistLoop(makeLoop({ id: "l1", sessionId: "ses_a" }), tmpDir);
    persistLoop(
      makeLoop({ id: "l1", sessionId: "ses_b", prompt: "b prompt" }),
      tmpDir,
    );
    const a = listLoopsForSession("ses_a", tmpDir);
    const b = listLoopsForSession("ses_b", tmpDir);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]?.prompt).toBe("check status");
    expect(b[0]?.prompt).toBe("b prompt");
  });

  it("schedules in different sessions do not collide", () => {
    persistSchedule(makeSchedule({ id: "s1", sessionId: "ses_a" }), tmpDir);
    persistSchedule(
      makeSchedule({
        id: "s1",
        sessionId: "ses_b",
        spec: "1h",
        intervalMs: 3_600_000,
      }),
      tmpDir,
    );
    expect(listSchedulesForSession("ses_a", tmpDir)[0]?.spec).toBe("5m");
    expect(listSchedulesForSession("ses_b", tmpDir)[0]?.spec).toBe("1h");
  });

  it("goals in different sessions do not collide", () => {
    persistGoal({ sessionId: "ses_a", text: "a-goal", setAt: 1 }, tmpDir);
    persistGoal({ sessionId: "ses_b", text: "b-goal", setAt: 2 }, tmpDir);
    expect(getGoalForSession("ses_a", tmpDir)?.text).toBe("a-goal");
    expect(getGoalForSession("ses_b", tmpDir)?.text).toBe("b-goal");
  });

  it("clearing one session's goal leaves another's intact", () => {
    persistGoal({ sessionId: "ses_a", text: "a-goal", setAt: 1 }, tmpDir);
    persistGoal({ sessionId: "ses_b", text: "b-goal", setAt: 2 }, tmpDir);
    clearGoal("ses_a", tmpDir);
    expect(getGoalForSession("ses_a", tmpDir)).toBeNull();
    expect(getGoalForSession("ses_b", tmpDir)?.text).toBe("b-goal");
  });
});
