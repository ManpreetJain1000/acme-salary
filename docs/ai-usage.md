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
| **Employee code reuse** | Next code computed as `MAX(id) + 1`. | Code review: deleting the newest employee would hand their code to the next hire, breaking any external reference (payroll exports, tickets). | `AUTOINCREMENT` + read the `sqlite_sequence` high-water mark inside the write transaction. Test: delete then create → new code. |
| **Form error handling** | The form mapped API errors onto fields, then rethrew them. | Headless-browser run of the add-employee flow showed an uncaught promise rejection in the console. | Handle in one place: field errors on fields, everything else as a toast, no rethrow. |
| **Runtime config in the production image** | `next.config.ts`. | Reasoning about the Docker image: dev dependencies (TypeScript) are pruned, which risks the config failing to load at runtime. | Converted to `next.config.mjs`. |
| **Seed atomicity test** | The first draft had a misleading comment about "pre-occupying an email". | Reading the test. | Comment now says what the test does: a trigger aborts the 25th insert, proving full rollback. |

## What I deliberately did *not* let the AI decide
- Scope and what's out of scope (`requirements.md`).
- Money representation, the FX approach, the audit-trail requirement and the seed's concurrency model.
- Percentile definition: matched Excel's `PERCENTILE.INC` because that's what this HR team already uses.
- Treating outliers as "≥ X% from the median of the same title + country, groups of 5+", not a global z-score, because pay is only comparable within the same role and market.
