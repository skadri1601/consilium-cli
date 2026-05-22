import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  HOOK_EVENTS,
  type HookConfig,
  type HookEntry,
  type HookEvent,
} from "./types";

const CONFIG_DIR = path.join(os.homedir(), ".consilium");
const HOOKS_FILE = path.join(CONFIG_DIR, "hooks.json");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export function getHooksConfigPath(): string {
  return HOOKS_FILE;
}

export function getConsiliumConfigPath(): string {
  return CONFIG_FILE;
}

const matcherSchema = z
  .object({
    tool: z.string().optional(),
    promptPattern: z.string().optional(),
  })
  .strict();

const commandEntrySchema = z
  .object({
    type: z.literal("command"),
    command: z.string().min(1),
    matcher: matcherSchema.optional(),
    timeoutMs: z.number().positive().optional(),
  })
  .strict();

const httpEntrySchema = z
  .object({
    type: z.literal("http"),
    url: z.string().url(),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
    matcher: matcherSchema.optional(),
    timeoutMs: z.number().positive().optional(),
  })
  .strict();

const entrySchema = z.discriminatedUnion("type", [
  commandEntrySchema,
  httpEntrySchema,
]);

const eventEnum = z.enum(HOOK_EVENTS as readonly [HookEvent, ...HookEvent[]]);

const hookConfigSchema = z
  .object({
    hooks: z.record(eventEnum, z.array(entrySchema)).optional(),
  })
  .strict();

const consiliumConfigSchema = z
  .object({
    hooksEnabled: z.boolean().optional(),
    allowedHookUrls: z.array(z.string().url()).optional(),
  })
  .passthrough();

export interface ConsiliumHookSettings {
  hooksEnabled: boolean;
  allowedHookUrls: string[];
}

export function loadConsiliumSettings(
  configPath: string = CONFIG_FILE,
): ConsiliumHookSettings {
  if (!fs.existsSync(configPath)) {
    return { hooksEnabled: false, allowedHookUrls: [] };
  }
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const json: unknown = JSON.parse(raw);
    const parsed = consiliumConfigSchema.safeParse(json);
    if (!parsed.success) {
      return { hooksEnabled: false, allowedHookUrls: [] };
    }
    return {
      hooksEnabled: parsed.data.hooksEnabled ?? false,
      allowedHookUrls: parsed.data.allowedHookUrls ?? [],
    };
  } catch {
    return { hooksEnabled: false, allowedHookUrls: [] };
  }
}

export function loadHooks(hooksPath: string = HOOKS_FILE): HookConfig {
  if (!fs.existsSync(hooksPath)) {
    return { hooks: {} };
  }
  let raw: string;
  try {
    raw = fs.readFileSync(hooksPath, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[consilium hooks] failed to read ${hooksPath}: ${message}`);
    return { hooks: {} };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[consilium hooks] failed to parse ${hooksPath}: ${message}`);
    return { hooks: {} };
  }
  const result = hookConfigSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    console.warn(`[consilium hooks] invalid ${hooksPath}: ${issues}`);
    return { hooks: {} };
  }
  return {
    hooks: (result.data.hooks ?? {}) as Partial<Record<HookEvent, HookEntry[]>>,
  };
}

export function getEntriesForEvent(
  config: HookConfig,
  event: HookEvent,
): HookEntry[] {
  return config.hooks[event] ?? [];
}
