import crypto from "node:crypto";

export type EntityType =
  | "debate"
  | "round"
  | "message"
  | "agent"
  | "sub-agent"
  | "conversation"
  | "tool-call"
  | "worker-job"
  | "log-entry"
  | "session";

export const PREFIXES: Record<EntityType, string> = {
  debate: "dbt",
  round: "rnd",
  message: "msg",
  agent: "agt",
  "sub-agent": "sag",
  conversation: "cnv",
  "tool-call": "tcl",
  "worker-job": "job",
  "log-entry": "log",
  session: "ses",
};

const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const CROCKFORD_DECODE: Record<string, number> = {};
{
  let idx = 0;
  for (const ch of CROCKFORD_BASE32) {
    CROCKFORD_DECODE[ch] = idx;
    idx += 1;
  }
}

function encodeTime(timestamp: number): string {
  let t = timestamp;
  const chars: string[] = new Array(10);
  for (let i = 9; i >= 0; i--) {
    chars[i] = CROCKFORD_BASE32.charAt(t & 0x1f);
    t = Math.floor(t / 32);
  }
  return chars.join("");
}

function decodeTime(encoded: string): number {
  let t = 0;
  for (let i = 0; i < 10; i++) {
    const unit = encoded.charAt(i);
    t = t * 32 + (CROCKFORD_DECODE[unit] ?? 0);
  }
  return t;
}

function encodeRandom(): string {
  const bytes = crypto.randomBytes(10);
  const chars: string[] = new Array(16);
  let bitBuffer = 0;
  let bitsInBuffer = 0;
  let charIdx = 0;
  for (let i = 0; i < bytes.length && charIdx < 16; i++) {
    const b = bytes[i];
    if (b === undefined) break;
    bitBuffer = (bitBuffer << 8) | b;
    bitsInBuffer += 8;
    while (bitsInBuffer >= 5 && charIdx < 16) {
      bitsInBuffer -= 5;
      const idx = (bitBuffer >> bitsInBuffer) & 0x1f;
      const ch = CROCKFORD_BASE32.charAt(idx);
      chars[charIdx] = ch;
      charIdx += 1;
    }
  }
  return chars.join("");
}

const PREFIX_TO_ENTITY: Record<string, EntityType> = {};
for (const [entity, prefix] of Object.entries(PREFIXES)) {
  PREFIX_TO_ENTITY[prefix] = entity as EntityType;
}

const VALID_CHAR_SET = new Set(CROCKFORD_BASE32.split(""));

export function generateId(entity: EntityType): string {
  const prefix = PREFIXES[entity];
  const timePart = encodeTime(Date.now());
  const randomPart = encodeRandom();
  return `${prefix}_${timePart}${randomPart}`;
}

export function parseId(
  id: string,
): { entity: EntityType; timestamp: Date; raw: string } | null {
  const sepIdx = id.indexOf("_");
  if (sepIdx === -1) return null;

  const prefix = id.substring(0, sepIdx);
  const raw = id.substring(sepIdx + 1);

  if (raw.length !== 26) return null;

  const entity = PREFIX_TO_ENTITY[prefix];
  if (!entity) return null;

  for (const ch of raw) {
    if (!VALID_CHAR_SET.has(ch)) return null;
  }

  const timestamp = new Date(decodeTime(raw));
  return { entity, timestamp, raw };
}

export function isValidId(id: string, entity?: EntityType): boolean {
  const parsed = parseId(id);
  if (!parsed) return false;
  if (entity && parsed.entity !== entity) return false;
  return true;
}
