# Mason Home

SKU profitability project split into two folders:

- `backend/` — Node.js and SQLite API plus the existing local app.
- `frontend/` — Next.js App Router project, named `frontend`.

## Run locally

Start the backend in one terminal:

```powershell
cd backend
npm ci
npm start
```

Start the Next.js frontend in a second terminal:

```powershell
cd frontend
npm ci
npm run dev
```

The backend opens at <http://localhost:8000>; the frontend opens at <http://localhost:3000>.
