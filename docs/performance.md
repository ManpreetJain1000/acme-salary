# Performance

Measured, not assumed. Reproduce with `npm run bench --workspace api`, which seeds the full 10k into in-memory SQLite and times each path 50× after warm-up.

## Results

Shared cloud container, Node 22; runs vary ±30%. "Before" is the build prior to the scalability review; "after" is the current code. Insights are shown cold (first visit after a change) and warm (cached).

| Operation | 10k after | 100k before | **100k after** |
|---|---|---|---|
| Seed (employees + history, one transaction) | 0.8 s | 5 s | 8 s |
| Directory, first page, sort by name | 0.7 ms | 7 ms | **6 ms** |
| Directory, deepest page, sort by salary (USD) | 1.4 ms | 654 ms | **14 ms** |
| Directory, filter country + department | 1.3 ms | 20 ms | **19 ms** |
| Search "sharma" | 1.2 ms | 167 ms | **9 ms** |
| Employee + salary history | 0.1 ms | 0.2 ms | **0.2 ms** |
| Insights summary, whole org (cold) | 46 ms | 605 ms | **387 ms** |
| Insights page, 3 requests (warm, cached) | 0.1 ms | ~1,700 ms (no cache) | **0.1 ms** |
| Insights summary, one country (cold) | 2.7 ms | 44 ms | **31 ms** |

p50 shown; p95 is typically 1.2–1.5× higher. Reproduce: `npm run bench --workspace api` and `BENCH_COUNT=100000 npm run bench --workspace api`.

## What makes it fast enough
- **Indexes on every filter column**, plus:
  - `(country, job_title, salary_minor)` for pay groups;
  - `(status, full_name)` for the default page;
  - `(status, <USD salary expression>)` for the salary sort;
  - an FTS5 trigram index for search.

  Query-plan tests (`repository.test.ts`) fail if any of these stops being used.
- **Fresh planner statistics:** a full `ANALYZE` after seeding and `PRAGMA optimize` on every connection.
- **Insights cache** keyed by a data version that triggers maintain, so writes from any process invalidate it.
- **Server-side pagination** with a capped page size (100), so the browser never receives every row.
- **Seed in one transaction with reused prepared statements**, building the search index once at the end rather than per row.
- **WAL mode**, so reads continue while a write (or the seed) is in progress.
- **Client:** 300 ms debounced search, React Query caching, `keepPreviousData` so paging doesn't flash an empty table, and reference data fetched once (`staleTime: Infinity`).

## Regressions caught by re-measuring
| Change | Symptom | Cause | Fix |
|---|---|---|---|
| Status filter for leavers | First page 0.2 → 3 ms | Low-selectivity `status` index chosen, then every row sorted | `(status, full_name)` index (migration 4) |
| Salary expression index | Country filter 20 → 130 ms at 100k | No statistics: the planner used the new index for unrelated queries | Full `ANALYZE` after seed + `PRAGMA optimize` on open |
| Sampled `ANALYZE` (`analysis_limit`) | Same wrong plan | Approximate statistics | Full `ANALYZE` (~150 ms at 100k) |
| Search trigger | 100k seed 5 → 60 s | FTS indexing row by row | Rebuild the index once inside the seed transaction |

## Known costs, accepted at this scale
| Cost | Why it's fine now | What I'd do next |
|---|---|---|
| First insights visit after a change computes over every row (~0.4 s at 100k) | Cached afterwards; salaries change rarely | Precomputed aggregates updated on write, or Postgres `percentile_cont` |
| The synchronous SQLite driver blocks the event loop during a cold computation | Short at 10k; cached | Move heavy reads to a worker thread, or Postgres with an async driver |
| Each directory page also counts matching rows (6 ms at 100k) | Small | Approximate counts or keyset pagination at 1M+ |
| Offset pagination | 14 ms deepest page at 100k | Keyset pagination on `(sort_key, id)` |
| Single SQLite writer, one instance | One HR team | Postgres: the repository, migrations and seed loader change; services and routes don't |
