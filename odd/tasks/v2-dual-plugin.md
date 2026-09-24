# Feature: v2-dual-plugin

## Objective
Make `@venespana/opencode-vision` load and run on both OpenCode V1 and V2 from a single default export.

## Problem
OpenCode V2 removed the V1 plugin API. The server logs `PluginModule.LoadError: Plugin must export a default definition with an id and an effect or setup function` and the plugin no longer loads. V1-style default-exported async functions do not run in V2 (official migration guide: "V1 plugin implementations do not run in V2").

## Scope (user-decided)
- IN: this repo package only — dual V1+V2 support (`server()` for V1, `setup(ctx)` for V2, `id: "opencode-vision"`), version 0.2.0.
- OUT: the 5 local plugins in `~/.config/opencode/plugins/` (engram, model-variants, opencode-review-transport, sdd-task-result-artifacts, skill-registry) — they stay on V1 style for now, separate future task.

## Constraints
- No git commit by delegates; orchestrator performs work-unit commits.
- Do not publish npm; user decides delivery.
- Behavior preservation on both runtimes; English code comments.

## Tasks
- [x] T1 — Port src/index.ts to dual export `{ ...Plugin.define({ id, setup }), server }`; extract shared pipeline into helpers. (delegate: general writer)
- [x] T2 — V2 wiring: `ctx.session.hook("context")` + V2 message/media adapters in src/transform.ts; capability resolver via `ctx.model.list()` (`setProvidersResolver`). (delegate: general writer)
- [x] T3 — package.json: add `@opencode/plugin` peer `>=2.0.0` + dev `^2.0.16`, keep `@opencode-ai/plugin >=1.0.0`, bump 0.2.0. (delegate: general writer)
- [x] T4 — Verification: `pnpm typecheck` pass; `pnpm test` pass (65/65, 11 files); `pnpm build` pass; `node -e import('./dist/index.js')` shows `{ id, setup, server }` (parent spot check re-ran this: pass).
- [x] T5 — README updated: flow diagram, requirements, peer deps, V2 `plugins` registration form.

## Route evidence
- Writer trigger fired (2+ non-trivial files) → one delegated general writer (session ses_f2d6c8b8dffeAhiIZp4BvqCEAx). Parent did spot check + gates.
- T5 (README, single mechanical file) → inline by orchestrator.

## Verification evidence
- Writer (verification of record, RDD on): typecheck pass; test 65/65 pass; build pass; end-to-end smoke of both wirings with synthetic events (image extracted → materialized → backend called → description injected → source part removed).
- Parent spot check: dist import shows dual export. PASS.
- `gentle-ai review assess`: risk medium (`configuration_change`, package.json), `review_due=true` (`slice_budget_reached`), 5 changed paths. Review NOT executed: preflight STATUS returned `immutable_review_transport_unsupported` (OpenCode V2 transport unavailable; supported runtimes: claude-code, codex), `next_action: stop`, non-retryable. Recorded as PENDING, not skipped silently.

## Known V2 caveats (from writer, kept as code comments)
- V2 `context` hook fires only for agent-loop model requests; compaction/title/generate have separate hooks (matches V1 scope).
- V2 media sources of kind `bytes`/`ref` are not bridged (no V1 equivalent).
- V2 `CliBackend` warn logging has no `app.log` sink; failures still surface via injected error text and debug file logging.

## Next steps
- Real-runtime smoke on a live V2 server with an actual pasted image (writer smoke used synthetic events).
- User decision: npm publish 0.2.0; V1 support window (remove `server()` when it ends).
- Pending separate task: migrate the 5 local plugins to V2-only.
- Native review of this candidate remains due; run from a supported runtime (claude-code/codex) or after OpenCode transport conformance.

## Commits
- `b38f950` feat: support OpenCode V2 plugin API with dual-mode entry point (feature/v2-dual-plugin) — 7 files, +2481/−91 (includes pnpm-lock churn).
- `7de0234` fix: pin @opencode/plugin to 2.0.15 for release-age policy — CI rejected the same-day 2.0.16 family (ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION); protobufjs build script denied in allowBuilds.
