from __future__ import annotations

import asyncio
import json
from datetime import date
from pathlib import Path
from typing import Annotated

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from starlette.concurrency import run_in_threadpool

from app.indicators import (
    calculate_adx,
    calculate_bbands,
    calculate_bbands_position_streak,
    calculate_ema,
    calculate_rsi,
)
from app.market_data import MarketDataError, TIMEFRAMES, fetch_ohlcv, fetch_usd_mxn_rate

app = FastAPI(
    title="Stock Indicators API",
    description=(
        "OHLC prices and RSI, ADX, Bollinger Bands, and EMA 10/55 indicators."
    ),
    version="1.0.0",
)

STOCKS = {
    "GOLD": {"name": "GOLD", "category": "Commodities"},
    "NVDA": {"name": "NVDA", "category": "Technology"},
    "AAPL": {"name": "AAPL", "category": "Technology"},
    "GOOG": {"name": "GOOG", "category": "Communication Services"},
    "MSFT": {"name": "MSFT", "category": "Technology"},
    "SILVER": {"name": "SILVER", "category": "Commodities"},
    "AMZN": {"name": "AMZN", "category": "Consumer Discretionary"},
    "TSM": {"name": "TSM", "category": "Technology"},
    "SPCX": {"name": "SPCX", "category": "Aerospace"},
    "META": {"name": "META", "category": "Communication Services"},
    "TSLA": {"name": "TSLA", "category": "Automotive"},
    "VOO": {"name": "VOO", "category": "ETF"},
    "V": {"name": "V", "category": "Financial Services"},
    "XOM": {"name": "XOM", "category": "Energy"},
    "JNJ": {"name": "JNJ", "category": "Healthcare"},
    "PLTR": {"name": "PLTR", "category": "Technology"},
    "INTC": {"name": "INTC", "category": "Technology"},
    "COST": {"name": "COST", "category": "Consumer Staples"},
    "KO": {"name": "KO", "category": "Consumer Staples"},
    "ORCL": {"name": "ORCL", "category": "Technology"},
    "PG": {"name": "PG", "category": "Consumer Staples"},
    "HD": {"name": "HD", "category": "Consumer Discretionary"},
    "CAT": {"name": "CAT", "category": "Industrials"},
    "NKE": {"name": "NKE", "category": "Consumer Discretionary"},
    "DELL": {"name": "DELL", "category": "Technology"},
    "NFLX": {"name": "NFLX", "category": "Communication Services"},
    "BABA": {"name": "BABA", "category": "Consumer Discretionary"},
}

PROVIDER_SYMBOLS = {"GOLD": "GC=F", "SILVER": "SI=F"}
CACHE_FILE = Path(__file__).resolve().parent.parent / "stocks_last_year.txt"
CACHE_LOCK = asyncio.Lock()


def _json_number(value: float) -> float | None:
    return round(float(value), 4) if pd.notna(value) else None


def _timeframe_result(
    bars: pd.DataFrame,
    start: date | None = None,
    end: date | None = None,
) -> dict[str, object]:
    close = bars["Close"].astype("float64")
    ema10 = calculate_ema(close, length=10)
    ema55 = calculate_ema(close, length=55)
    rsi = calculate_rsi(close, length=14)
    adx = calculate_adx(
        bars["High"].astype("float64"),
        bars["Low"].astype("float64"),
        close,
        di_length=14,
        adx_smoothing=14,
    )
    bbands = calculate_bbands(close, length=20, std_dev=2.0)
    bbands_position_streak = calculate_bbands_position_streak(
        close, bbands["middle"]
    )
    selected = pd.Series(
        [
            (start is None or timestamp.date() >= start)
            and (end is None or timestamp.date() <= end)
            for timestamp in bars.index
        ],
        index=bars.index,
    )
    timestamps = bars.index[selected]
    selected_bars = bars.loc[selected]
    selected_streaks = bbands_position_streak.loc[selected]
    latest_streak = selected_streaks.iloc[-1] if not selected_streaks.empty else None
    return {
        "timestamps": [timestamp.isoformat() for timestamp in timestamps],
        "prices": [
            {
                "open": _json_number(row["Open"]),
                "high": _json_number(row["High"]),
                "low": _json_number(row["Low"]),
                "close": _json_number(row["Close"]),
                "volume": int(row["Volume"]) if pd.notna(row["Volume"]) else None,
            }
            for _, row in selected_bars.iterrows()
        ],
        "close": [_json_number(value) for value in close.loc[selected]],
        "ema10": [_json_number(value) for value in ema10.loc[selected]],
        "ema55": [_json_number(value) for value in ema55.loc[selected]],
        "rsi": [_json_number(value) for value in rsi.loc[selected]],
        "adx": [_json_number(value) for value in adx.loc[selected]],
        "bbands": [
            {
                "upper": _json_number(row["upper"]),
                "middle": _json_number(row["middle"]),
                "lower": _json_number(row["lower"]),
            }
            for _, row in bbands.loc[selected].iterrows()
        ],
        "bbands_position_streak": (
            None if latest_streak is None or pd.isna(latest_streak)
            else int(latest_streak)
        ),
    }


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/exchange-rate")
async def get_exchange_rate() -> dict[str, float | str]:
    try:
        return await run_in_threadpool(fetch_usd_mxn_rate)
    except MarketDataError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.get("/api/stocks")
async def get_stocks(
    start: Annotated[date | None, Query(description="First date to include (YYYY-MM-DD).")] = None,
    end: Annotated[date | None, Query(description="Last date to include (YYYY-MM-DD).")] = None,
    symbols: Annotated[
        list[str] | None,
        Query(description="Optional subset of configured symbols."),
    ] = None,
) -> dict[str, list[dict[str, object]]]:
    if start is not None and end is not None and start > end:
        raise HTTPException(status_code=422, detail="start must be on or before end.")

    requested = _requested_symbols(symbols)
    return await _fetch_stocks(requested, start, end)


def _requested_symbols(symbols: list[str] | None) -> list[str]:
    requested = [symbol.upper() for symbol in symbols] if symbols else list(STOCKS)
    unknown = sorted(set(requested) - STOCKS.keys())
    if unknown:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported symbol(s): {', '.join(unknown)}. "
            f"Choose from: {', '.join(STOCKS)}.",
        )
    return requested


async def _fetch_stocks(
    requested: list[str],
    start: date | None,
    end: date | None,
) -> dict[str, list[dict[str, object]]]:
    results: list[dict[str, object]] = []
    for symbol in requested:
        stock: dict[str, object] = {
            **STOCKS[symbol],
            "timestamps": {},
            "prices": {},
            "close": {},
            "ema10": {},
            "ema55": {},
            "rsi": {},
            "adx": {},
            "bbands": {},
            "bbands_position_streak": {},
        }
        try:
            for timeframe in TIMEFRAMES:
                bars = await run_in_threadpool(
                    fetch_ohlcv,
                    PROVIDER_SYMBOLS.get(symbol, symbol),
                    timeframe,
                    start,
                    end,
                )
                data = _timeframe_result(bars, start, end)
                for key, values in data.items():
                    timeframe_values = stock[key]
                    if not isinstance(timeframe_values, dict):
                        raise RuntimeError(f"Invalid response structure for {key}.")
                    timeframe_values[timeframe] = values
        except MarketDataError as error:
            raise HTTPException(status_code=502, detail=str(error)) from error
        results.append(stock)
    return {"stocks": results}


def _read_cached_stocks() -> dict[str, list[dict[str, object]]]:
    try:
        cached = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise HTTPException(
            status_code=500,
            detail=f"Could not read cached market data from {CACHE_FILE.name}: {error}",
        ) from error

    if (
        not isinstance(cached, dict)
        or not isinstance(cached.get("stocks"), list)
        or not all(
            isinstance(stock, dict) and isinstance(stock.get("name"), str)
            for stock in cached["stocks"]
        )
    ):
        raise HTTPException(
            status_code=500,
            detail=f"Cached market data in {CACHE_FILE.name} has an invalid format.",
        )
    for stock in cached["stocks"]:
        if "bbands_position_streak" not in stock:
            stock["bbands_position_streak"] = _cached_bbands_position_streaks(stock)
        for length in (10, 55):
            key = f"ema{length}"
            if key not in stock:
                stock[key] = _cached_ema_values(stock, length)
    return cached


def _cached_ema_values(
    stock: dict[str, object],
    length: int,
) -> dict[str, list[float | None]]:
    closes = stock.get("close")
    prices = stock.get("prices")
    values_by_timeframe: dict[str, list[float | None]] = {}
    for timeframe in TIMEFRAMES:
        values = closes.get(timeframe) if isinstance(closes, dict) else None
        if not isinstance(values, list):
            bars = prices.get(timeframe) if isinstance(prices, dict) else None
            if not isinstance(bars, list):
                continue
            values = [
                bar.get("close") if isinstance(bar, dict) else None
                for bar in bars
            ]
        ema = calculate_ema(pd.Series(values, dtype="float64"), length)
        values_by_timeframe[timeframe] = [
            _json_number(value) for value in ema
        ]
    return values_by_timeframe


def _cached_bbands_position_streaks(
    stock: dict[str, object],
) -> dict[str, int | None]:
    prices = stock.get("prices")
    bands = stock.get("bbands")
    if not isinstance(prices, dict) or not isinstance(bands, dict):
        return {}

    streaks: dict[str, int | None] = {}
    for timeframe in TIMEFRAMES:
        price_bars = prices.get(timeframe)
        band_bars = bands.get(timeframe)
        if not isinstance(price_bars, list) or not isinstance(band_bars, list):
            continue

        close_values = [
            bar.get("close") if isinstance(bar, dict) else None
            for bar in price_bars
        ]
        middle_values = [
            band.get("middle") if isinstance(band, dict) else None
            for band in band_bars
        ]
        close = pd.Series(close_values, dtype="float64")
        middle = pd.Series(middle_values, dtype="float64")
        values = calculate_bbands_position_streak(close, middle)
        latest = values.iloc[-1] if not values.empty else None
        streaks[timeframe] = (
            None if latest is None or pd.isna(latest) else int(latest)
        )
    return streaks


def _write_cached_stocks(data: dict[str, list[dict[str, object]]]) -> None:
    temporary_file = CACHE_FILE.with_name(f".{CACHE_FILE.name}.tmp")
    try:
        temporary_file.write_text(json.dumps(data), encoding="utf-8")
        temporary_file.replace(CACHE_FILE)
    except OSError as error:
        raise HTTPException(
            status_code=500,
            detail=f"Could not update cached market data in {CACHE_FILE.name}: {error}",
        ) from error


@app.get("/api/stocks/cache")
async def get_cached_stocks() -> dict[str, list[dict[str, object]]]:
    return _read_cached_stocks()


@app.post("/api/stocks/refresh")
async def refresh_stocks(
    start: Annotated[date | None, Query(description="First date to include (YYYY-MM-DD).")] = None,
    end: Annotated[date | None, Query(description="Last date to include (YYYY-MM-DD).")] = None,
    symbols: Annotated[
        list[str] | None,
        Query(description="Optional subset of configured symbols to refresh."),
    ] = None,
) -> dict[str, list[dict[str, object]]]:
    if start is not None and end is not None and start > end:
        raise HTTPException(status_code=422, detail="start must be on or before end.")

    requested = _requested_symbols(symbols)
    async with CACHE_LOCK:
        fresh = await _fetch_stocks(requested, start, end)
        if symbols:
            cached = _read_cached_stocks()
            fresh_by_name = {stock["name"]: stock for stock in fresh["stocks"]}
            merged_stocks = [
                fresh_by_name.pop(stock["name"], stock)
                for stock in cached["stocks"]
            ]
            merged_stocks.extend(fresh_by_name.values())
            updated = {"stocks": merged_stocks}
        else:
            updated = fresh

        _write_cached_stocks(updated)
        return updated
