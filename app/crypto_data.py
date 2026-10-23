from __future__ import annotations

import json
from datetime import date, datetime, time, timedelta, timezone
from math import isfinite
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen

import pandas as pd

from app.market_data import MarketDataError

BINANCE_API = "https://api.binance.com/api/v3"
CRYPTO_TIMEFRAMES = {
    "monthly": "1M",
    "weekly": "1w",
    "daily": "1d",
    "4h": "4h",
}
KLINE_COLUMNS = ("Open time", "Open", "High", "Low", "Close", "Volume", "Close time")


def _binance_json(endpoint: str, params: dict[str, str | int]) -> object:
    url = f"{BINANCE_API}/{endpoint}?{urlencode(params)}"
    try:
        with urlopen(url, timeout=15) as response:
            return json.loads(response.read())
    except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError) as error:
        raise MarketDataError(f"Binance request failed: {error}") from error


def fetch_binance_ohlcv(
    symbol: str,
    timeframe: str,
    start: date,
    end: date,
) -> pd.DataFrame:
    interval = CRYPTO_TIMEFRAMES.get(timeframe)
    if interval is None:
        raise ValueError(f"Unsupported timeframe: {timeframe}")

    start_time = int(datetime.combine(start, time.min, timezone.utc).timestamp() * 1000)
    end_time = int(datetime.combine(end + timedelta(days=1), time.min, timezone.utc).timestamp() * 1000) - 1
    candles: list[list[object]] = []
    while start_time <= end_time:
        payload = _binance_json(
            "klines",
            {
                "symbol": symbol,
                "interval": interval,
                "startTime": start_time,
                "endTime": end_time,
                "limit": 1000,
            },
        )
        if not isinstance(payload, list):
            raise MarketDataError(f"Binance returned an invalid candle response for {symbol}.")
        if not payload:
            break

        valid_rows = [row for row in payload if isinstance(row, list) and len(row) >= 7]
        if not valid_rows:
            raise MarketDataError(f"Binance returned malformed candle data for {symbol}.")
        candles.extend(valid_rows)
        try:
            next_start = int(valid_rows[-1][6]) + 1
        except (TypeError, ValueError) as error:
            raise MarketDataError(f"Binance returned malformed candle data for {symbol}.") from error
        if next_start <= start_time:
            raise MarketDataError(f"Binance returned non-advancing candle data for {symbol}.")
        start_time = next_start
        if len(payload) < 1000:
            break

    if not candles:
        raise MarketDataError(f"No market data returned for {symbol} ({timeframe}).")

    frame = pd.DataFrame(
        [{column: row[index] for index, column in enumerate(KLINE_COLUMNS)} for row in candles]
    )
    frame = frame.drop_duplicates(subset=["Open time"], keep="last")
    frame["Open time"] = pd.to_datetime(frame["Open time"], unit="ms", utc=True)
    frame.index = frame.pop("Open time")
    for column in ("Open", "High", "Low", "Close", "Volume"):
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    return frame.loc[:, ["Open", "High", "Low", "Close", "Volume"]].astype("float64")


def fetch_binance_prices(symbols: dict[str, str]) -> dict[str, float]:
    payload = _binance_json(
        "ticker/price",
        {"symbols": json.dumps(list(symbols.values()), separators=(",", ":"))},
    )
    if not isinstance(payload, list):
        raise MarketDataError("Binance returned an invalid ticker response.")

    prices: dict[str, float] = {}
    names_by_pair = {pair: name for name, pair in symbols.items()}
    for ticker in payload:
        if not isinstance(ticker, dict):
            continue
        name = names_by_pair.get(ticker.get("symbol"))
        try:
            price = float(ticker["price"])
        except (KeyError, TypeError, ValueError):
            continue
        if name and isfinite(price) and price > 0:
            prices[name] = price

    missing = sorted(set(symbols) - prices.keys())
    if missing:
        raise MarketDataError(f"Binance returned no current price for: {', '.join(missing)}.")
    return prices
