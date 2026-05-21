# @myconsilium/cli

Command-line interface for Consilium -- a multi-model debate platform that lets you pit AI models against each other before writing code.

## Installation

### One-line installer (recommended)

```bash
curl -fsSL https://install.myconsilium.xyz | sh
```

Auto-detects pnpm / npm / yarn / bun if present, otherwise downloads a
standalone binary for your platform. Pass `--binary` to force the
binary path even when Node is installed.

### Homebrew (macOS / Linux)

```bash
brew tap skadri1601/tap
brew install consilium
```

### npm / pnpm / yarn / bun

```bash
npm  install -g @myconsilium/cli
pnpm add -g     @myconsilium/cli
yarn global add @myconsilium/cli
bun  add -g     @myconsilium/cli
```

### Self-update

```bash
consilium upgrade           # detect install method, upgrade to latest
consilium upgrade --check   # check only, don't install
```

## Requirements

- Standalone binary: no Node required
- Package-manager install: Node.js >= 20.0.0
- A Consilium account (free) or self-hosted backend

## Quick Start

```bash
# Interactive REPL session
consilium chat

# Start a debate
consilium debate "How should I implement auth?"

# Debate with options
consilium debate "Design API" --mode council -o output.md

# Resume a previous session
consilium sessions resume <id>
```

## Commands

| Command                                           | Alias | Description                               |
| ------------------------------------------------- | ----- | ----------------------------------------- |
| `consilium debate <topic>`                        | `ask` | Start a multi-model debate                |
| `consilium chat`                                  |       | Interactive REPL with session persistence |
| `consilium config set\|get\|list`                 |       | Configuration management                  |
| `consilium login`                                 |       | Web-based authentication (opens browser)  |
| `consilium debug <debateId>`                      |       | Full debate trace                         |
| `consilium logs <debateId>`                       |       | Query debate logs                         |
| `consilium stats`                                 |       | Model performance dashboard               |
| `consilium sessions list\|resume\|rename\|delete` |       | Manage saved sessions                     |

## Debate Options

| Flag                       | Description                                                      |
| -------------------------- | ---------------------------------------------------------------- |
| `-m, --models <models...>` | Select models for the debate                                     |
| `--output <format>`        | Output format: markdown, cursorrules, claude-md, json            |
| `--mode <mode>`            | Set debate mode (see below)                                      |
| `--file <paths...>`        | Attach files as context (e.g., `--file src/auth.ts diagram.png`) |
| `--git-diff`               | Include current git diff as context                              |
| `--ticket <id>`            | Include a Linear ticket as context (e.g., `MYC-123`)             |
| `--apply`                  | Apply structured edits from synthesis directly to files          |

## Debate Modes

| Mode      | Rounds | Cost   | Description                                     |
| --------- | ------ | ------ | ----------------------------------------------- |
| `quick`   | 1      | ~$0.01 | Single round, fastest results                   |
| `council` | 3      | ~$0.04 | Multi-round deliberation (default)              |
| `deep`    | 3      | ~$0.08 | Multi-round with sub-agent research             |
| `blind`   | 3      | ~$0.04 | Anonymous - models don't see each other's names |
| `redteam` | 4      | ~$0.10 | Adversarial testing, finds attack surfaces      |
| `jury`    | 3      | ~$0.05 | Panel with mandatory dissent tracking           |
| `market`  | 5      | ~$0.09 | Prediction-market style with confidence voting  |
| `auto`    | 3      | ~$0.04 | Auto-selects the best mode for your topic       |

```bash
consilium debate "Microservices vs monolith" --mode deep
consilium debate "Is this API secure?" --mode redteam
consilium debate "Which approach?" --mode auto
```

## Output Formats

| Format        | Use Case                 |
| ------------- | ------------------------ |
| `markdown`    | General documentation    |
| `cursorrules` | Cursor IDE rules file    |
| `claude-md`   | CLAUDE.md instructions   |
| `json`        | Programmatic consumption |
| `text`        | Plain text               |

```bash
consilium debate "Error handling strategy" --output cursorrules
```

## REPL Mode

Running `consilium chat` drops you into an interactive session with persistent history.

REPL commands:

- `/ask <topic>` -- Start a debate within the session
- `/help` -- List available commands
- `/exit` -- Save session and quit
- Up/Down arrows -- Navigate input history

## Codebase-Aware Debates

Consilium scans your project via ProjectContext and feeds relevant context into the debate. Three specialized agents -- architecture, structure, and config -- analyze your codebase so models understand your tech stack, directory layout, and existing patterns before responding.

## Context Support

Attach files or images to provide additional context:

```bash
consilium debate "Review this architecture" --file diagram.png
consilium debate "Refactor this module" --file src/auth.ts
consilium debate "Compare these implementations" --file old.ts new.ts
```

## Benchmarks

Run multi-model deliberation benchmarks against MMLU, TruthfulQA, or HumanEval:

```bash
# Run remotely via the Consilium API
consilium benchmark --benchmark mmlu -n 20

# Run locally via Python (requires apps/agents)
consilium benchmark --benchmark truthfulqa --local -n 10 --output results.json
```

| Flag                       | Description                                    |
| -------------------------- | ---------------------------------------------- |
| `--benchmark <name>`       | Required: `mmlu`, `truthfulqa`, or `humaneval` |
| `-m, --models <models...>` | Models to use as debaters                      |
| `--mode <mode>`            | Deliberation mode (default: council)           |
| `-n <count>`               | Number of questions to run                     |
| `--output <path>`          | Save JSON results to file                      |
| `--local`                  | Run via local Python agent instead of API      |

## Eval

Run a blind evaluation of multiple responses to the same question:

```bash
# Evaluate inline (models generate and judge their own responses)
consilium eval "Which sorting algorithm is best for nearly-sorted data?"

# Evaluate a pre-generated set of responses from a file
consilium eval "Which sorting algorithm?" --responses responses.json
```

The `--responses` file should be a JSON array: `[{"model": "gpt-5.4", "text": "..."}, ...]`

## Providers & Models

Consilium supports 7 LLM providers as of April 2026. Bring your own key for any provider - or run without keys and Consilium will fall back to a platform-hosted free-tier pool (Groq + OpenRouter) so you can keep working at zero cost.

| Provider       | Current production models                                                                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OpenAI**     | `gpt-5.5-pro`, `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano`                                                                                               |
| **Anthropic**  | `claude-opus-4-7`, `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`                                                                            |
| **Google**     | `gemini-3.1-pro-preview`, `gemini-3-flash-preview`, `gemini-3.1-flash-lite-preview`                                                                               |
| **Groq**       | `llama-3.1-8b-instant`, `llama-3.3-70b-versatile`, `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `groq/compound`, `groq/compound-mini`                             |
| **xAI**        | `grok-4-20`, `grok-4-1-fast-reasoning`, `grok-4-1-fast-non-reasoning`, `grok-code-fast-1`                                                                         |
| **Moonshot**   | `kimi-k2.6`, `kimi-k2.5`, `kimi-k2-thinking`, `kimi-k2-thinking-turbo`, `kimi-k2-turbo-preview`                                                                   |
| **OpenRouter** | `google/gemma-4-26b-a4b-it:free`, `google/gemma-4-31b-it:free`, `qwen/qwen3-coder:free`, `nvidia/nemotron-3-super-120b-a12b:free`, `inclusionai/ling-2.6-1t:free` |

Run `consilium models` for the live catalog with pricing and tier badges. Legacy IDs (e.g. `gpt-4o`, `claude-3-5-sonnet-latest`, `gemini-2.0-flash`) are forwarded to current replacements via aliases - but you should migrate your scripts.

## Configuration

Manage API keys and settings with BYOK (Bring Your Own Keys). Supported providers: OpenAI, Anthropic, Google, Groq, xAI, Moonshot, OpenRouter.

```bash
consilium config set openai_key sk-...
consilium config set anthropic_key sk-ant-...
consilium config set moonshot_key sk-...
consilium config set openrouter_key sk-or-...
consilium config list
```

Configuration is stored in `~/.consilium/config.json`. BYOK always wins over the free-tier pool. When a debate runs without a key for the requested provider, the CLI prints a pre-flight notice and the engine emits a `routing:fallback` SSE event so you always know when fallback is active.

Defaults target production (`https://api.myconsilium.xyz`, `https://myconsilium.xyz`). For a local Nest API, set:

```bash
export CONSILIUM_API_URL="http://localhost:4000"
```

## MCP (Cursor, Claude Code, etc.)

Run `consilium mcp` for a copy-paste stdio config. The Python module `consilium.mcp` calls the same Nest API as the CLI using `CONSILIUM_API_KEY` (your `consilium_` token) and `CONSILIUM_API_URL` (API origin, no `/api/v1` suffix). Install: `pip install -e packages/python-sdk` and optional `pip install 'consilium[mcp]'` for the official MCP stdio transport.

## Features

- **Real-time streaming** -- SSE streaming with progress bars and agent cards
- **Cost estimation** -- See estimated cost before a debate runs
- **Health check** -- Validates backend connectivity before operations
- **Decision tracking** -- Tracks decisions across conversations (decided/tentative/open/superseded)
- **Session persistence** -- Saved to `~/.consilium/sessions/`, resume with `consilium sessions resume <id>`

## Dependencies

commander ^12.1.0, chalk ^5, ora ^8, eventsource ^2, zod ^3, dotenv, open

## Links

- [Website](https://myconsilium.xyz)
- [Documentation](https://myconsilium.xyz/docs)
