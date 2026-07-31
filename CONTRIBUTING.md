# Contributing to opencode-vision

Thanks for your interest in contributing! This plugin is small and focused — most contributions fall into these categories:

- Bug fixes
- New vision backend support
- Detection improvements (new model capability quirks)
- Documentation improvements

## Prerequisites

- **Node.js >= 22** (uses `AbortSignal.timeout` and other modern APIs)
- **pnpm >= 11** (`corepack enable && corepack prepare pnpm@latest --activate`)
- An OpenCode install for manual testing
- A vision backend (e.g. [`mmx`](https://github.com/MiniMax-AI/cli) CLI or an MCP image server) for end-to-end testing

## Development setup

```bash
git clone https://github.com/venespana/opencode-vision.git
cd opencode-vision
pnpm install
pnpm build
pnpm test
```

### Useful scripts

| Command | Description |
|---------|-------------|
| `pnpm test` | Run the test suite |
| `pnpm coverage` | Run tests with V8 coverage |
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm lint` | Run ESLint |
| `pnpm typecheck` | Type-check without emitting |
| `pnpm format` | Check formatting with Prettier |

### Project structure

```
src/
  index.ts         Plugin entry point — wires hook + detection + transform
  types.ts         Zod schema (PluginConfig) and TypeScript types
  config.ts        4-level JSONC config merge + defaults
  detection.ts     Hybrid model capability detection (allowlist/denylist/auto)
  transform.ts     Core transform: image materialize → backend → inject
  images.ts        Image extraction, base64 decode, SHA-256 hashing
  prompt.ts        Prompt template rendering
  cleanup.ts       Temp file TTL sweep at init
  logger.ts        Singleton debug logger
  backend/
    types.ts       VisionBackend interface
    mcp.ts         MCP backend (inject-instructions)
    cli.ts         CLI backend (inject-description)
```

## Issue first

**Open an issue before starting work.** This prevents duplicate effort and gives maintainers a chance to provide context. Use `Fixes #123` or `Closes #123` in your PR description to link the issue.

For small fixes (typos, docs), a brief issue is fine — just enough context.

## Pull request expectations

### Requirements

- **Small and focused** — one concern per PR
- **Tests pass** — `pnpm test` must be green; add tests for new behavior
- **Lint clean** — `pnpm lint` must pass
- **Explain the fix** — what you tested and how a reviewer can reproduce

### Commit / PR title format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix | Use for |
|--------|---------|
| `feat:` | New feature or backend support |
| `fix:` | Bug fix |
| `docs:` | Documentation |
| `refactor:` | Code refactoring without behavior change |
| `test:` | Adding or updating tests |
| `chore:` | Maintenance, dependencies, CI |
| `ci:` | CI/CD changes |

Scopes are optional: `feat(detection):`, `fix(cli):`, etc.

### Code style

- **TypeScript strict mode** — no `any` unless absolutely necessary
- **Functional style** — prefer `const`, avoid `let`, minimize mutation
- **Fail-soft** — the plugin must never crash a user's OpenCode session; log warnings and degrade gracefully
- **No `else` after return** — flatten control flow
- **Precise types** — leverage Zod schemas; export types from `types.ts`

## Reporting bugs

Use the **Bug Report** issue template. Include:

1. OpenCode version and model
2. Plugin config (redact secrets)
3. Debug log output (enable `debug: true`, check `logFile`)
4. Expected vs actual behavior

## License

By contributing, you agree your contributions are licensed under **AGPL-3.0**.
