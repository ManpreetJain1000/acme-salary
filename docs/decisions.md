# Design decisions & trade-offs

Short records of the choices that shape the system. Each: decision → why → what it costs. Every claim here was checked against the code (see "Keeping this document honest" at the end).

## D1. TypeScript end to end (Express API + Next.js UI) in an npm-workspaces monorepo
- **Why:** one language and one mental model, so iteration is fast in a time-boxed build. The API is separate from the UI so business rules are testable without a framework and can be reused by other clients.
- **Cost:** two processes in dev, started together by `npm run dev`. API types are mirrored by hand in `web/src/lib/types.ts`. A shared package or generated client would remove that drift risk.

## D2. SQLite via `better-sqlite3`; all application SQL in the repository
- **Why:** 10k rows is tiny. SQLite needs no setup, and synchronous transactions keep the code simple and the tests fast (an in-memory database per test). `EmployeeRepository` is the only application code that knows SQL or the database library. Services state *what* must be atomic through `repo.transaction(fn)`; the repository decides *how*. `architecture.test.ts` fails the build if SQL appears anywhere else.
- **Scope of the claim:** the schema/migrations and backups (`db/`) and the bulk seed loader (`seed/seed.ts`) are storage-specific by nature and would be rewritten along with the store.
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
- **Cost:** a cold request reads the filtered set into memory: ~25–45 ms for the whole org at 10k, ~0.3–0.4 s at 100k. Results are cached until the data changes (D17). Beyond that, precompute aggregates or use Postgres `percentile_cont`.

## D7. Validation with `zod` at the API boundary; allow-lists for anything that reaches SQL
- **Why:** one schema gives runtime validation and TypeScript types. Sort keys are an allow-list in `schemas.ts`, mapped to SQL inside the repository. Filters are parameterised. LIKE wildcards are escaped. Page size is capped at 100. The client validates the same rules for fast feedback, but the API is the authority.

## D8. Deterministic, transactional, idempotent seed
- **Why:** the same data in tests, the demo and deployment. A seeded PRNG and a fixed reference date (never `now()`). One `BEGIN IMMEDIATE` transaction, so there is never a half-seeded state, with the "is it empty?" check inside it. Two processes booting at once can't double-seed, and readers are never blocked under WAL.
- **Reset:** history is append-only, so `--reset` drops and re-migrates the tables instead of deleting rows (DROP TABLE doesn't fire DELETE triggers). It's refused in production unless `ALLOW_RESET=true`.
- **Cost:** about 1% deliberate outliers are injected so the outlier view has signal. This is documented, not hidden.

## D9. One HR sign-in, protecting every API route
- **Why:** salary data must not be open to anyone with the link, even in a demo. There is one persona, so one HR account (email + password from the environment) is enough today.
- **How:**
  - Passwords are hashed with scrypt and a random salt, and compared in constant time.
  - A wrong password and an unknown email get the same answer and the same amount of work.
  - The session is an HMAC-signed token with an 8-hour expiry, in an HttpOnly, SameSite=Lax cookie (Secure in production).
  - Every route except health and sign-in returns 401 without a session; a test sweeps them all.
  - Failed sign-ins are rate limited (10 per 15 minutes per client).
  - Every POST must be JSON, which no cross-site HTML form can send: CSRF defence on top of SameSite.
  - Production refuses to boot without `HR_PASSWORD` and `SESSION_SECRET`.
  - The demo deployment opts in to showing its (synthetic-data) credentials on the login page; that's off by default in production.
- **Cost / next:**
  - Sessions are stateless, so one can only be revoked early by rotating the secret.
  - One shared account means there is no per-person audit of who viewed what.
  - SSO (OIDC), per-user roles and an access log are the next step; a sessions table would allow revocation.

## D10. Offset pagination
- **Why:** HR wants "page 7 of 400". With the indexes below, the deepest page takes ~1 ms at 10k and ~14 ms at 100k.
- **Path at scale:** keyset pagination on `(sort_key, id)`.

## D11. Salary sorts by USD equivalent, served from an expression index
- **Why:** sorting `salary_minor` across currencies is meaningless: ₹2,000,000 (≈ $22.6k) outranks $150,000, so every sort put India first. The sort uses a USD `CASE` expression built from the static FX constants, never from user input.
- **Index:** migration 6 indexes `(status, <that expression>)`, so the sort reads rows in order (deepest page at 100k: 654 → 14 ms). SQLite only uses an expression index when the query repeats the expression exactly, so the migration and the repository share one constant. A test fails if the FX rates change without a migration that rebuilds the index; results stay correct meanwhile, just unindexed.

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

## D17. Insights are cached until the data changes
- **Why:** each insights request read and grouped every employee, and the SQLite driver is synchronous. At 100k employees one dashboard visit (3 requests, ~0.5 s each) would block every other request for ~1.7 s. Salaries change rarely, so results are reused.
- **How:** migration 5 keeps a `data_version` that triggers bump on every employee write, from any connection or process (the seed CLI included). `InsightService` memoises each query until the version moves, bounded to 500 entries (oldest evicted).
- **Cost:** the first visit after a change still computes in full (~0.3–0.4 s per request at 100k, ~25–45 ms at 10k). **Next:** precomputed aggregates updated on write.

## D18. Search uses a full-text (FTS5 trigram) index
- **Why:** `LIKE '%term%'` scans every row (167 ms at 100k). The trigram tokenizer indexes substrings, so "harm" still finds "Sharma", and `remove_diacritics` lets "muller" find "Müller", which LIKE never did. Terms under 3 characters fall back to LIKE. Search input is quoted as one FTS phrase, so operators are literal.
- **Cost:** the index is kept in sync by triggers. Indexing row by row made a 100k bulk seed take ~60 s, so the seed sets that trigger aside inside its transaction and rebuilds the index once (8 s).

## D19. Planner statistics are kept fresh
- **Why:** adding an index without statistics made SQLite guess wrong. It used the new salary index for country filters (130 ms instead of 14 ms at 100k), and a *sampled* `ANALYZE` misled it the same way. The seed runs a full `ANALYZE` (~150 ms at 100k), and every connection runs `PRAGMA optimize` on open (SQLite's advice for long-lived connections). A query-plan test pins the expected index choices.

## D20. Request ids, structured logs, rate limiting, backups
- **Logs:**
  - Every response carries `X-Request-Id`, reused from the caller when well formed.
  - There is one JSON line per request: method, path, status, duration.
  - The path is logged without its query string, because search terms are people's names, and with numeric ids collapsed.
  - Unexpected errors log, and return, the request id but never internals.
- **Rate limiting:** 600 requests per minute per client on `/api` (configurable). Requests arrive through the Next.js proxy, so the API trusts `X-Forwarded-For` from loopback only. Limits therefore apply per real client, not per proxy. This relies on the hosting platform's load balancer appending the client address (Render does). The in-memory store is right for one instance; several instances would share a store such as Redis.
- **Backups:** SQLite's online backup API copies the live database safely while it is in use. Each copy is integrity-checked, and the newest 14 are kept. For continuous off-machine copies, use Litestream.

## Scaling review (measured, see performance.md)
- **Vertical:** at 100k employees (10× the brief) every directory query is under 20 ms, search 9 ms, and a cached insights page 0.1 ms. The remaining cost is the first insights visit after a change.
- **Horizontal: not yet, by design.** The database is a file in the container, so a second instance would have its own diverging data. The app code is otherwise stateless.

| Pressure | Change | Status |
|---|---|---|
| Slow insights | Cache per data version | **Done** (D17); precomputed aggregates next |
| Salary sort cost | Expression index | **Done** (D11) |
| Slow text search | FTS5 trigram index | **Done** (D18) |
| More data / concurrent writers / several instances | Postgres (repository, migrations, seed loader), migrations as a release step, shared rate-limit store | Documented |
| Deep pagination beyond ~1M | Keyset pagination | Documented |
| Bulk imports | Background job queue | Documented |

## Keeping this document honest
After the first build, this file was audited line by line against the code. It found five mismatches:
1. Cascade delete broke the "immutable history" promise.
2. SQL and the transaction API leaked outside the repository.
3. Totals were rounded per employee.
4. The insights query was described wrongly.
5. The FX date was shown on one page only.

Each was fixed in code (or the text corrected) in its own commit, and the repository rule is now enforced by a test. A second review asked "is it scalable?". It was answered by measuring at 100k employees, which led to D17–D20. See `ai-usage.md`.
