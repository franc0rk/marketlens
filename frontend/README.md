# MarketLens Angular frontend

Market indicator dashboard for the FastAPI stock and crypto services. It
includes separate Stocks and Crypto pages with candlesticks, Bollinger Bands,
RSI, ADX, and EMA charts.

## Run the frontend

```bash
npm start
```

Visit `http://localhost:4200` for Stocks or `http://localhost:4200/crypto` for
Crypto. FastAPI must be running on port 8000 so the frontend can load market
data and use the refresh controls.

## Refresh market data

Use **Refresh all** to fetch the full watchlist from the live API, or the
refresh icon on a ticker card to update only that symbol. Stock refreshes
update the saved `stocks_last_year.txt` cache. Crypto spot quotes are polled
from Binance every five seconds; historical candles and indicators can be
refreshed manually. Crypto prices are quoted in USDT. The Angular development
server proxies `/api` to `http://127.0.0.1:8000` using `proxy.conf.json`.

Stock cards show prices in USD and MXN. The conversion uses the latest
available USD/MXN quote from Yahoo Finance; the quote date and any rate-loading
errors are shown on the dashboard.

## Build

```bash
npm run build
```
