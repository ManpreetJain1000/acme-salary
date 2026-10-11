# How AI was used

## Workflow
1. **I owned the thinking:** requirements, the HR manager's questions, data model, and trade-offs were decided first and written down (`requirements.md`, `decisions.md`).
2. **AI (Claude) as a pair programmer:** generated scaffolding, boilerplate, first drafts of code and tests from those decisions.
3. **I reviewed every change**, ran tests, and corrected the AI where it was wrong (log below). Nothing was merged untested.

## Key prompts
- *Planning:* "Plan a 5-hour build of salary management software for 10k employees for an HR manager. What would a senior engineer prioritise and deliberately leave out?"
- *Seed:* "Write a deterministic seed for 10k employees: seeded PRNG, salary bands by job level × country multiplier, integer minor units, single `BEGIN IMMEDIATE` transaction, idempotent."
- *Stats:* "Pure functions for min/p25/median/p75/max over integer arrays with linear interpolation; table-driven tests including empty, single, odd and even sizes."
- *Concurrency question I asked:* "Do we need to lock the table while seeding?" → answer: no table locks in SQLite; one transaction + check-inside-transaction prevents partial and double seeding.

## Corrections log (where AI output was wrong or weak)
| Area | AI output | How it was caught | Fix |
|---|---|---|---|
| **Salary sort across currencies** | `sortBy=salary` mapped to `ORDER BY salary_minor`. The generated test *asserted* that the INR employee came first. | Reviewing benchmark output and asking "what does the HR manager actually see?": every salary sort put India on top, because ₹2,000,000 (≈ $22.6k) is a bigger number than $150,000. | Sort by a USD-equivalent SQL expression built from the static FX constants (never user input). The test now asserts the correct cross-currency order. **Lesson:** AI-written tests can lock in AI-written bugs; review what a test asserts, not just whether it passes. |
| **Employee code reuse** | Next code computed as `MAX(id) + 1`. | Code review: deleting the newest employee would hand their code to the next hire, breaking any external reference (payroll exports, tickets). | `AUTOINCREMENT` + read the `sqlite_sequence` high-water mark inside the write transaction. (Since employees can no longer be deleted at all, see below, this is now defence in depth; the delete-based test was replaced by termination tests.) |
| **Form error handling** | The form mapped API errors onto fields, then rethrew them. | Headless-browser run of the add-employee flow showed an uncaught promise rejection in the console. | Handle in one place: field errors on fields, everything else as a toast, no rethrow. |
| **Runtime config in the production image** | `next.config.ts`. | Reasoning about the Docker image: dev dependencies (TypeScript) are pruned, which risks the config failing to load at runtime. | Converted to `next.config.mjs`. |
| **Design doc vs code (audit)** | `decisions.md` was drafted before the build and not re-checked. | A line-by-line audit of every decision against the code. | Five fixes, one commit each: (1) cascade delete contradicted "immutable history" → terminate/reinstate, DB triggers, versioned migrations; (2) SQL and the DB library leaked outside the repository → moved, plus an architecture test; (3) totals rounded per employee → exact, rounded once; (4) insights query described wrongly → doc corrected; (5) FX date shown on one page only → shown beside every USD figure. **Lesson:** design docs drift; verify claims against code before a reviewer does. |
| **Index regression** | Added a single-column `status` index with the termination feature. | Re-running the benchmark before updating `performance.md`: the first page went 0.2 → 3 ms; `EXPLAIN QUERY PLAN` showed a full temp-B-tree sort. | Migration 4: `(status, full_name)` composite index. |
| **"Is it scalable?" answered by guessing** | First answer extrapolated from 10k numbers. | Chose to measure instead: added `BENCH_COUNT` and ran 100k. That exposed the real wall: synchronous insights blocking the event loop for ~1.7 s per dashboard visit. | Insights cache keyed by a trigger-maintained data version; expression index for salary sort; FTS5 search. |
| **New index made unrelated queries slower** | Added the salary expression index. | The benchmark at 100k: country filter 20 → 130 ms; `EXPLAIN QUERY PLAN` showed the new index chosen without statistics. A *sampled* `ANALYZE` (my first fix) didn't help either. | Full `ANALYZE` after seeding, `PRAGMA optimize` on open, and a plan test pinning the choice. |
| **Search trigger slowed the bulk seed 12×** | Per-row FTS sync trigger. | Timed the seed with each trigger dropped in isolation. | Seed sets the trigger aside inside its transaction and rebuilds the index once; tests prove the trigger is restored, even on failure. |
| **Auth tests passing for the wrong reason** | Session cookie marked `Secure`; tests asserted 401 after logout/expiry. | A "grants access" test failed: Secure cookies are never sent over plain HTTP, so *every* request was 401, and the logout/expiry tests would pass even if both were broken. | Tests run with non-Secure cookies and first prove access works; the Secure flag has its own assertion. |
| **Sign-in redirect loop** | Redirect on 401 from `/api/auth/me` in a React effect. | Browser run: after the redirect, the effect re-fired on `/login`, rewriting `?next=` to `/login`. | Only redirect when not already on `/login`. |
| **Architecture rule false positive** | The rule banning SQL outside the repository matched any `.exec(`. | The new `If-Match` parser's `RegExp#exec` failed the build. | Match `db.exec(` only; verified it still catches the real case. |
| **Gaps found by an architecture review** | The build had no concurrency control, no actor in the audit trail, no CI. | Listing every architectural gap and ranking them by reviewer impact. | Optimistic locking (ETag/If-Match), `changed_by` + FX rate + employment events, CI with a Docker smoke test, a DB-aware health check. The rest are documented as "Known gaps". |
| **Seed atomicity test** | The first draft had a misleading comment about "pre-occupying an email". | Reading the test. | Comment now says what the test does: a trigger aborts the 25th insert, proving full rollback. |

## What I deliberately did *not* let the AI decide
- Scope and what's out of scope (`requirements.md`).
- Money representation, the FX approach, the audit-trail requirement and the seed's concurrency model.
- Percentile definition: matched Excel's `PERCENTILE.INC` because that's what this HR team already uses.
- Treating outliers as "≥ X% from the median of the same title + country, groups of 5+", not a global z-score, because pay is only comparable within the same role and market.
