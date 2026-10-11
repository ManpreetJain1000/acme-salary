# Design decisions & trade-offs

Short records of the choices that shape the system. Each: decision → why → what it costs. Every claim here was checked against the code (see "Keeping this document honest" at the end).

## D1. TypeScript end to end (Express API + Next.js UI) in an npm-workspaces monorepo
- **Why:** one language and one mental model, so iteration is fast in a time-boxed build. The API is separate from the UI so business rules are testable without a framework and can be reused by other clients.
- **Cost:** two processes in dev, started together by `npm run dev`. API types are mirrored by hand in `web/src/lib/types.ts`. A shared package or generated client would remove that drift risk.

## D2. SQLite via `better-sqlite3`; all application SQL in the repository
- **Why:** 10k rows is tiny. SQLite needs no setup, and synchronous transactions keep the code simple and the tests fast (an in-memory database per test). `EmployeeRepository` is the only application code that knows SQL or the database library. Services state *what* must be atomic through `repo.transaction(fn)`; the repository decides *how*. `architecture.test.ts` fails the build if SQL appears anywhere else.
- **Scope of the claim:** the schema/migrations (`db/`) and the bulk seed loader (`seed/seed.ts`) are storage-specific by nature and would be rewritten along with the store.
- **Cost:** a single writer, which is fine for one HR team. **Path at scale:** reimplement the repository, migrations and seed loader for Postgres. Services and routes don't change.

## D3. Money stored as integer minor units in local currency
- **Why:** floats cannot represent money exactly (`0.1 + 0.2`). The local amount is the source of truth; a converted value is never stored.
- **Cost:** conversion on every read, which is cheap. See D11 for sorting.

## D4. USD normalisation with a static, dated FX table
- **Why:** cross-country comparison needs a common unit. Static rates are deterministic and testable. The "as of" date is shown wherever a USD figure appears (directory, employee drawer, insights), so nobody mistakes it for a live rate.
- **Cost:** rates drift. A scheduled refresh, with the rate stored per salary change, is the next step.

## D5. Salary history is append-only, and employees are terminated, not deleted
- **Why:** pay data needs an audit trail ("when did this change, and from what?"), including for people who have left.
- **How:**
  - Every salary or currency change inserts a history row in the same transaction as the update.
  - Leaving is `POST /employees/:id/terminate` (the date defaults to today and can't be before the hire date); `/reinstate` undoes a mistake.
  - `DELETE` returns 405.
  - Migration 3 adds triggers, so the **database itself** rejects any UPDATE or DELETE on `salary_history` and any DELETE on `employees`, however it is reached.
- **Behaviour that follows:** former employees are hidden from the directory by default (Current / Former / All filter) and excluded from insights, which describe the current workforce. Their records can't be edited until they are reinstated. A new hire whose email belongs to a former employee gets a message pointing to reinstatement.
- **Cost:** emails stay unique across current and former employees. Status changes (left / reinstated) are kept as the latest state on the employee, not as their own history table; that's the next addition if HR needs employment history.

## D6. Statistics in pure functions; percentiles match Excel
- **Why:** SQLite has no `MEDIAN`/`PERCENTILE`. The repository filters rows in SQL, using the indexes, and returns eight narrow columns for current employees, unsorted. Pure functions in `domain/stats.ts` group, sort and compute percentiles, so they are trivially unit-tested. Percentiles use linear interpolation, the same as Excel's `PERCENTILE.INC`, because the HR team will check the app against their spreadsheet.
- **Cost:** the filtered set (up to ~10k small rows) is read into memory per request: 20–60 ms for the whole org. At 1M+ rows, precompute aggregates or use Postgres `percentile_cont`.

## D7. Validation with `zod` at the API boundary; allow-lists for anything that reaches SQL
- **Why:** one schema gives runtime validation and TypeScript types. Sort keys are an allow-list in `schemas.ts`, mapped to SQL inside the repository. Filters are parameterised. LIKE wildcards are escaped. Page size is capped at 100. The client validates the same rules for fast feedback, but the API is the authority.

## D8. Deterministic, transactional, idempotent seed
- **Why:** the same data in tests, the demo and deployment. A seeded PRNG and a fixed reference date (never `now()`). One `BEGIN IMMEDIATE` transaction, so there is never a half-seeded state, with the "is it empty?" check inside it. Two processes booting at once can't double-seed, and readers are never blocked under WAL.
- **Reset:** history is append-only, so `--reset` drops and re-migrates the tables instead of deleting rows (DROP TABLE doesn't fire DELETE triggers). It's refused in production unless `ALLOW_RESET=true`.
- **Cost:** about 1% deliberate outliers are injected so the outlier view has signal. This is documented, not hidden.

## D9. No authentication (yet)
- **Why:** single persona, synthetic data and a time box. It's called out as the first production gap rather than half-built.
- **Plan:** SSO (OIDC) and an HR role; salary fields visible only to that role; an append-only access log of who viewed or changed what.

## D10. Offset pagination
- **Why:** HR wants "page 7 of 400". At 10k rows the deepest page takes ~30 ms.
- **Path at scale:** keyset pagination on `(sort_key, id)`.

## D11. Salary sorts by USD equivalent, not raw local amount
- **Why:** sorting `salary_minor` across currencies is meaningless: ₹2,000,000 (≈ $22.6k) outranks $150,000, so every sort put India first. The sort uses a USD `CASE` expression built from the static FX constants, never from user input.
- **Cost:** the sort can't use an index, so the deepest page takes ~30 ms. **At scale:** persist an indexed `salary_usd_minor`, recomputed when rates change.

## D12. Derived money is computed exactly and rounded once
- **Why:** rounding each employee's USD value before summing, or rounding a median before converting it, accumulates error (up to 0.5 cent per row). Aggregates use `toUsdExact` and `percentileExact`, and round once at the end. Single displayed amounts round once.

## D13. Versioned migrations
- **Why:** `CREATE TABLE IF NOT EXISTS` can never change an existing database file. Ordered migrations are recorded in SQLite's `user_version`, each in its own `IMMEDIATE` transaction that re-checks the version, so concurrent boots are safe. Released migrations are never edited (migration 4 fixed an index choice instead of rewriting migration 2).

## D14. One public origin; the API is internal
- **Why:** Next.js proxies `/api/*` to the API on `127.0.0.1`. The browser never makes a cross-origin call and the API is not internet-facing, which removes a CORS and attack surface.
- **Cost:** one extra hop in the same container, which is negligible.

## D15. Single-container deploy, seeded on first boot
- **Why:** one Docker image runs the API and the web app, so any host can run it. A deterministic seed on an empty database means a free host with an ephemeral disk still serves the full demo.
- **Cost:** on such hosts, HR edits reset on redeploy. Mount a volume at `/app/data` to keep them.

## D16. Small choices worth knowing
- **Reference data in code** (countries, currencies and rates, departments → titles → bands): it changes with releases, not with HR edits. It's the single source for validation, the seed and the UI dropdowns (`GET /api/meta`).
- **Employee codes are never reused** (`AUTOINCREMENT` high-water mark), so external references such as payroll exports stay valid.
- **Outliers** are measured against the median of the same job title, country and currency, in groups of 5 or more, at a chosen threshold (±25/40/60%). Pay is only comparable within the same role and market.
- **Currency can differ from the country's** on purpose (for example, a Germany-based employee paid in USD). Pay bands group by currency too, so they never mix currencies.

## Scaling path (documented, deliberately not built)
| Pressure | Change |
|---|---|
| More data / concurrent writers | Postgres (repository, migrations and seed loader) |
| Deep pagination | Keyset pagination |
| Salary sort cost | Persisted, indexed USD column |
| Slow insights | Materialised aggregates refreshed on salary change |
| Slow text search | SQLite FTS5 / Postgres trigram index |
| More traffic | Stateless API → multiple instances behind a load balancer (after Postgres) |
| Bulk imports | Background job queue |

## Keeping this document honest
After the first build, this file was audited line by line against the code. It found five mismatches:
1. Cascade delete broke the "immutable history" promise.
2. SQL and the transaction API leaked outside the repository.
3. Totals were rounded per employee.
4. The insights query was described wrongly.
5. The FX date was shown on one page only.

Each was fixed in code (or the text corrected) in its own commit, and the repository rule is now enforced by a test. See `ai-usage.md`.
