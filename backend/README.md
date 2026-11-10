# Mason Home — SKU Profitability Calculator

Local Node.js and SQLite app for SKU unit economics, channel comparisons, buying analysis, and exports.

Backend code lives in `services/`: `server.js` starts the API, while `api.js`, `auth.js`, `products.js`, and `database.js` keep request handling, authentication, product operations, and SQLite logic separate.

## Run locally

Requires Node.js 24 or newer.

```powershell
cd backend
npm ci
npm run build
npm start
```

`npm run build` checks the backend JavaScript modules for syntax errors; Node runs these files directly without a compile step.

Load sample products when needed:

```powershell
npm run seed
```

Run the Next.js frontend in `../frontend` and open <http://localhost:3000>. The first visit asks you to create the workspace Admin account with a unique password of at least 12 characters. This service provides the API and SQLite database. SQLite is saved to `mason-home.db`; `.env.local` sets its path through `DATABASE_URL`.

## Included

- GST-exclusive unit economics with a startup assertion for the sample: ₹2,000 net revenue, ₹1,300 gross profit, ₹920 contribution before marketing, and ₹820 after marketing.
- Seven persistent channel profiles with independent prices, discounts, fees, rates, marketing, and monthly sales; percentage-based fees are included in break-even calculations.
- SQLite SKU records, monthly snapshots, immutable version history on changes, cost/tax audit trail, and manual Admin-only database backup.
- Password-hashed accounts and server-side role permissions for Admin, Finance, Buying, Marketing, and Management.
- Dashboard filters and weighted totals, product health classifications, inventory risk lists, and 2–5 SKU comparison.
- CSV and `.xlsx` import/export, with channel/category/supplier profitability reports.

## Operating limits

The server binds to `127.0.0.1`; this is a local single-process app, not a team-hosted deployment. For shared access, deploy behind HTTPS and a production server, restrict first-admin setup, and add scheduled/offsite backups. The current backup is manual. Shopify/marketplace sync and automatic inventory feeds are future work. Finance/CA should validate GST, HSN, and ITC eligibility.
