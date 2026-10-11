# Performance

Measured, not assumed. Reproduce with `npm run bench --workspace api`, which seeds the full 10k into in-memory SQLite and times each path 50× after warm-up.

## Results (10,000 employees, 13,256 history rows; shared cloud container, Node 22; runs vary ±30%)

| Operation | p50 | p95 |
|---|---|---|
| Seed 10k employees + history (one transaction) | ~450 ms total | |
| Directory, first page of current employees, sort by name (incl. count) | 0.9 ms | 1.7 ms |
| Directory, last page (offset 9,975), sort by salary (USD) | 30 ms | 38 ms |
| Directory, filter country + department | 1.5 ms | 2.0 ms |
| Directory, search "sharma" (`LIKE '%x%'`) | 9 ms | 14 ms |
| Employee + salary history | 0.2 ms | 0.4 ms |
| Insights summary, whole org | 40 ms | 58 ms |
| Pay bands, all (country × title) groups | 23 ms | 30 ms |
| Outliers, all groups | 29 ms | 45 ms |
| Insights summary, one country | 2.5 ms | 4.1 ms |

End to end over HTTP through the Next proxy, every endpoint answered in under 65 ms on a cold first call.

## What makes it fast enough
- **Indexes on every filter column**, plus `(country, job_title, salary_minor)` for pay groups and `(status, full_name)` for the default page. `EXPLAIN QUERY PLAN` confirms filtered lists use an index.
- **A regression caught by re-measuring:** adding the "current employees only" filter made SQLite pick the low-selectivity `status` index and sort every row in a temp B-tree (first page 0.2 → 3 ms). Migration 4 replaced it with `(status, full_name)`.
- **Server-side pagination** with a capped page size (100), so the browser never receives the 10k rows.
- **Seed in one transaction with reused prepared statements.** Row-by-row autocommit would `fsync` 23k times and take far longer.
- **WAL mode**, so reads continue while a write (or the seed) is in progress.
- **Client:** 300 ms debounced search, React Query caching, `keepPreviousData` so paging doesn't flash an empty table, and reference data fetched once (`staleTime: Infinity`).

## Known costs, accepted at this scale
| Cost | Why it's fine now | What I'd do at 10–100× |
|---|---|---|
| Sort by salary computes a USD `CASE` expression → full scan + temp B-tree (~30 ms) | 10k rows | Persist a `salary_usd_minor` column (recomputed when rates change) and index it |
| `LIKE '%term%'` can't use an index | ~9 ms at 10k | SQLite FTS5 / Postgres `pg_trgm` |
| Insights read the filtered rows and compute percentiles in JS (SQLite has no `MEDIAN`) | ~10k narrow rows, < 60 ms p95 | Materialised aggregates refreshed on salary change, or Postgres `percentile_cont` |
| Offset pagination: deep pages scan skipped rows | ~30 ms worst case | Keyset pagination on `(sort_key, id)` |
| Single SQLite writer | One HR team writing | Postgres: the repository, migrations and seed loader change; services and routes don't |
