from __future__ import annotations

from datetime import date, datetime, timedelta
from math import isfinite

import pandas as pd
import yfinance as yf


TIMEFRAMES = {
    "monthly": "1mo",
    "weekly": "1wk",
    "daily": "1d",
    "4h": "4h",
}

INTRADAY_HISTORY_DAYS = 730


class MarketDataError(Exception):
    """Raised when the market-data provider cannot return usable price bars."""


def fetch_usd_mxn_rate() -> dict[str, float | str]:
    try:
        history = yf.Ticker("MXN=X").history(
            period="5d",
            interval="1d",
            auto_adjust=False,
            actions=False,
        )
    except Exception as error:
        raise MarketDataError(f"Yahoo Finance request failed for USD/MXN: {error}") from error

    if history.empty or "Close" not in history.columns:
        raise MarketDataError("No USD/MXN exchange-rate data returned.")

    closes = history["Close"].dropna()
    if closes.empty:
        raise MarketDataError("No usable USD/MXN exchange-rate data returned.")

    rate = float(closes.iloc[-1])
    if not isfinite(rate) or rate <= 0:
        raise MarketDataError("Yahoo Finance returned an invalid USD/MXN exchange rate.")

    timestamp = closes.index[-1]
    return {"rate": rate, "date": timestamp.date().isoformat()}


def fetch_ohlcv(
    symbol: str,
    timeframe: str,
    start: date | None = None,
    end: date | None = None,
) -> pd.DataFrame:
    if timeframe not in TIMEFRAMES:
        raise ValueError(f"Unsupported timeframe: {timeframe}")

    ticker = yf.Ticker(symbol)
    try:
        if timeframe == "4h":
            earliest = datetime.now().date() - timedelta(days=INTRADAY_HISTORY_DAYS)
            if start is not None and start < earliest:
                raise MarketDataError(
                    "Yahoo Finance only provides a limited hourly history; "
                    "4h data is available for roughly the most recent 730 days."
                )
            history = ticker.history(
                period="730d",
                interval="1h",
                auto_adjust=False,
                actions=False,
            )
            if history.empty:
                raise MarketDataError(f"No market data returned for {symbol}.")
            bars = history.resample(
                "4h", origin="start_day", offset="9h30min", label="left", closed="left"
            ).agg(
                {
                    "Open": "first",
                    "High": "max",
                    "Low": "min",
                    "Close": "last",
                    "Volume": "sum",
                }
            )
            bars = bars.dropna(subset=["Open", "High", "Low", "Close"])
        else:
            history = ticker.history(
                period="max",
                interval=TIMEFRAMES[timeframe],
                auto_adjust=False,
                actions=False,
            )
            bars = history
    except MarketDataError:
        raise
    except Exception as error:
        raise MarketDataError(
            f"Yahoo Finance request failed for {symbol} ({timeframe}): {error}"
        ) from error

    if bars.empty:
        raise MarketDataError(f"No market data returned for {symbol} ({timeframe}).")

    return bars
