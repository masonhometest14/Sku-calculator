# Mason Home

SKU profitability project split into two services:

- `backend/` — Node.js and SQLite API
- `frontend/` — Next.js app containing the full user interface.

## Run locally

Start the API and database in one terminal:

```powershell
cd backend
npm ci
npm start
```

Start Next.js in a second terminal and open the full app at <http://localhost:3000>:

```powershell
cd frontend
npm ci
npm run dev
```

The backend at <http://localhost:8000> supplies the API and SQLite database. Set `BACKEND_URL` in the frontend environment if the API runs elsewhere.
