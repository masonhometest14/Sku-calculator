# Mason Home frontend

This Next.js app hosts the full SKU profitability workspace. Run the Node.js API in `../backend`, then start Next.js:

```powershell
npm ci
npm run dev
```

Open <http://localhost:3000>. The frontend proxies `/api/*` to `http://localhost:8000` by default. Set `BACKEND_URL` when the API runs at another address.
