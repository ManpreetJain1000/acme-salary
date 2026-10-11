# Design decisions & trade-offs

Short records of the choices that shape the system. Each: decision → why → what it costs.

## D1. TypeScript end to end (Express API + Next.js UI) in an npm-workspaces monorepo
- **Why:** one language, shared mental model, fast iteration in a time-boxed build.
- **Cost:** two processes to run in dev (handled by a single `npm run dev`).

## D2. SQLite via `better-sqlite3`, raw SQL behind a repository layer
- **Why:** 10k rows is tiny; SQLite is zero-ops, fast, and file-based. `better-sqlite3` is synchronous, which makes transactions simple and tests fast (in-memory DB per test). Raw SQL keeps queries visible and tunable; the repository layer is the only place that knows SQL.
- **Cost:** single writer. Fine for one HR team. **Path at scale:** swap the repository for Postgres — services and routes don't change.

## D3. Money stored as integer minor units in local currency
- **Why:** floats cannot represent money exactly (`0.1 + 0.2`). The original local amount is the source of truth; it is never overwritten by a converted value.
- **Cost:** conversion on read. Cheap.

## D4. USD normalisation with a static, dated FX table
- **Why:** cross-country comparison (Q2, Q3) needs a common unit. Static rates are deterministic and testable; the "as of" date is surfaced in the UI so nobody mistakes it for live data.
- **Cost:** rates drift. A scheduled rates refresh is a straightforward later addition.

## D5. Immutable salary history table
- **Why:** salary data needs an audit trail; HR will be asked "when did this change?".
- **Cost:** one extra insert per salary change, done in the same transaction as the update.

## D6. Statistics in a pure service layer
- **Why:** SQLite has no `MEDIAN`/`PERCENTILE`. Grouping happens in SQL (only the needed columns are read, ordered by group + salary); percentiles are computed in pure functions that are trivially unit-tested.
- **Cost:** reads salaries of the filtered set into memory — ~10k integers, negligible. At 1M+ rows, precompute aggregates.

## D7. Validation with `zod` at the API boundary; shared allow-lists
- **Why:** one schema gives runtime validation + TS types. Sort fields and filters are allow-listed, never interpolated, closing the classic `ORDER BY` injection hole. Page size is capped.

## D8. Deterministic, transactional, idempotent seed
- **Why:** same data in tests, demo and deployment. Runs in a single `BEGIN IMMEDIATE` transaction with check-then-insert inside it: atomic (no half-seeded state), safe if two processes start at once, and never blocks readers under WAL. Uses a fixed reference date instead of `now()`.
- **Cost:** none meaningful. ~1% deliberate outliers are injected so the outlier view has signal — documented, not hidden.

## D9. No authentication (yet)
- **Why:** single persona, synthetic data, time box. Called out explicitly as the first production gap rather than half-built.
- **Plan:** SSO (OIDC) + HR role; salary fields only visible to that role; append-only access log.

## D10. Offset pagination
- **Why:** HR wants "page 7 of 200"; at 10k rows offset is fast.
- **Path at scale:** keyset pagination on `(sort_key, id)`.

## Scaling path (documented, deliberately not built)
| Pressure | Change |
|---|---|
| More data / concurrent writers | Postgres (repository swap) |
| Deep pagination | Keyset pagination |
| Slow insights | Materialised aggregates refreshed on salary change |
| Slow text search | SQLite FTS5 / Postgres trigram index |
| More traffic | Stateless API → multiple instances behind a load balancer |
| Bulk imports | Background job queue |
