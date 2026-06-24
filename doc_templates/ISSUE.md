# Canonical Issue Format

All human-authored and architect-authored tickets (`feat`, `fix`, `test`, `docs`, `chore`) must follow this format. `auto:ops` and `auto:alert` incident tickets are **exempt** — they use an intentionally terse fingerprint + evidence + run-link format.

Use the GitHub issue form templates in `.github/ISSUE_TEMPLATE/` to create conforming issues directly from the GitHub UI.

---

## Title

```
type(scope): imperative verb + what
```

**Examples:**
- `feat(auth): add TOTP multi-factor authentication`
- `fix(worker): prevent null dereference in schedule_trigger activity`
- `test(e2e): add smoke coverage for rental-order lifecycle journey`
- `docs(contributing): document canonical issue format`

---

## Summary

One prose paragraph: what the problem is, why it matters, and what success looks like. **No bullet lists.**

---

## Context

Named files (`path/to/file.ts:42`), verbatim error messages, run URLs, PR numbers, and issue numbers that establish the evidence for the problem. "The current behaviour is wrong" is not context.

---

## Type-specific spec section

Pick the section that matches the ticket type. Remove the others.

### `feat` — What to Build

API contracts, SQL schema shapes, file trees, enumerated behaviour steps. Write specifications, not intentions. A reviewer should be able to implement from this section alone.

### `fix` — Root Cause

File path, line number, incorrect assumption, and trigger condition that causes the bug. What is wrong and why, not just what is affected.

### `test` — What's Missing

Which specific behaviours or user journeys lack coverage, which spec file they belong in, and why the coverage gap matters. Name the exact test cases.

---

## Acceptance Criteria

Grouped checkboxes. Each item is independently verifiable and describes an observable outcome — not an implementation step.

```markdown
### Behaviour
- [ ] <specific observable outcome a reviewer can verify without reading the code>

### Error handling
- [ ] <observable error response under specified condition>

### Performance / security (if applicable)
- [ ] <measurable threshold or security property>
```

---

## Out of Scope

Explicit list of adjacent things that are **not** this ticket. Prevents scope creep and reduces review round-trips.

---

## Implementation Notes

Constraining ADRs, conflicting open PRs, files to avoid, environment caveats. **Optional — omit if there is nothing relevant.**
