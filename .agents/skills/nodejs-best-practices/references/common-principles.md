# Common Programming Principles

Universal principles applied identically across all language skills in this registry (GDScript, Node.js, React, NestJS). Load this reference whenever a skill references `common-principles.md`.

---

## 1. SOLID (Robert C. Martin)

Five rules for tolerance to change. SRP is the foundation; the others complete the picture.

### 1.1 SRP — Single Responsibility
A unit (class, module, function) has **one reason to change**, served by **one actor** (stakeholder, team, or concern).

**Test**: if two unrelated teams could legitimately ask you to modify the same file, it violates SRP — even if the file does "one thing" technically.

**Pitfall**: "one class = one method" is over-correction. A class doing 5 things for ONE actor is fine. A class doing 1 thing for 5 actors is not.

### 1.2 OCP — Open/Closed
Open for extension, closed for modification. Add behavior without editing existing code.

**Apply when**: there are ≥2 concrete implementations, OR an extension point is already requested. Otherwise it is premature abstraction (see YAGNI).

### 1.3 LSP — Liskov Substitution
A subtype must be substitutable for its base type without breaking expected behavior.

**Test**: if a subclass must throw `NotImplementedError`, override to throw, or weaken preconditions, it violates LSP.

### 1.4 ISP — Interface Segregation
Many specific interfaces > one general-purpose interface.

**Test**: if a consumer ignores 80% of an interface's methods, the interface is too fat. Split it.

### 1.5 DIP — Dependency Inversion
Depend on abstractions (interfaces, types), not concretions. Inject dependencies; never `new` them inline inside business logic.

**Test**: can you swap the implementation in a test without touching the calling code? If not, DIP is missing.

---

## 2. YAGNI — You Aren't Gonna Need It (Ron Jeffries, XP)

Do not build for hypothetical requirements. Three practical gates:

1. **Real use case today?** If no → do not add it.
2. **Parameter/config for "flexibility"?** If a single value covers all current callers, use the single value.
3. **Abstraction for the 2nd or 3rd case that does not exist?** Wait. The rule of three applies: wait for 3 concrete examples before abstracting.

**Anti-pattern**: configurable everything, plugin architectures with one plugin, premature generics.

---

## 3. KISS — Keep It Simple, Stupid (Kelly Johnson)

Simple > clever. The next reader does not know what you were thinking.

**Self-tests**:
- If a function needs a comment to be understood, first try renaming + splitting. Only comment if it still does not speak.
- If a one-liner replaced a 5-liner, you won.
- If you cannot explain it in 30 seconds, simplify before adding it.

**Anti-pattern**: nested ternaries, "clever" one-liners that save 2 lines, custom DSLs for one use case, metaprogramming without a forcing function.

---

## 4. DRY — Don't Repeat Yourself (Hunt & Thomas)

Every piece of knowledge has a single, authoritative representation.

**Three signals of premature DRY**:

1. The abstraction joins two things that change for different reasons.
2. Changing one side forces changing the other even when not applicable.
3. The shared parameter is accidental (coincidence), not essential (causal).

**Rule of three**: wait for 3 examples before extracting.

**Anti-pattern**: copy-paste detected → extract to a base class on day one. Wait for the third repetition and the shared intent to become clear.

---

## 5. SRP (deeper)

The most-misunderstood principle. It is **not** "one class = one method". It is "one class = one reason to change, one actor that drives that change".

**Cohesion is the test**: do all methods in this unit work toward the same goal for the same stakeholder? If "validate form", "save to DB", and "send email" all live in one class — even though each is "one thing" — there are 3 actors (validator-team, DBA, email-team), so SRP is violated.

**Refactor direction**: split by actor, not by verb. Validation goes to a validator (served by validation team). Persistence goes to a repository (served by the DBA). Notification goes to a notifier (served by the messaging team). They collaborate; they do not merge.

---

## 6. Comment & Naming Convention (HARD RULES)

### 6.1 Naming
- **Reveal intent**: `userCanRetryPayment` > `flag1`. `retryPaymentWithBackoff` > `doIt`.
- **Booleans use a prefix**: `is` / `has` / `can` / `should` (or `es` / `tiene` / `puede` / `debe` if the project is Spanish-language).
- **No type prefixes**: no Hungarian notation, no `bEnabled`, no `strName`.
- **Functions are verbs or verb phrases**: `calculateTotal`, `retryWithBackoff`.
- **Variables are nouns or noun phrases**: `userOrder`, `retryAttempts`.
- **Constants are SCREAMING_SNAKE_CASE** with the unit or context in the name: `MAX_RETRY_ATTEMPTS`, `DEFAULT_TIMEOUT_MS`.

### 6.2 Comments — only the WHY

| Type | Status | Example |
|---|---|---|
| **WHY** (motivation, constraint, decision, workaround) | REQUIRED when non-obvious | `// Retry up to 3x because the upstream returns 502 under load` |
| **WHAT** (narrating the code) | FORBIDDEN | `// increment counter` over `counter++` |
| **HOW** (explaining the mechanism step by step) | FORBIDDEN | `// loop through array and sum values` over a 2-line for |
| **API/JSDoc** (public contract) | REQUIRED for public surfaces | `@param userId` on a library function |

If the code is self-explanatory after good naming, **write no comment**. Silence is correct.

### 6.3 Magic numbers
- All numeric/string literals with business meaning → named constants.
- `MAX_RETRY_ATTEMPTS = 3` > `3` in the body.
- Exception: well-known mathematical constants (`2 * Math.PI`), zero, one in trivial loops.

### 6.4 Functions
- **One responsibility** (a single verb describes it).
- **≤20 lines** as a guide. Extract when exceeded.
- **≤3 parameters** as a guide. More → group into a config/options object.
- **No hidden side effects**: the name declares what the function does. If it also writes to a file, rename or split.

### 6.5 Control Flow — Early Return Over Nesting

**Always prefer guard clauses (early return) over nested `if/else`.** The main logic stays at the base indentation level. Nested conditionals increase cognitive load and hide the happy path.

**BAD — nested conditionals, happy path buried:**

```typescript
function processOrder(order: Order): Result {
  if (order) {
    if (order.isValid) {
      if (order.items.length > 0) {
        // actual logic buried 3 levels deep
        return calculateTotal(order);
      } else {
        return Result.error('No items');
      }
    } else {
      return Result.error('Invalid order');
    }
  } else {
    return Result.error('No order');
  }
}
```

**GOOD — guard clauses, flat structure:**

```typescript
function processOrder(order: Order): Result {
  if (!order) return Result.error('No order');
  if (!order.isValid) return Result.error('Invalid order');
  if (order.items.length === 0) return Result.error('No items');

  return calculateTotal(order);
}
```

**Rules:**
- Validate preconditions first, return early. The happy path is the last thing in the function.
- Never nest `if` more than 2 levels. If you hit level 3, extract a function or use guard clauses.
- `else` is a smell when the `if` branch returns. Drop the `else`.
- This applies to every language: `return` (JS/TS/GDScript), `guard` + early exit patterns.

---

## 7. Decision Matrix — when to apply which principle

| Situation | Principle that applies |
|---|---|
| "Should I add this parameter for flexibility?" | YAGNI (no) |
| "This class has 5 unrelated methods" | SRP (split by actor) |
| "I see the same 3 lines in 2 places" | Wait. Rule of three. |
| "I see the same logic in 4+ places" | DRY (extract) |
| "I want to add behavior without touching existing code" | OCP (only if ≥2 implementations) |
| "My interface has methods nobody uses" | ISP (split) |
| "I can't test this without spinning up a real DB" | DIP (inject) |
| "This function is 50 lines long" | KISS (extract) |
| "I keep writing `// this does X` over my code" | Rename. Delete the comment. |
| "I have 3+ levels of nested `if`" | Early return (guard clauses, flatten) |
| "My `if` branch returns and I still wrote `else`" | Drop the `else` |