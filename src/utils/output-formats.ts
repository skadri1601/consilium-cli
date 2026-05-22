import fs from "node:fs";

export type OutputFormat = "text" | "json" | "stream-json";

export interface StreamEventEnvelope {
  type: string;
  data: unknown;
  ts: number;
}

export interface SchemaValidationResult {
  ok: boolean;
  errors?: string[];
}

export function isHeadlessFormat(fmt: OutputFormat | string): boolean {
  return fmt === "json" || fmt === "stream-json";
}

export function isValidOutputFormatFlag(value: string): value is OutputFormat {
  return value === "text" || value === "json" || value === "stream-json";
}

export function emitStreamEvent(event: StreamEventEnvelope): void {
  process.stdout.write(JSON.stringify(event) + "\n");
}

export function emitFinalJson(payload: unknown): void {
  process.stdout.write(JSON.stringify(payload) + "\n");
}

interface SchemaNode {
  type?: string | string[];
  properties?: Record<string, SchemaNode>;
  required?: string[];
  items?: SchemaNode;
  enum?: unknown[];
  additionalProperties?: boolean | SchemaNode;
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function typeMatches(declared: string | string[], actual: string): boolean {
  const list = Array.isArray(declared) ? declared : [declared];
  if (list.includes(actual)) return true;
  if (actual === "number" && list.includes("integer")) {
    return true;
  }
  return false;
}

function validateNode(
  value: unknown,
  schema: SchemaNode,
  path: string,
  errors: string[],
): void {
  if (schema.type !== undefined) {
    const actual = typeOf(value);
    if (!typeMatches(schema.type, actual)) {
      const want = Array.isArray(schema.type)
        ? schema.type.join("|")
        : schema.type;
      errors.push(`${path || "<root>"}: expected ${want}, got ${actual}`);
      return;
    }
    if (
      (schema.type === "integer" ||
        (Array.isArray(schema.type) && schema.type.includes("integer"))) &&
      typeof value === "number" &&
      !Number.isInteger(value)
    ) {
      errors.push(`${path || "<root>"}: expected integer, got float`);
      return;
    }
  }

  if (Array.isArray(schema.enum)) {
    const matched = schema.enum.some((e) => e === value);
    if (!matched) {
      errors.push(
        `${path || "<root>"}: value not in enum (${JSON.stringify(schema.enum)})`,
      );
    }
  }

  if (
    schema.type === "object" ||
    (Array.isArray(schema.type) && schema.type.includes("object")) ||
    schema.properties !== undefined ||
    schema.required !== undefined
  ) {
    if (typeOf(value) !== "object") return;
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in obj)) {
        errors.push(`${path || "<root>"}: missing required property "${key}"`);
      }
    }
    if (schema.properties) {
      for (const [key, sub] of Object.entries(schema.properties)) {
        if (key in obj) {
          const nextPath = path ? `${path}.${key}` : key;
          validateNode(obj[key], sub, nextPath, errors);
        }
      }
    }
    if (schema.additionalProperties === false && schema.properties) {
      const allowed = new Set(Object.keys(schema.properties));
      for (const key of Object.keys(obj)) {
        if (!allowed.has(key)) {
          errors.push(`${path || "<root>"}: unexpected property "${key}"`);
        }
      }
    }
  }

  if (
    schema.type === "array" ||
    (Array.isArray(schema.type) && schema.type.includes("array"))
  ) {
    if (!Array.isArray(value)) return;
    if (schema.items) {
      value.forEach((item, idx) => {
        validateNode(
          item,
          schema.items as SchemaNode,
          `${path}[${idx}]`,
          errors,
        );
      });
    }
  }
}

export function validateAgainstSchema(
  payload: unknown,
  schemaPath: string,
): SchemaValidationResult {
  let schemaSource: string;
  try {
    schemaSource = fs.readFileSync(schemaPath, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      errors: [`failed to read schema "${schemaPath}": ${msg}`],
    };
  }

  let schema: SchemaNode;
  try {
    schema = JSON.parse(schemaSource) as SchemaNode;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, errors: [`failed to parse schema JSON: ${msg}`] };
  }

  const errors: string[] = [];
  validateNode(payload, schema, "", errors);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
