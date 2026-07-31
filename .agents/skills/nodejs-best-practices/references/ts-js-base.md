# TypeScript / JavaScript Shared Base

Shared technical conventions for **Node.js**, **React**, and **NestJS**. Load alongside `common-principles.md`.

These rules are non-negotiable for new code in any of the three stacks.

---

## 1. Module System

- Use **ESM** (`import` / `export`) for new projects.
- Use **CJS** (`require`) only when forced by legacy dependencies or tooling.
- Never mix both in the same module. Pick one and stay consistent.

## 2. Async

- Prefer `async / await` over raw promise chains or callbacks.
- Propagate errors with `throw`. Catch only at boundaries (top-level handler, request boundary).
- Avoid `.then()` chains longer than 2 levels.
- Never use `await` inside a `forEach` — use `for...of` or `Promise.all`.

## 3. Error Handling

- Throw `Error` subclasses or domain-specific error types (`UserNotFoundError`, `PaymentDeclinedError`).
- Never swallow errors silently: `catch {}` is forbidden. At minimum, log with context.
- Top-level handlers log + report + decide whether to exit (CLI) or send 500 (HTTP).
- Stack traces belong in logs, not in user-facing messages.

## 4. Config & Environment

- Validate env vars at startup with a schema (`zod`, `joi`, `class-validator`).
- Never read `process.env.X` deep inside business logic — inject a typed config object.
- Fail fast at startup if required config is missing or invalid.

## 5. Logging

- Structured logs (JSON), not string concatenation.
- Levels: `error` > `warn` > `info` > `debug`. Default to `info` in production.
- Never log secrets, PII, tokens, passwords, or full request bodies blindly.
- Include request/correlation IDs for traceability.

## 6. File & Project Structure

- Separate `src/`, `tests/`, `config/` directories.
- Group by **feature / bounded context**, not by technical layer.
  - **GOOD**: `src/orders/{controllers,services,repositories}.ts`
  - **BAD**: `src/controllers/orders.ts`, `src/services/orders.ts`, `src/models/orders.ts`
- One bounded context per directory. Cross-context imports go through a public API barrel (`index.ts`).

## 7. Package Management

- Commit `package-lock.json` / `pnpm-lock.yaml` / `yarn.lock`.
- Use exact versions for critical dependencies (`"express": "4.21.2"` not `"^4.21.2"`).
- Run `npm ci` (not `npm install`) in CI for reproducible installs.
- Audit dependencies in CI: `npm audit --production` for known vulnerabilities.

## 8. TypeScript-Specific

- `strict: true` in `tsconfig.json`. Non-negotiable.
- No `any`. Use `unknown` and narrow with type guards.
- Public function signatures are fully typed. Internals can be inferred.
- Avoid `enum`; use string literal unions (`type Status = 'active' | 'inactive'`).
- Prefer `readonly` on properties that should not mutate.

## 9. Testing

- Test behavior, not implementation. Do not assert on internal state.
- One assertion concept per test (multiple `expect` calls are fine if they check one thing).
- Test names describe the scenario: `it('rejects expired tokens', ...)`.
- Avoid mocks where possible. Use fakes (in-memory implementations) instead.