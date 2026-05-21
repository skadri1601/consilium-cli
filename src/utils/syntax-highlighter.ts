import chalk from "chalk";
import { terminal } from "./terminal-capabilities";

const KEYWORDS_JS = new Set([
  "const",
  "let",
  "var",
  "function",
  "return",
  "if",
  "else",
  "for",
  "while",
  "class",
  "import",
  "export",
  "from",
  "async",
  "await",
  "new",
  "this",
  "typeof",
  "instanceof",
  "throw",
  "try",
  "catch",
  "finally",
  "switch",
  "case",
  "break",
  "continue",
  "default",
  "interface",
  "type",
  "enum",
]);

const BUILTINS_JS = new Set([
  "console",
  "require",
  "process",
  "module",
  "exports",
  "Promise",
  "Array",
  "Object",
  "Map",
  "Set",
]);

const KEYWORDS_PY = new Set([
  "def",
  "class",
  "return",
  "if",
  "elif",
  "else",
  "for",
  "while",
  "import",
  "from",
  "as",
  "with",
  "try",
  "except",
  "finally",
  "raise",
  "pass",
  "break",
  "continue",
  "yield",
  "lambda",
  "and",
  "or",
  "not",
  "in",
  "is",
  "True",
  "False",
  "None",
]);

const BUILTINS_PY = new Set([
  "print",
  "len",
  "range",
  "list",
  "dict",
  "set",
  "tuple",
  "str",
  "int",
  "float",
  "bool",
  "type",
  "isinstance",
  "super",
  "self",
]);

const KEYWORDS_BASH = new Set([
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "for",
  "while",
  "do",
  "done",
  "case",
  "esac",
  "function",
  "return",
  "exit",
  "echo",
  "export",
  "source",
  "local",
  "readonly",
  "declare",
]);

const purple = (s: string) => chalk.hex("#c678dd")(s);
const green = (s: string) => chalk.hex("#98c379")(s);
const orange = (s: string) => chalk.hex("#d19a66")(s);
const gray = (s: string) => chalk.hex("#5c6370")(s);
const yellow = (s: string) => chalk.hex("#e5c07b")(s);
const blue = (s: string) => chalk.hex("#61afef")(s);
const lightGray = (s: string) => chalk.hex("#abb2bf")(s);

type TokenRule = [RegExp, (m: string) => string];

function tokenize(code: string, rules: TokenRule[]): string {
  const combined = new RegExp(
    rules.map((r, i) => `(?<_t${i}>${r[0].source})`).join("|"),
    "gm",
  );
  return code.replace(combined, (...args) => {
    const groups = args.at(-1) as Record<string, string>;
    for (let i = 0; i < rules.length; i++) {
      const val = groups[`_t${i}`];
      const rule = rules[i];
      if (val !== undefined && rule) return rule[1](val);
    }
    return String(args[0]);
  });
}

function jsRules(): TokenRule[] {
  return [
    [/\/\/[^\n]*/, gray],
    [/\/\*[\s\S]*?\*\//, gray],
    [/"(?:[^"\\]|\\.)*"/, green],
    [/'(?:[^'\\]|\\.)*'/, green],
    [/`(?:[^`\\]|\\.)*`/, green],
    [/\b\d+(?:\.\d+)?\b/, orange],
    [/\b[A-Z]\w*\b/, (m) => yellow(m)],
    [
      /\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/,
      (m) => {
        if (KEYWORDS_JS.has(m)) return purple(m);
        if (BUILTINS_JS.has(m)) return yellow(m);
        return m;
      },
    ],
    [/[{}()[\];:.,]|=>|=/, lightGray],
  ];
}

function pyRules(): TokenRule[] {
  return [
    [/#[^\n]*/, gray],
    [/"""[\s\S]*?"""/, green],
    [/'''[\s\S]*?'''/, green],
    [/"(?:[^"\\]|\\.)*"/, green],
    [/'(?:[^'\\]|\\.)*'/, green],
    [/\b\d+(?:\.\d+)?\b/, orange],
    [/@\w+/, yellow],
    [
      /\b[a-zA-Z_]\w*\b/,
      (m) => {
        if (KEYWORDS_PY.has(m)) return purple(m);
        if (BUILTINS_PY.has(m)) return yellow(m);
        return m;
      },
    ],
  ];
}

function jsonRules(): TokenRule[] {
  return [
    [/"(?:[^"\\]|\\.)*"\s*(?=:)/, blue],
    [/"(?:[^"\\]|\\.)*"/, green],
    [/\b\d+(?:\.\d+)?\b/, orange],
    [/\b(?:true|false|null)\b/, purple],
  ];
}

function bashRules(): TokenRule[] {
  return [
    [/#[^\n]*/, gray],
    [/"(?:[^"\\]|\\.)*"/, green],
    [/'[^']*'/, green],
    [/\$\{[^}]+\}/, (m) => chalk.cyan(m)],
    [/\$[A-Za-z_]\w*/, (m) => chalk.cyan(m)],
    [/\b\d+(?:\.\d+)?\b/, orange],
    [/--?[a-zA-Z][\w-]*/, yellow],
    [
      /\b[a-zA-Z_]\w*\b/,
      (m) => {
        if (KEYWORDS_BASH.has(m)) return purple(m);
        return m;
      },
    ],
  ];
}

function defaultRules(): TokenRule[] {
  return [
    [/\/\/[^\n]*|#[^\n]*/, gray],
    [/"(?:[^"\\]|\\.)*"/, green],
    [/'(?:[^'\\]|\\.)*'/, green],
    [/\b\d+(?:\.\d+)?\b/, orange],
  ];
}

const LANG_MAP: Record<string, () => TokenRule[]> = {
  js: jsRules,
  javascript: jsRules,
  ts: jsRules,
  typescript: jsRules,
  jsx: jsRules,
  tsx: jsRules,
  py: pyRules,
  python: pyRules,
  json: jsonRules,
  bash: bashRules,
  sh: bashRules,
  shell: bashRules,
};

export function highlightCode(code: string, language?: string): string {
  if (!terminal.hasColor) return code;
  const lang = language?.toLowerCase() ?? "unknown";
  const rulesFn = LANG_MAP[lang] ?? defaultRules;
  return tokenize(code, rulesFn());
}

export function detectLanguage(code: string): string {
  const trimmed = code.trim();
  if (
    trimmed.startsWith("{") &&
    (trimmed.endsWith("}") || trimmed.endsWith("]"))
  ) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      /* not json */
    }
  }
  if (trimmed.startsWith("#!/bin/bash") || trimmed.startsWith("#!/bin/sh"))
    return "bash";
  if (/^\$\s/.test(trimmed)) return "bash";
  if (
    /\bdef\s+\w+\s*\(/.test(trimmed) ||
    (/\bimport\s+/.test(trimmed) && !trimmed.includes(";"))
  )
    return "python";
  if (/\b(function|const|let|var)\b/.test(trimmed) || /=>/.test(trimmed))
    return "javascript";
  return "unknown";
}

export function formatCodeBlock(code: string, language?: string): string {
  const lang = language || detectLanguage(code);
  const highlighted = highlightCode(code, lang);
  const label = lang === "unknown" ? "" : gray(` ${lang} `);
  const border = terminal.hasColor ? chalk.hex("#5c6370")("│") : "|";
  const lines = highlighted.split("\n").map((line) => `  ${border} ${line}`);
  if (label) lines.unshift(`  ${label}`);
  return lines.join("\n");
}
