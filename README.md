# opencode-vision

[![npm version](https://img.shields.io/npm/v/@venespana/opencode-vision)](https://www.npmjs.com/package/@venespana/opencode-vision)
[![CI](https://github.com/venespana/opencode-vision/actions/workflows/ci.yml/badge.svg)](https://github.com/venespana/opencode-vision/actions/workflows/ci.yml)
[![Release](https://github.com/venespana/opencode-vision/actions/workflows/release.yml/badge.svg)](https://github.com/venespana/opencode-vision/actions/workflows/release.yml)
[![Coverage](https://codecov.io/gh/venespana/opencode-vision/branch/main/graph/badge.svg)](https://codecov.io/gh/venespana/opencode-vision)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](./LICENSE)

Give text-only (non-vision) OpenCode models the ability to see images.

`opencode-vision` is an OpenCode plugin that intercepts images pasted into chat, routes them through a configurable vision backend (an MCP server or a local CLI), and injects the resulting text description back into the conversation — so models without native vision can still reason about images.

The plugin ships **no vision capability of its own**. It is a bridge: you provide the backend, it provides the wiring.

---

## How it works

```
You paste an image into chat (using a text-only model)
        |
        v
 experimental.chat.messages.transform   <-- plugin hook fires
        |
        v
 shouldActivate?  ---- no (vision model / denylist) ----> message passes through unchanged
        | yes
        v
 image is materialized to disk (tempDir/vision-<sha256>.<ext>)
        |
        v
 route to the configured backend
        |                                   |
        v                                   v
  backend.type: "mcp"                  backend.type: "cli"
  inject-instructions:                 plugin spawns the command,
  tell the MODEL to call               captures stdout, and injects
  the MCP tool itself                  it as the description
        |                                   |
        +-----------------+-----------------+
                          v
   image FileParts are removed; the text is injected back into chat
```

Two injection modes exist (chosen automatically by backend type):

- **`inject-instructions`** (MCP backend): the plugin rewrites the message to instruct the model to call the MCP tool itself. The tool runs as a normal tool call.
- **`inject-description`** (CLI backend): the plugin runs the CLI directly and injects the captured stdout as plain text.

---

## Requirements

- **Node.js >= 18** (uses `AbortSignal.timeout` and other modern APIs).
- An **OpenCode** installation with the `experimental.chat.messages.transform` hook available.
- **At least one vision backend**, installed and working on its own. The plugin does not bundle vision. Choose one:
  - **MCP server** — [`openrouter-image-mcp`](https://github.com/JonathanJude/openrouter-image-mcp), or
  - **CLI** — the MiniMax CLI [`mmx`](https://github.com/MiniMax-AI/cli).

> OpenCode plugin SDK is a peer dependency: `@opencode-ai/plugin` `>=1.0.0` (developed against `^1.18.0`).

---

## Quick start

### 1. Build the plugin

```bash
git clone <this-repo> opencode-vision
cd opencode-vision
pnpm install
pnpm build      # emits dist/index.js (the plugin entry point)
```

Useful scripts:

| Script | Purpose |
| --- | --- |
| `pnpm build` | Compile TypeScript to `dist/` (`tsc`). |
| `pnpm test` | Run the test suite (`vitest run`). |
| `pnpm typecheck` | Type-check without emitting (`tsc --noEmit`). |
| `pnpm lint` | Lint with ESLint. |
| `pnpm format` | Check formatting with Prettier. |

### 2. Register the plugin in OpenCode

Add it to the `plugin` array in your `opencode.json`. The local-path form (after `npm run build`):

```jsonc
{
  "plugin": [
    ["opencode-vision", {}]
  ]
}
```

OpenCode resolves a bare name `"opencode-vision"` to the local `dist/index.js` when developing from the repo. To point at an explicit path, use the path form:

```jsonc
{
  "plugin": [
    ["/absolute/path/to/opencode-vision", {}]
  ]
}
```

The second element of the tuple is the **inline plugin options** object (see [Configuration](#configuration)). Once published to npm, the bare name form (`["opencode-vision", { ... }]`) will resolve from the registry.

### 3. Configure a backend

Jump to [Backend setup](#backend-setup) for a complete walkthrough of either the MCP or CLI backend.

---

## Configuration

Configuration can live in **two places**, and both fully support **JSONC** (comments allowed).

### Option A — Inline in `opencode.json`

Pass options as the second element of the plugin tuple:

```jsonc
{
  "plugin": [
    [
      "opencode-vision",
      {
        "backend": { "type": "mcp", "mcp": { "tool": "openrouter_image_analyze_image" } }
      }
    ]
  ]
}
```

### Option B — Standalone config files

| Scope | Path | Purpose |
| --- | --- | --- |
| Project | `.opencode/opencode-vision.jsonc` (or `.json`) | Shared with the repo / team. |
| User | `~/.config/opencode/opencode-vision.jsonc` (or `.json`) | Personal defaults across all projects. |

`.jsonc` is read before `.json` in each directory. Comments are stripped before parsing.

### Precedence (highest to lowest, first match wins per field)

1. **Inline options** — the tuple options in `opencode.json`.
2. **Project file** — `.opencode/opencode-vision.{jsonc,json}`.
3. **User file** — `~/.config/opencode/opencode-vision.{jsonc,json}`.
4. **Built-in defaults** — from the Zod schema (see table below).

Merging is **field-by-field, first-defined-wins**, and nested objects are merged recursively. So you can set a base in your user file and override only the fields you need per project.

---

## Full config reference

All fields, types, and defaults below come straight from the Zod schema in `src/types.ts`.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `models` | `string[]` | `[]` | Force-on allowlist. Glob patterns like `providerID/modelID` or `providerID/*`. Always activates bridging, overriding auto-detect. |
| `denylist` | `string[]` | `[]` | Force-off patterns. **Takes precedence over `models`.** |
| `detection` | `"auto" \| "patterns" \| "hybrid"` | `"hybrid"` | How activation is decided. See [Model detection](#model-detection). |
| `backend` | object | `{ "type": "mcp", "mcp": { "tool": "default" } }` | Backend config, discriminated by `backend.type`. |
| `backend.type` | `"mcp" \| "cli"` | `"mcp"` | Backend kind. **`"tool"` is not supported in v1** (rejected at parse time). |
| `backend.mcp.tool` | `string` | `"default"` (non-functional) | MCP tool id the plugin tells the model to call. **You must set this to a real tool id.** |
| `backend.mcp.prompt` | `string` | _(none)_ | Extra context appended to the injected instruction. |
| `backend.mcp.format` | `"text" \| "json"` | _(none)_ | Requested output format hint. |
| `backend.mcp.maxTokens` | `integer > 0` | _(none)_ | Max-tokens hint. |
| `backend.cli.command` | `string` | _(required when `type:"cli"`)_ | CLI executable to run. |
| `backend.cli.args` | `string[]` | `[]` | Base args; image paths/URLs are appended after these. |
| `backend.cli.promptFlag` | `string` | _(none)_ | If set, the rendered prompt is passed as `<flag> <prompt>`. |
| `backend.cli.jsonFlag` | `string` | _(none)_ | If set, this flag is added to request JSON output. |
| `backend.cli.imageFlag` | `string` | _(none)_ | If set, each image is passed as `<imageFlag> <ref>` instead of a positional trailing arg. Required for CLIs like `mmx` that need `--image`. |
| `backend.cli.env` | `Record<string, string>` | _(none)_ | Extra env vars for the subprocess, merged on top of `process.env`. |
| `backend.cli.timeoutMs` | `integer > 0` | `30000` | Spawn timeout via `AbortSignal.timeout`. |
| `promptTemplate` | `string` | `""` → built-in max-detail template | Template with `{imageCount}` and `{userText}` placeholders. See [The default prompt](#the-default-prompt). |
| `tempDir` | `string` | `${TMPDIR || /tmp}/opencode-vision` | Directory for temporary image files materialized from base64 pastes. |
| `cleanupAfterHours` | `integer >= 0` | `24` | Age threshold (hours) for the TTL sweep. `0` disables TTL deletion. |
| `cleanup` | `"init" \| "never"` | `"init"` | Whether to run the TTL sweep at plugin init. `"never"` disables auto-cleanup entirely. |

> **CLI config lives under `backend.cli`.** When `backend.type` is `"cli"`, put `command`, `args`, etc. inside `backend.cli`.

---

## Backend setup

Pick **one** backend. The plugin's behavior differs by type (see [How it works](#how-it-works)).

### Backend A — MCP server (`openrouter-image-mcp`)

In this mode the plugin does **not** call the tool itself. It rewrites the message (`inject-instructions`) to tell the **model** to call the MCP tool, passing the image path/URL and the user's request. The tool then runs as a normal OpenCode tool call.

**Setup:**

1. Install and configure the [`openrouter-image-mcp`](https://github.com/JonathanJude/openrouter-image-mcp) MCP server in OpenCode (see that project's README). Confirm it appears in your MCP servers and note its key.
2. Find the **actual tool id** OpenCode exposes for it. OpenCode names MCP tools as `<serverKey>_<toolName>`; for a server key `openrouter_image` exposing an `analyze_image` tool, the id is typically `openrouter_image_analyze_image`. **Verify yours** (e.g. via `/tools` or your config) — the value depends on your server key.
3. Set `backend.type` to `"mcp"` and `backend.mcp.tool` to that id.

Minimal config (`.opencode/opencode-vision.jsonc`):

```jsonc
{
  // MCP backend: the model is instructed to call the tool itself.
  "backend": {
    "type": "mcp",
    "mcp": {
      "tool": "openrouter_image_analyze_image", // your real tool id
      "prompt": "Analyze this image and describe what you see.",
      "format": "text",
      "maxTokens": 512
    }
  }
}
```

### Backend B — CLI (`mmx` / MiniMax CLI)

In this mode the plugin **itself** spawns the CLI (`inject-description`), captures stdout, and injects that text directly into the chat.

**Setup:**

1. Install the [`mmx`](https://github.com/MiniMax-AI/cli) CLI and authenticate it (see that project's README). Confirm `mmx vision` works from your shell.
2. Set `backend.type` to `"cli"` and configure `backend.cli`.

Minimal config (`.opencode/opencode-vision.jsonc`):

```jsonc
{
  // CLI backend: the plugin runs the command and injects its stdout.
  "backend": {
    "type": "cli",
    "cli": {
      "command": "mmx",
      "args": ["vision", "describe"], // mmx requires the "describe" subcommand
      "promptFlag": "--prompt",
      "imageFlag": "--image", // mmx takes the image via --image, not as a positional arg
      "timeoutMs": 30000
      // "jsonFlag": "--json",
      // "env": { "API_KEY": "..." }
    }
  }
}
```

> **`mmx` requires `args: ["vision", "describe"]` and `imageFlag: "--image"`.** The `describe` subcommand is mandatory, and the image must be passed as `--image <ref>` (not a positional arg), so `imageFlag` is required for `mmx`.

How the CLI is invoked: `<command> <args...> [<promptFlag> <prompt>] [<jsonFlag>] <image handling>`, where `<image handling>` is either `<imageFlag> <ref>` repeated per image (when `imageFlag` is set) or `<imageRef1> <imageRef2> ...` as trailing positionals (default). `env` is merged on top of the current `process.env`. On success the trimmed stdout becomes the description; on non-zero exit, timeout, or spawn error the plugin **fails soft** (see [Troubleshooting](#troubleshooting)).

---

## Model detection

For each message, the plugin decides whether to activate bridging. The decision follows this precedence (highest first):

1. **`denylist` match** -> never activate (force-off).
2. **`models` (allowlist) match** -> always activate (force-on).
3. **Capability auto-detect** via the SDK's provider capabilities:
   - `capabilities.input.image === true` -> it is a vision model, **skip** (no bridging needed).
   - `capabilities.input.image === false` -> text-only model, **activate**.
4. **Unresolvable fallback** (provider capabilities could not be resolved):
   - in `"hybrid"` or `"patterns"` mode, fall back to the allowlist;
   - otherwise do not activate.

Capability lookups are cached per `providerID:modelID` for the session, and failed lookups are cached as unresolved to avoid retry storms.

The `detection` setting controls which strategy is used:

| Mode | Behavior |
| --- | --- |
| `"auto"` | Rely on capability resolution only (steps 1-3). No pattern fallback when unresolvable. |
| `"patterns"` | Rely on `models` / `denylist` patterns (steps 1-2), with allowlist fallback when unresolvable. |
| `"hybrid"` (default) | Auto-detect first, fall back to patterns when capabilities can't be resolved. |

**Common overrides:**

- Force bridging on for a specific text model: add it to `models`.
- Force bridging off (e.g. for a model with broken capability metadata): add it to `denylist`.

```jsonc
{
  "models": ["openai/gpt-4o-mini", "anthropic/claude-3-haiku"],
  "denylist": ["openai/gpt-4o"],
  "detection": "hybrid"
}
```

---

## The default prompt

When `promptTemplate` is empty (the default), the plugin uses a built-in **maximum-detail** template:

> You have {imageCount} image(s). Examine each image carefully and provide a detailed description including objects, text, scene composition, colors, and any notable features. Answer in the same language as the user request: {userText}

The intent is to extract enough detail that the image could be understood (or largely reconstructed) from the text alone.

**Placeholders:** `{imageCount}` (number of images) and `{userText}` (the original user message text). Override with `promptTemplate`:

```jsonc
{
  "promptTemplate": "You have {imageCount} image(s). Describe each image in detail for the following request: {userText}"
}
```

---

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| **Plugin never activates** | The model already reports `capabilities.input.image === true` (it has native vision) and is auto-skipped. To force it on, add the model to `models`. Also check `detection` mode. |
| **Plugin activates on a vision model** | Capability metadata is missing/wrong. Add the model to `denylist` to force it off. |
| **MCP tool is never called** | `backend.mcp.tool` does not match the real OpenCode tool id. Re-check the id (it follows `<serverKey>_<toolName>`); remember in MCP mode the *model* decides to call the tool, so the model must be willing to use tools. |
| **CLI returns an error / empty description** | The CLI is run with `AbortSignal.timeout` (`backend.cli.timeoutMs`, default 30000 ms). On non-zero exit, timeout, or spawn error the plugin **fails soft**: it injects an `[opencode-vision] cli ...` message and logs a warning instead of crashing your session. Check the CLI is installed, authenticated, and on your `PATH`. |
| **Images aren't saved to disk** | Check `tempDir` exists and is writable. The plugin creates it if possible, but parent directories / permissions must allow it. |
| **Stale temp files piling up** | The TTL sweep runs at plugin init when `cleanup === "init"` (default), deleting `vision-*` files older than `cleanupAfterHours` (default 24). Set `cleanup: "never"` to disable, or `cleanupAfterHours: 0` to disable age-based deletion. |

---

## Limitations

- **No bundled vision.** A backend (MCP server or CLI) is required; the plugin only bridges.
- **Single-round analysis.** No multi-turn image dialog; each image is analyzed once per transform pass.
- **`backend.type: "tool"` is not supported in v1** (rejected by the schema).
- **Experimental hook.** This plugin relies on `experimental.chat.messages.transform`, which may change across SDK versions.
- **Node >= 22** is required (`engines.node` in `package.json`; modern APIs like `AbortSignal.timeout` are used).

---

## Testing & Coverage

```bash
pnpm test       # run the test suite
pnpm coverage   # run tests with V8 coverage
```

Current coverage: **81% lines** across `src/` (excluding `index.ts`, the plugin entry-point glue that requires the live OpenCode runtime). Coverage is tracked continuously via the [CI workflow](https://github.com/venespana/opencode-vision/actions/workflows/ci.yml) and reported through [Codecov](https://codecov.io/gh/venespana/opencode-vision).

---

## License

**AGPL-3.0** — as declared in `package.json`. See [`LICENSE`](./LICENSE) for the full text.

---

## Acknowledgments

This project parallels and extends [`devadathanmb/opencode-easy-vision`](https://github.com/devadathanmb/opencode-easy-vision). Thanks to that project for the original idea of bringing vision to text-only OpenCode models.
