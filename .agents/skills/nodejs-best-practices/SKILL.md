---
name: nodejs-best-practices
description: "Trigger: Node.js, Node, Express, Fastify, backend JavaScript, server-side JS. Enforce clean code, async patterns, and SOLID/KISS/DRY in Node.js."
license: Apache-2.0
metadata:
  author: venespana
  version: "1.0"
---

## Activation Contract

Load when writing, reviewing, or refactoring Node.js server code (`.js`/`.ts` outside a frontend framework). Applies to: Express/Fastify servers, CLI tools, scripts, libraries.

## Hard Rules

1. **ESM by default.** `import`/`export`. Never mix with `require` in the same module.
2. **`async/await` over chains.** No `.then()` longer than 2 levels. No `await` inside `forEach` — use `for...of` or `Promise.all`.
3. **Never block the event loop.** No sync I/O (`fs.readFileSync`, `crypto.pbkdf2Sync`) in request paths.
4. **Errors are thrown, not swallowed.** No `catch {}`. Domain-specific error classes. Catch only at boundaries.
5. **Config is validated at startup.** Never read `process.env` inside business logic — inject a typed config object.
6. **Structured logging (JSON).** No secrets/PII. Include correlation IDs.
7. **Comments are WHY only.** No narrative. Names carry intent.
8. **No magic numbers.** Named constants with units: `DEFAULT_TIMEOUT_MS`.
9. **Group by feature, not by layer.** `src/orders/` not `src/controllers/` + `src/services/` stacked.
10. **Prefer early return over nested `if`.** Guard clauses first, main logic at base indentation. Max 2 levels of nesting.

## Decision Gates

| Situation | Action |
|---|---|
| Sync I/O in async function | Replace with async equivalent |
| `process.env.X` in business logic | Move to validated config object |
| `.then().then().then()` chain | Refactor to `async/await` |
| `catch (e) {}` | Add logging or rethrow |
| Callback-style API | Wrap in Promise or use async version |
| Repeated logic in 4+ places | Extract (DRY) — but only after the 3rd case |
| 3+ levels of nested `if` | Flatten with guard clauses (early return) |
| `if` branch returns but `else` still present | Drop the `else` |
| Speculative parameter "for flexibility" | YAGNI — remove |

## Execution Steps

1. Read `references/common-principles.md` for SOLID/YAGNI/KISS/DRY + naming/comment rules.
2. Read `references/ts-js-base.md` for shared TS/JS conventions (modules, async, errors, config, logging).
3. Apply the hard rules above to every server file touched.
4. For new endpoints: validate input (DTO), separate handler from logic, inject dependencies.

## Output Contract

Return: files modified, principles applied, anti-patterns removed, async/error issues fixed.

## References

- `references/common-principles.md` — SOLID, YAGNI, KISS, DRY, naming & comment convention.
- `references/ts-js-base.md` — ESM, async/await, error handling, config, logging, TypeScript strictness.
