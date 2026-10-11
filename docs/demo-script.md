# Demo video script (3–4 minutes)

Tell it as the HR manager's day, not as a feature tour.

**0:00 · Problem (20 s)**
"ACME's HR team manages pay for 10,000 people in 10 countries in Excel. I built a tool so the HR manager can maintain salaries and answer questions about how we pay people." Show the README and `docs/requirements.md`, and point at the five questions table.

**0:20 · Find and update someone (60 s)** (Q1, Q5)
- Open the app: it redirects to sign-in. Use the demo sign-in, and point out that every API route needs a session.
- Employees page: "10,000 current employees". Search `sharma`, then `muller` (it finds "Müller": accent-insensitive full-text search).
- Filter Country = India, Department = Engineering. Sort by Salary and mention it sorts by USD equivalent across currencies.
- Open an employee. Show local salary, the ≈ USD value and the salary history timeline.
- Edit: give a 10% raise and save. The timeline shows a new "Raise +10%" entry, written in the same transaction as the update.
- Mark as left: pick the last day. They disappear from Current, appear under Former with their history intact, and drop out of insights. Mention that the database itself refuses to delete history. Reinstate to undo.

**1:20 · Data quality (30 s)**
- Add employee: submit empty to show validation. Enter an existing email to show the inline conflict error from the server. Pick Germany and the currency defaults to EUR.

**1:50 · Answer pay questions (70 s)** (Q2–Q4)
- Pay insights: headcount, payroll and median, all USD-normalised at the dated static rates.
- "Where does payroll go?" by country and by department.
- Job title = Senior Software Engineer: "What do we pay this role in India vs Germany?" The bar chart plus the p25/median/p75 table answer it.
- Outliers at ±40%: "who's paid unusually for their role and country?" Click one to open their record.

**3:00 · Engineering (40 s)**
- `npm test`: 50+ fast, deterministic tests (stats, money, seed atomicity/idempotency, API, injection attempts).
- `docs/decisions.md`: integer money, static FX, audit trail, SQLite now and the Postgres path later.
- `docs/ai-usage.md`: where the AI was wrong and how it was caught (salary sort across currencies).
- Commit history shows docs → domain → API → tests → UI → deploy → fixes.
