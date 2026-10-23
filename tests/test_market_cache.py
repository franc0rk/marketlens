import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from app.main import get_cached_stocks, refresh_stocks


class MarketDataCacheTests(unittest.TestCase):
    def test_cached_endpoint_reads_saved_text_file(self) -> None:
        cached = {"stocks": [{"name": "AAPL", "category": "Technology"}]}
        with tempfile.TemporaryDirectory() as directory:
            cache_file = Path(directory) / "stocks_last_year.txt"
            cache_file.write_text(json.dumps(cached), encoding="utf-8")
            with patch("app.main.CACHE_FILE", cache_file):
                result = asyncio.run(get_cached_stocks())

        self.assertEqual(
            result,
            {
                "stocks": [
                    {
                        "name": "AAPL",
                        "category": "Technology",
                        "bbands_position_streak": {},
                        "ema10": {},
                        "ema55": {},
                    }
                ]
            },
        )

    def test_cached_endpoint_adds_streaks_to_legacy_market_data(self) -> None:
        cached = {
            "stocks": [
                {
                    "name": "AAPL",
                    "prices": {
                        timeframe: [{"close": 1.0}, {"close": 2.0}, {"close": 3.0}]
                        for timeframe in ("monthly", "weekly", "daily", "4h")
                    },
                    "bbands": {
                        timeframe: [
                            {"middle": 2.0},
                            {"middle": 2.0},
                            {"middle": 2.0},
                        ]
                        for timeframe in ("monthly", "weekly", "daily", "4h")
                    },
                }
            ]
        }
        with tempfile.TemporaryDirectory() as directory:
            cache_file = Path(directory) / "stocks_last_year.txt"
            cache_file.write_text(json.dumps(cached), encoding="utf-8")
            with patch("app.main.CACHE_FILE", cache_file):
                result = asyncio.run(get_cached_stocks())

        self.assertEqual(
            result["stocks"][0]["bbands_position_streak"],
            {"monthly": 1, "weekly": 1, "daily": 1, "4h": 1},
        )
        self.assertEqual(len(result["stocks"][0]["ema10"]["daily"]), 3)
        self.assertTrue(
            all(value is None for value in result["stocks"][0]["ema55"]["daily"])
        )

    def test_cached_endpoint_adds_ema_values_to_legacy_market_data(self) -> None:
        cached = {
            "stocks": [
                {
                    "name": "AAPL",
                    "close": {
                        timeframe: list(map(float, range(1, 61)))
                        for timeframe in ("monthly", "weekly", "daily", "4h")
                    },
                }
            ]
        }
        with tempfile.TemporaryDirectory() as directory:
            cache_file = Path(directory) / "stocks_last_year.txt"
            cache_file.write_text(json.dumps(cached), encoding="utf-8")
            with patch("app.main.CACHE_FILE", cache_file):
                result = asyncio.run(get_cached_stocks())

        stock = result["stocks"][0]
        self.assertEqual(len(stock["ema10"]["daily"]), 60)
        self.assertEqual(len(stock["ema55"]["daily"]), 60)
        self.assertIsNone(stock["ema10"]["daily"][8])
        self.assertIsNotNone(stock["ema10"]["daily"][9])
        self.assertIsNotNone(stock["ema55"]["daily"][54])

    def test_refreshing_one_symbol_merges_and_persists_the_cache(self) -> None:
        cached = {
            "stocks": [
                {"name": "AAPL", "category": "Technology", "value": "old"},
                {"name": "MSFT", "category": "Technology", "value": "unchanged"},
            ]
        }
        refreshed = {"name": "AAPL", "category": "Technology", "value": "new"}
        with tempfile.TemporaryDirectory() as directory:
            cache_file = Path(directory) / "stocks_last_year.txt"
            cache_file.write_text(json.dumps(cached), encoding="utf-8")
            with (
                patch("app.main.CACHE_FILE", cache_file),
                patch(
                    "app.main._fetch_stocks",
                    new=AsyncMock(return_value={"stocks": [refreshed]}),
                ) as fetch_stocks,
            ):
                result = asyncio.run(refresh_stocks(symbols=["aapl"]))
                saved = json.loads(cache_file.read_text(encoding="utf-8"))

        fetch_stocks.assert_awaited_once()
        self.assertEqual([stock["name"] for stock in result["stocks"]], ["AAPL", "MSFT"])
        self.assertEqual(result["stocks"][0]["value"], "new")
        self.assertEqual(result["stocks"][1]["value"], "unchanged")
        self.assertEqual(saved, result)

    def test_full_refresh_replaces_cache_with_live_response(self) -> None:
        refreshed = {"stocks": [{"name": "AAPL", "value": "live"}]}
        with tempfile.TemporaryDirectory() as directory:
            cache_file = Path(directory) / "stocks_last_year.txt"
            with (
                patch("app.main.CACHE_FILE", cache_file),
                patch(
                    "app.main._fetch_stocks",
                    new=AsyncMock(return_value=refreshed),
                ),
            ):
                result = asyncio.run(refresh_stocks())
                saved = json.loads(cache_file.read_text(encoding="utf-8"))

        self.assertEqual(result, refreshed)
        self.assertEqual(saved, refreshed)


if __name__ == "__main__":
    unittest.main()
