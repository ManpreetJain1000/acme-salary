# ACME Salary Manager

Web software for ACME's HR manager to **maintain salary data for 10,000 employees across 10 countries** and **answer questions about how the organisation pays people**, replacing a spreadsheet workflow.

**Live demo:** _add your deployed URL here_ · **Video walkthrough:** _add link_

| Employees | Pay insights |
|---|---|
| Search, filter, sort and paginate 10k employees; edit salaries with a full audit trail | Payroll by country and department, pay bands per role × country, outlier review |

## What it answers
1. *Find employee X and update their salary.* Directory with debounced search and filters, plus an edit drawer.
2. *What do we pay a Senior Engineer in India vs Germany?* Pay bands (min / p25 / median / p75 / max) per role × country, compared in USD.
3. *Where does payroll go?* Headcount and USD-normalised payroll by country and department.
4. *Who is paid unusually high or low for their role?* Outliers relative to the median of the same title in the same country.
5. *When did this salary change?* An immutable salary history per employee.

## Quick start

Requires Node 20+.

```bash
npm install
npm run dev      # API on :4000 (seeds 10k employees on first boot), web on :3000
```

Open http://localhost:3000.

| Command | What it does |
|---|---|
| `npm test` | All tests: API (unit + integration, in-memory SQLite) and web helpers, ~5 s |
| `npm run seed` | Seed if empty; `npm run seed -- --reset` to wipe and reseed (refused in production unless `ALLOW_RESET=true`) |
| `npm run bench --workspace api` | Benchmark hot paths on the full 10k seed |
| `docker build -t acme-salary . && docker run -p 3000:3000 acme-salary` | Production image |

## Deploy
The repo is one Docker image: Next.js is public and proxies `/api` to the API on an internal port.
- **Render:** New → Blueprint → pick this repo (`render.yaml`).
- **Railway / Fly / any Docker host:** deploy the `Dockerfile`; the platform's `PORT` is respected.

The database is seeded deterministically on first boot. On free tiers with ephemeral disks, edits reset on redeploy. Mount a volume at `/app/data` to keep them.

## Stack and why
- **API:** Node + TypeScript, Express 5, `better-sqlite3`, zod. A small, explicit stack with synchronous transactions.
- **DB:** SQLite (WAL). Right-sized for 10k rows; the repository layer is the only code that changes for Postgres.
- **UI:** Next.js (App Router) + Mantine + React Query + Mantine Charts.
- **Tests:** Vitest + Supertest, deterministic, no network, fixed clock and seed.

## Engineering highlights
- **Money is integer minor units** in the employee's local currency. USD is derived at read time from a dated static FX table and never stored over the original.
- **Every salary change writes history in the same transaction** as the update.
- **Seed:** a seeded PRNG and fixed reference date (same data everywhere); one `BEGIN IMMEDIATE` transaction (all or nothing); the emptiness check runs inside the transaction, so concurrent boots can't double-seed. 10k employees in ~0.4 s.
- **Security hygiene:**
  - zod validation on every input;
  - parameterised SQL only;
  - allow-listed sort fields;
  - LIKE wildcards escaped;
  - page size capped at 100;
  - helmet headers, 50 kb JSON limit, API not publicly exposed;
  - no stack traces or salary data in errors or logs.
- **Every screen has loading, empty and error states.**

## Documentation
- [Requirements (one page)](docs/requirements.md): goal, scope, deliberate exclusions
- [Design decisions & trade-offs](docs/decisions.md), including the scaling path
- [Architecture](docs/architecture.md): diagrams, data model, API
- [Performance](docs/performance.md): measured numbers and known costs
- [How AI was used](docs/ai-usage.md): workflow, prompts, **corrections log**
- [Demo script](docs/demo-script.md)

## Deliberately out of scope
Authentication (the first production gap; plan in `decisions.md`), payroll/tax, live FX, Excel import/export (the highest-value next feature), demographic pay-gap analysis. Reasons are in [requirements](docs/requirements.md).

## What I'd do next
1. SSO + HR role, with salary fields gated by role and an access audit log.
2. Excel/CSV import with a dry-run diff, plus export of any filtered view.
3. A persisted, indexed `salary_usd_minor` and keyset pagination ([performance](docs/performance.md)).
4. Scheduled FX refresh, with historical rates per salary change.
5. Compa-ratio against formal pay bands, once HR defines them.
