import type { Interface as ReadlineInterface } from "node:readline";
import type { ChatSession } from "./chat-session";
import { SessionManager } from "../utils/session-manager";
import {
  getGoalForSession,
  listLoopsForSession,
  listSchedulesForSession,
  removeLoop,
  removeSchedule,
  updateLoopLastRun,
  updateScheduleNextRun,
  type LoopRegistration,
  type ScheduleRegistration,
} from "../utils/autonomy-store";
import { getExtras, type SlashResult } from "./slash/shared-state";
import { style } from "../utils/visual-system";

import {
  slashExit,
  slashSave,
  slashRecap,
  slashStop,
  slashCheckpoint,
  slashRewind,
  slashFork,
} from "./slash/session-commands";
import {
  slashFile,
  slashImage,
  slashClear,
  slashStatus,
  slashManifest,
  slashScope,
  slashCodebase,
} from "./slash/context-commands";
import {
  slashModels,
  slashApi,
  slashMode,
  slashOutput,
  slashKeys,
  slashPermissions,
} from "./slash/config-commands";
import {
  slashLoop,
  slashGoal,
  slashSchedule,
  slashPlan,
  slashEffort,
  slashUsage,
} from "./slash/autonomy-commands";
import {
  slashTrust,
  slashVerify,
  slashDream,
  slashSubAgent,
  slashBatch,
  slashSimplify,
} from "./slash/tool-commands";
import {
  slashApply,
  slashRollback,
  slashReview,
  slashEditHistory,
  slashGitDiff,
} from "./slash/edit-commands";
import {
  slashDoctor,
  slashHeapdump,
  slashInsights,
  slashTeamOnboarding,
  slashMemory,
  slashTUI,
  slashUltraPlan,
  slashUltraReview,
  slashCustomCommand,
  ensureCustomCommandsLoaded,
  printExtendedHelp,
} from "./slash/debug-commands";
import {
  handleConversationsCommand,
  handleContextCommand,
  handleEstimateCommand,
  handleWorkspaceCommand,
} from "../utils/chat-commands";

export {
  getSessionExtras,
  setActiveDebateId,
  clearActiveDebateId,
} from "./slash/shared-state";
export type { SlashResult } from "./slash/shared-state";

const st = style();

export interface SlashDelegates {
  printHelp: () => void;
  printConversationHistory: (session: ChatSession) => void;
  handleSearchCommand: (query: string, sm: SessionManager) => void;
  handleSessionsListCommand: (sm: SessionManager) => void;
  handleRenameCommand: (
    args: string[],
    session: ChatSession,
    sm: SessionManager,
  ) => void;
  rerunLastDebateWithWorkspace?: () => Promise<void>;
}

export async function dispatchSlashCommand(
  cmd: string,
  args: string[],
  session: ChatSession,
  sessionManager: SessionManager,
  _rl: ReadlineInterface,
  delegates: SlashDelegates,
): Promise<SlashResult> {
  await ensureCustomCommandsLoaded(session);
  switch (cmd) {
    case "/exit":
      return slashExit(sessionManager, session);
    case "/help":
      delegates.printHelp();
      printExtendedHelp(session);
      return "continue";
    case "/file":
      return slashFile(args, session);
    case "/image":
      return slashImage(args, session);
    case "/clear":
      return slashClear(session);
    case "/status":
      return slashStatus(session);
    case "/manifest":
      return slashManifest(session);
    case "/models":
      return slashModels(args, session);
    case "/save":
      return slashSave(args, session, sessionManager);
    case "/api":
      return slashApi(args);
    case "/keys":
      return slashKeys(args);
    case "/track":
    case "/insights":
      return slashInsights();
    case "/team-onboarding":
      return slashTeamOnboarding(args);
    case "/memory":
      return slashMemory();
    case "/codebase":
      return slashCodebase(args);
    case "/permissions":
      return slashPermissions(args);
    case "/apply":
      return slashApply(session);
    case "/search": {
      const query = args.join(" ").trim();
      delegates.handleSearchCommand(query, sessionManager);
      return "continue";
    }
    case "/rename":
      delegates.handleRenameCommand(args, session, sessionManager);
      return "continue";
    case "/delete":
      return "delete-pending";
    case "/history":
      delegates.printConversationHistory(session);
      return "continue";
    case "/sessions":
      delegates.handleSessionsListCommand(sessionManager);
      return "continue";
    case "/conversations":
      handleConversationsCommand(sessionManager);
      return "continue";
    case "/context":
      handleContextCommand(session);
      return "continue";
    case "/mode":
      return slashMode(args, session);
    case "/estimate":
      handleEstimateCommand(session.mode, session.models.length);
      return "continue";
    case "/output":
      return slashOutput(args, session);
    case "/workspace":
      await handleWorkspaceCommand(process.cwd());
      return "continue";
    case "/rollback":
      return slashRollback(args);
    case "/review":
      return slashReview(args, session);
    case "/edits":
    case "/edit-history":
      return slashEditHistory();
    case "/gitdiff":
    case "/diff":
      return slashGitDiff();
    case "/scope":
      return slashScope();
    case "/new": {
      session.reset();
      console.log(st.success("Started a new conversation.\n"));
      return "continue";
    }
    case "/resume": {
      const targetId = args[0];
      if (!targetId) {
        console.log(st.warning("Usage: /resume <session-id>"));
        return "continue";
      }
      const loaded = sessionManager.loadSession(targetId);
      if (!loaded) {
        console.log(st.error(`Session "${targetId}" not found.`));
        return "continue";
      }
      session.debates = loaded.debates || [];
      session.id = loaded.id;
      session.name = loaded.name || "";
      console.log(st.success(`Resumed session: ${loaded.name || targetId}`));
      console.log(st.dim(`  ${session.debates.length} previous debate(s)\n`));
      return "continue";
    }
    case "/redo":
    case "/again": {
      const run = delegates.rerunLastDebateWithWorkspace;
      if (!run) {
        console.log(st.warning("Redo is not available in this context.\n"));
        return "continue";
      }
      await run();
      return "continue";
    }
    case "/checkpoint":
      return slashCheckpoint(args, session, sessionManager);
    case "/rewind":
      return slashRewind(args, session, sessionManager);
    case "/fork":
      return slashFork(args, session, sessionManager);
    case "/loop":
      return slashLoop(args, session);
    case "/goal":
      return slashGoal(args, session);
    case "/schedule":
      return slashSchedule(args, session);
    case "/plan":
      return slashPlan();
    case "/effort":
      return slashEffort(args, session);
    case "/usage":
      return slashUsage(session);
    case "/tui":
      return slashTUI();
    case "/recap":
      return slashRecap(session);
    case "/stop":
      return slashStop(session);
    case "/doctor":
      return slashDoctor();
    case "/heapdump":
      return slashHeapdump();
    case "/ultraplan":
      return slashUltraPlan(args);
    case "/ultrareview":
      return slashUltraReview(args);
    case "/sub-agent":
    case "/sub-agents":
      return slashSubAgent(args);
    case "/batch":
      return slashBatch(args);
    case "/simplify":
      return slashSimplify();
    case "/trust":
      return slashTrust(args);
    case "/verify":
      return slashVerify(args);
    case "/dream":
    case "/imagine":
      return slashDream(args);
    default: {
      const name = cmd.startsWith("/") ? cmd.slice(1) : cmd;
      const extras = getExtras(session);
      if (extras.customCommands.has(name)) {
        const outcome = await slashCustomCommand(name, args, session);
        if (outcome.prompt) {
          try {
            await session.debate(outcome.prompt);
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.log(st.error(`Custom command debate failed: ${msg}\n`));
          }
        }
        return outcome.result;
      }
      console.log(
        st.warning(`Unknown command: ${cmd}. Use /help for commands.`),
      );
      return "continue";
    }
  }
}

function rehydrateLoop(session: ChatSession, reg: LoopRegistration): void {
  const extras = getExtras(session);
  if (extras.loops.has(reg.id)) return;
  const timer = setInterval(() => {
    console.log(
      st.dim(`\n[loop ${reg.id}] tick - prompt queued: ${reg.prompt}\n`),
    );
    try {
      updateLoopLastRun(reg.sessionId, reg.id, Date.now());
    } catch {
      // best-effort
    }
  }, reg.intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  extras.loops.set(reg.id, {
    id: reg.id,
    intervalMs: reg.intervalMs,
    prompt: reg.prompt,
    timer,
  });
}

function rehydrateSchedule(
  session: ChatSession,
  reg: ScheduleRegistration,
): void {
  const extras = getExtras(session);
  if (extras.schedules.has(reg.id)) return;
  const tick = (): void => {
    console.log(
      st.dim(`\n[schedule ${reg.id}] tick - prompt queued: ${reg.prompt}\n`),
    );
    try {
      updateScheduleNextRun(
        reg.sessionId,
        reg.id,
        Date.now() + reg.intervalMs,
        Date.now(),
      );
    } catch {
      // best-effort
    }
  };
  const now = Date.now();
  const due = Math.max(0, reg.nextRunAt - now);
  if (due === 0) {
    tick();
  }
  const timer = setInterval(tick, reg.intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  extras.schedules.set(reg.id, {
    id: reg.id,
    prompt: reg.prompt,
    spec: reg.spec,
    intervalMs: reg.intervalMs,
    timer,
  });
}

export function replayAutonomy(session: ChatSession): {
  loops: number;
  schedules: number;
  goal: boolean;
} {
  const sessionId = session.id ?? "__pending__";
  const extras = getExtras(session);
  let loops = 0;
  let schedules = 0;
  let goalLoaded = false;

  try {
    const persistedLoops = listLoopsForSession(sessionId);
    for (const reg of persistedLoops) {
      rehydrateLoop(session, reg);
      loops += 1;
    }
  } catch {
    // ignore corrupt persistence; CLI keeps running
  }

  try {
    const persistedSchedules = listSchedulesForSession(sessionId);
    for (const reg of persistedSchedules) {
      rehydrateSchedule(session, reg);
      schedules += 1;
    }
  } catch {
    // ignore corrupt persistence
  }

  try {
    const goal = getGoalForSession(sessionId);
    if (goal?.text) {
      extras.goal = goal.text;
      goalLoaded = true;
    }
  } catch {
    // ignore
  }

  return { loops, schedules, goal: goalLoaded };
}

export function clearAutonomyLoop(session: ChatSession, id: string): boolean {
  const sessionId = session.id ?? "__pending__";
  const extras = getExtras(session);
  const handle = extras.loops.get(id);
  if (handle) {
    clearInterval(handle.timer);
    extras.loops.delete(id);
  }
  try {
    removeLoop(sessionId, id);
  } catch {
    // ignore
  }
  return handle !== undefined;
}

export function clearAutonomySchedule(
  session: ChatSession,
  id: string,
): boolean {
  const sessionId = session.id ?? "__pending__";
  const extras = getExtras(session);
  const handle = extras.schedules.get(id);
  if (handle) {
    clearInterval(handle.timer);
    extras.schedules.delete(id);
  }
  try {
    removeSchedule(sessionId, id);
  } catch {
    // ignore
  }
  return handle !== undefined;
}
