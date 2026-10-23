# Stock Indicators Dashboard

A local stock and cryptocurrency dashboard with a FastAPI backend and Angular
frontend. It displays prices and technical indicators for configured stocks,
ETFs, gold/silver futures, and USDT crypto pairs.

## Market data provider

This starter uses Yahoo Finance through the open-source `yfinance` package, so
you do not need an API key to test it. `yfinance` is not affiliated with Yahoo
and uses publicly available endpoints. Yahoo's finance data is intended for
personal use; check Yahoo's terms before using this in a commercial or
production service. Provider limits, availability, and terms can change.

Yahoo does not offer a native 4-hour interval through `yfinance`; the API
aggregates hourly bars into 4-hour bars. Yahoo limits hourly history to roughly
730 days. A request for 4-hour data starting earlier than that returns a clear
provider error; daily, weekly, and monthly intervals can use older data.

Crypto market data comes from Binance's public Spot REST API and requires no
API key. The dashboard includes BTC, ETH, BNB, SOL, XRP, ADA, DOGE, TRX, AVAX,
and LINK, all quoted in USDT. Its live quote endpoint is polled every five
seconds; historical candles and indicators are loaded separately and can be
refreshed from the Crypto page. Binance availability, API limits, regional
access, and terms can change; check Binance's current terms before commercial
or production use.

## Quick start

### Requirements

- Python 3.10 or newer
- Node.js 22 or newer and npm
- Internet access to fetch or refresh live market data

### 1. Start the API

From the project root, create and activate a Python virtual environment, then
install the backend dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
uvicorn app.main:app --reload
```

On Windows PowerShell, activate the environment with
`.venv\Scripts\Activate.ps1` instead. Keep this terminal running.

### 2. Start the dashboard

In a second terminal, install the frontend dependencies and start Angular:

```bash
cd frontend
npm ci
npm start
```

Open [http://localhost:4200](http://localhost:4200) for Stocks, or
[http://localhost:4200/crypto](http://localhost:4200/crypto) for Crypto. The
Stocks page uses the included `stocks_last_year.txt` cache; crypto history and
live quotes are loaded from Binance. Refreshing market data requires internet
access.

The API is available at [http://127.0.0.1:8000](http://127.0.0.1:8000), with
interactive documentation at [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs).

## Run tests

With the virtual environment activated, run:

```bash
python -m unittest discover -s tests -v
```

To build the frontend:

```bash
cd frontend
npm run build
```

## Endpoint

`GET /api/stocks`

Optional query parameters:

- `symbols`: repeated symbol parameter, limited to the configured stocks, e.g.
  `?symbols=AAPL&symbols=MSFT`. Gold and silver use Yahoo futures symbols
  `GC=F` and `SI=F`, exposed as `GOLD` and `SILVER`.
- `start`: first date to include, `YYYY-MM-DD`.
- `end`: last date to include, `YYYY-MM-DD`.

Example:

```text
GET /api/stocks?symbols=AAPL&start=2025-01-01&end=2025-06-30
```

`GET /api/stocks/cache` reads the saved `stocks_last_year.txt` response.
`POST /api/stocks/refresh` fetches fresh data and saves it to that file; it
accepts the same optional `symbols`, `start`, and `end` parameters.
`GET /api/exchange-rate` returns the latest available USD/MXN rate and quote
date used to display MXN-converted prices in the dashboard.

`GET /api/crypto` returns one year of candle and indicator data for the
configured crypto assets. It accepts repeated `symbols` parameters, e.g.
`?symbols=BTC&symbols=ETH`. `GET /api/crypto/prices` returns the current
Binance spot quotes in USDT for the configured assets; the frontend polls this
endpoint every five seconds.

Each market asset has `timestamps`, `prices`, `close`, `ema10`, `ema55`, `rsi`, `adx`,
and `bbands` mappings keyed by timeframe. `prices` contains OHLCV bars. Arrays
at the same timeframe index refer to the same bar.
Indicator values are `null` until sufficient warmup data exists. EMA values use
the close price with `2 / (length + 1)` smoothing and become available after
their respective 10- and 55-bar warmup. Bollinger Bands are returned as
`{upper, middle, lower}` values per bar.
Each stock also includes `bbands_position_streak`, a per-timeframe count of
consecutive bars whose close is above or below the middle band (zero when at
the middle, or `null` before the bands are available). Counts use each
timeframe's own bars, so daily values count days, weekly values count weeks,
monthly values count months, and 4-hour values count 4-hour bars.

The supported symbols and categories are defined in `app/main.py`. `APPL` in
the initial request is interpreted as a typo for `AAPL` (Apple Inc.).

## Indicator settings

- RSI: close source, length 14, Wilder's RMA smoothing.
- ADX: DI length 14, ADX smoothing 14, Wilder's RMA smoothing.
- Bollinger Bands: close source, length 20, 2 standard deviations, offset 0,
  population standard deviation.
- EMA: close source, lengths 10 and 55, exponential smoothing.

Indicator values are rounded to four decimal places in JSON.

## Angular dashboard

The Angular frontend lives in [`frontend/`](./frontend/README.md). Its
development server proxies `/api` requests to FastAPI on port 8000. The
dashboard loads the saved `stocks_last_year.txt` data through
`GET /api/stocks/cache`. Its refresh controls fetch current data from Yahoo
Finance and write the refreshed response back to that file; the ticker-level
control updates only that symbol in the cache.

`POST /api/stocks/refresh` refreshes the full watchlist. Add a repeated
`symbols` query parameter (for example, `?symbols=AAPL`) to refresh selected
symbols. The frontend development server proxies these API requests to port
8000.
