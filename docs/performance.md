# Performance

Measured, not assumed. Reproduce with `npm run bench --workspace api`, which seeds the full 10k into in-memory SQLite and times each path 50× after warm-up.

## Results (10,000 employees, 13,256 history rows; cloud dev container, Node 22)

| Operation | p50 | p95 |
|---|---|---|
| Seed 10k employees + history (one transaction) | ~440 ms total | |
| Directory, first page, sort by name | 0.2 ms | 0.3 ms |
| Directory, last page (offset 9,975), sort by salary (USD) | 20 ms | 28 ms |
| Directory, filter country + department | 2.8 ms | 3.8 ms |
| Directory, search "sharma" (`LIKE '%x%'`) | 4.6 ms | 6.2 ms |
| Employee + salary history | 0.1 ms | 0.2 ms |
| Insights summary, whole org | 27 ms | 41 ms |
| Pay bands, all (country × title) groups | 17 ms | 25 ms |
| Outliers, all groups | 16 ms | 27 ms |
| Insights summary, one country | 2 ms | 3.6 ms |

End to end over HTTP through the Next proxy, every endpoint answered in under 65 ms on a cold first call.

## What makes it fast enough
- **Indexes on every filter column**, plus `(country, job_title, salary_minor)` for pay groups. `EXPLAIN QUERY PLAN` confirms filtered lists use an index.
- **Server-side pagination** with a capped page size (100), so the browser never receives the 10k rows.
- **Seed in one transaction with reused prepared statements.** Row-by-row autocommit would `fsync` 23k times and take far longer.
- **WAL mode**, so reads continue while a write (or the seed) is in progress.
- **Client:** 300 ms debounced search, React Query caching, `keepPreviousData` so paging doesn't flash an empty table, and reference data fetched once (`staleTime: Infinity`).

## Known costs, accepted at this scale
| Cost | Why it's fine now | What I'd do at 10–100× |
|---|---|---|
| Sort by salary computes a USD `CASE` expression → full scan + temp B-tree (20 ms) | 10k rows | Persist a `salary_usd_minor` column (recomputed when rates change) and index it |
| `LIKE '%term%'` can't use an index | 5 ms at 10k | SQLite FTS5 / Postgres `pg_trgm` |
| Insights read the filtered rows and compute percentiles in JS (SQLite has no `MEDIAN`) | ~10k small integers, < 45 ms p95 | Materialised aggregates refreshed on salary change, or Postgres `percentile_cont` |
| Offset pagination: deep pages scan skipped rows | 20 ms worst case | Keyset pagination on `(sort_key, id)` |
| Single SQLite writer | One HR team writing | Postgres; the repository layer is the only code that changes |
