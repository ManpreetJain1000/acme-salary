# ACME Salary Manager — Requirements (one page)

## Goal
Replace the Excel workflow ACME's HR team uses to manage salary data for ~10,000 employees across multiple countries with a web app where an **HR Manager** can (1) maintain salary records reliably and (2) answer questions about how the organisation pays people.

## Persona & the questions they need answered
**HR Manager** — comfortable with Excel, not technical, accountable for pay fairness and payroll budget.

| # | Question | Feature that answers it |
|---|---|---|
| Q1 | "Find employee X and update their salary." | Directory with search, filters, edit form |
| Q2 | "What do we pay a *Senior Engineer* in *India* vs *Germany*?" | Pay bands: min / p25 / median / p75 / max by job title × country |
| Q3 | "Where does our payroll go?" | Headcount & total payroll (USD-normalised) by country and department |
| Q4 | "Who is paid unusually high/low for their role?" | Outlier list: salary far from the median of the same title + country |
| Q5 | "When did this person's salary change?" | Per-employee salary history (audit trail) |

## Scope (MVP)
- **Employee directory** — server-side pagination, search (name/email/code), filters (country, department, job title), sortable columns.
- **Create / edit / delete employee** with validation on both client and server.
- **Multi-currency salaries** — stored in the employee's local currency as integer minor units; USD-normalised at read time using a dated, static FX table so countries are comparable.
- **Salary history** — every salary change writes an immutable history row.
- **Insights dashboard** — answers Q2–Q4.
- **Seed script** — deterministic generation of 10,000 realistic employees.
- **Tests** — unit tests for core logic (stats, money/FX, validation, seed) + API integration tests.

## Deliberately out of scope (and why)
| Left out | Reasoning |
|---|---|
| Authentication / roles | Single persona, demo data. **First production gap** — plan: SSO + HR role, salary fields gated by role, access audit log. |
| Payroll processing, tax, payslips, bonuses, equity | A different product. The problem is *managing and understanding* pay, not paying people. |
| Live FX rates | Static dated rates keep numbers deterministic and testable; the rate date is shown in the UI. |
| Excel import / export | Highest-value next feature for this persona; cut for time, not value. |
| Gender / demographic pay-gap analysis | Sensitive data; seeded demographics would produce misleading conclusions. |
| Approval workflows, multi-tenancy, notifications | Not needed for one org with one HR manager. |
| Horizontal scaling infra | 10k rows fit comfortably in SQLite; the scaling path is documented in `decisions.md`, not built. |

## Non-functional requirements
- **Correctness of money** — no floating point storage; integer minor units; rounding only at display.
- **Performance** — list and insights endpoints < 100 ms on 10k rows; first page of UI interactive quickly.
- **Security hygiene** — schema validation on every input, parameterised SQL only, allow-listed sort/filter fields, capped page size, no stack traces or salary data in logs/errors.
- **Operability** — one command to install, seed and run; deterministic seed so demo, tests and deployment show the same data.

## Success criteria
An HR manager can, without help, find any employee in < 5 seconds, change a salary and see it reflected in history, and answer Q2–Q4 from the dashboard.
