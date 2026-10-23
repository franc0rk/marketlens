import asyncio
import unittest
from datetime import date
from unittest.mock import patch

import pandas as pd
from fastapi import HTTPException

from app.indicators import (
    calculate_adx,
    calculate_bbands,
    calculate_bbands_position_streak,
    calculate_ema,
    calculate_rsi,
    rma,
)
from app.main import PROVIDER_SYMBOLS, STOCKS, _timeframe_result, get_stocks


class IndicatorTests(unittest.TestCase):
    def test_ema_uses_exponential_smoothing_after_length_warmup(self) -> None:
        close = pd.Series([1.0, 2.0, 3.0, 4.0])

        result = calculate_ema(close, length=3)

        self.assertTrue(pd.isna(result.iloc[1]))
        self.assertEqual(result.iloc[2], 2.25)
        self.assertEqual(result.iloc[3], 3.125)

    def test_rma_seeds_with_simple_average_then_uses_wilder_smoothing(self) -> None:
        values = pd.Series([1.0, 2.0, 3.0, 4.0])

        result = rma(values, length=3)

        self.assertTrue(pd.isna(result.iloc[1]))
        self.assertEqual(result.iloc[2], 2.0)
        self.assertEqual(result.iloc[3], 8 / 3)

    def test_rsi_is_100_for_a_rising_series_after_warmup(self) -> None:
        close = pd.Series(range(1, 18), dtype="float64")

        result = calculate_rsi(close, length=14)

        self.assertTrue(pd.isna(result.iloc[13]))
        self.assertEqual(result.iloc[14], 100.0)
        self.assertEqual(result.iloc[-1], 100.0)

    def test_bollinger_bands_use_population_standard_deviation(self) -> None:
        close = pd.Series([1.0, 2.0, 3.0])

        result = calculate_bbands(close, length=3, std_dev=2)

        self.assertAlmostEqual(result["middle"].iloc[-1], 2.0)
        self.assertAlmostEqual(result["upper"].iloc[-1], 2.0 + 2 * (2 / 3) ** 0.5)
        self.assertAlmostEqual(result["lower"].iloc[-1], 2.0 - 2 * (2 / 3) ** 0.5)

    def test_bbands_position_streak_counts_consecutive_bars_and_resets(self) -> None:
        close = pd.Series([1.0, 2.0, 1.0, 1.0, 3.0, 4.0])
        middle = pd.Series([2.0, 2.0, 2.0, 1.0, 2.0, 2.0])

        result = calculate_bbands_position_streak(close, middle)

        self.assertEqual(result.tolist(), [1, 0, 1, 0, 1, 2])

    def test_adx_is_bounded_for_a_monotonically_rising_market(self) -> None:
        close = pd.Series(range(1, 50), dtype="float64")
        high = close + 1
        low = close - 1

        result = calculate_adx(high, low, close, di_length=14, adx_smoothing=14)

        self.assertTrue(pd.isna(result.iloc[25]))
        self.assertAlmostEqual(result.iloc[-1], 100.0)

    def test_date_filter_keeps_indicator_warmup_bars(self) -> None:
        index = pd.date_range("2025-01-01", periods=30, freq="D")
        close = pd.Series(range(1, 31), index=index, dtype="float64")
        bars = pd.DataFrame(
            {
                "Open": close,
                "High": close + 1,
                "Low": close - 1,
                "Close": close,
                "Volume": 1000,
            },
            index=index,
        )

        result = _timeframe_result(bars, start=date(2025, 1, 21))

        self.assertEqual(result["timestamps"][0], "2025-01-21T00:00:00")
        self.assertEqual(len(result["rsi"]), 10)
        self.assertEqual(result["rsi"][0], 100.0)
        self.assertIsNotNone(result["ema10"][0])

    def test_stocks_endpoint_returns_all_configured_timeframes(self) -> None:
        index = pd.date_range("2025-01-01", periods=30, freq="D")
        close = pd.Series(range(1, 31), index=index, dtype="float64")
        bars = pd.DataFrame(
            {
                "Open": close,
                "High": close + 1,
                "Low": close - 1,
                "Close": close,
                "Volume": 1000,
            },
            index=index,
        )

        with patch("app.main.fetch_ohlcv", return_value=bars):
            response = asyncio.run(get_stocks(symbols=["AAPL"]))

        stock = response["stocks"][0]
        self.assertEqual(stock["name"], "AAPL")
        self.assertEqual(stock["category"], "Technology")
        self.assertEqual(set(stock["rsi"]), {"monthly", "weekly", "daily", "4h"})
        self.assertEqual(len(stock["bbands"]["daily"]), 30)
        self.assertEqual(len(stock["prices"]["daily"]), 30)
        self.assertEqual(len(stock["ema10"]["daily"]), 30)
        self.assertIsNotNone(stock["ema10"]["daily"][-1])
        self.assertTrue(all(value is None for value in stock["ema55"]["daily"]))
        self.assertEqual(stock["prices"]["daily"][0]["close"], 1.0)
        self.assertEqual(stock["bbands_position_streak"]["daily"], 11)

    def test_stocks_endpoint_rejects_unconfigured_symbols(self) -> None:
        with self.assertRaises(HTTPException) as error:
            asyncio.run(get_stocks(symbols=["UNKNOWN"]))
        self.assertEqual(error.exception.status_code, 422)

    def test_requested_symbols_are_configured_and_commodities_use_futures(self) -> None:
        requested = {
            "GOLD", "NVDA", "AAPL", "GOOG", "MSFT", "SILVER", "AMZN",
            "TSM", "SPCX", "META", "TSLA", "VOO", "V", "XOM", "JNJ",
            "PLTR", "INTC", "COST", "KO", "ORCL", "PG", "HD", "CAT",
            "NKE", "DELL", "NFLX", "BABA",
        }

        self.assertTrue(requested.issubset(STOCKS))
        self.assertEqual(PROVIDER_SYMBOLS["GOLD"], "GC=F")
        self.assertEqual(PROVIDER_SYMBOLS["SILVER"], "SI=F")

    def test_gold_is_fetched_using_yahoo_gold_futures_symbol(self) -> None:
        index = pd.date_range("2025-01-01", periods=30, freq="D")
        close = pd.Series(range(1, 31), index=index, dtype="float64")
        bars = pd.DataFrame(
            {
                "Open": close,
                "High": close + 1,
                "Low": close - 1,
                "Close": close,
                "Volume": 1000,
            },
            index=index,
        )

        with patch("app.main.fetch_ohlcv", return_value=bars) as fetch:
            response = asyncio.run(get_stocks(symbols=["GOLD"]))

        self.assertEqual(response["stocks"][0]["name"], "GOLD")
        self.assertEqual(fetch.call_count, 4)
        self.assertTrue(all(call.args[0] == "GC=F" for call in fetch.call_args_list))


if __name__ == "__main__":
    unittest.main()
