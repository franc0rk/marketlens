# MarketLens Angular frontend

Market indicator dashboard for the FastAPI stock service. It loads the saved
`stocks_last_year.txt` data through the API and includes candlesticks, Bollinger
Bands, RSI, and ADX charts.

## Run the frontend

```bash
npm start
```

Visit `http://localhost:4200`. FastAPI must be running on port 8000 so the
frontend can load the saved data and use the refresh controls.

## Refresh market data

Use **Refresh all** to fetch the full watchlist from the live API, or the
refresh icon on a ticker card to update only that symbol. A successful refresh
updates the saved `stocks_last_year.txt` cache used on the next page load. The
Angular development server proxies `/api` to `http://127.0.0.1:8000` using
`proxy.conf.json`.

Cards show prices in USD and MXN. The conversion uses the latest available
USD/MXN quote from Yahoo Finance; the quote date and any rate-loading errors
are shown on the dashboard.

## Build

```bash
npm run build
```
