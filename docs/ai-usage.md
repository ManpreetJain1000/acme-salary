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
| Area | AI suggestion | What I changed and why |
|---|---|---|
| _filled in during the build_ | | |
