import asyncio
import unittest
from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, patch

import pandas as pd
from fastapi import HTTPException

from app.crypto_data import MarketDataError, fetch_binance_ohlcv, fetch_binance_prices
from app.main import CRYPTO_ASSETS, _fetch_crypto_assets, get_crypto, get_crypto_prices


class BinanceMarketDataTests(unittest.TestCase):
    def test_fetches_and_converts_binance_candles(self) -> None:
        candle = [1792713600000, "100", "110", "90", "105", "12.5", 1792727999999]
        with patch("app.crypto_data._binance_json", return_value=[candle]) as request:
            bars = fetch_binance_ohlcv("BTCUSDT", "4h", date(2026, 10, 23), date(2026, 10, 23))

        self.assertEqual(request.call_args.args[0], "klines")
        self.assertEqual(request.call_args.args[1]["interval"], "4h")
        self.assertEqual(request.call_args.args[1]["limit"], 1000)
        self.assertEqual(len(bars), 1)
        self.assertEqual(bars.iloc[0].to_dict(), {
            "Open": 100.0,
            "High": 110.0,
            "Low": 90.0,
            "Close": 105.0,
            "Volume": 12.5,
        })
        self.assertEqual(bars.index[0].isoformat(), "2026-10-23T00:00:00+00:00")

    def test_paginates_candle_history_beyond_the_binance_limit(self) -> None:
        start_ms = int(datetime(2025, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
        four_hours = 4 * 60 * 60 * 1000
        page_one = [
            [
                start_ms + index * four_hours,
                "1",
                "2",
                "0.5",
                "1.5",
                "0.25",
                start_ms + (index + 1) * four_hours - 1,
            ]
            for index in range(1000)
        ]
        page_two = [[
            start_ms + 1000 * four_hours,
            "1",
            "2",
            "0.5",
            "1.5",
            "0.25",
            start_ms + 1001 * four_hours - 1,
        ]]
        with patch(
            "app.crypto_data._binance_json",
            side_effect=[page_one, page_two],
        ) as request:
            bars = fetch_binance_ohlcv("BTCUSDT", "4h", date(2025, 1, 1), date(2026, 1, 1))

        self.assertEqual(request.call_count, 2)
        self.assertEqual(len(bars), 1001)
        self.assertEqual(
            request.call_args_list[1].args[1]["startTime"],
            page_one[-1][6] + 1,
        )

    def test_fetches_current_prices_for_all_requested_pairs(self) -> None:
        symbols = {"BTC": "BTCUSDT", "ETH": "ETHUSDT"}
        with patch(
            "app.crypto_data._binance_json",
            return_value=[
                {"symbol": "BTCUSDT", "price": "100000.25"},
                {"symbol": "ETHUSDT", "price": "4000.5"},
            ],
        ) as request:
            prices = fetch_binance_prices(symbols)

        self.assertEqual(prices, {"BTC": 100000.25, "ETH": 4000.5})
        self.assertEqual(request.call_args.args[0], "ticker/price")
        self.assertEqual(request.call_args.args[1]["symbols"], '["BTCUSDT","ETHUSDT"]')

    def test_price_fetch_fails_explicitly_when_a_pair_is_missing(self) -> None:
        with patch("app.crypto_data._binance_json", return_value=[]):
            with self.assertRaisesRegex(MarketDataError, "no current price for: BTC"):
                fetch_binance_prices({"BTC": "BTCUSDT"})


class CryptoApiTests(unittest.TestCase):
    def test_crypto_endpoint_returns_calculated_indicator_data(self) -> None:
        index = pd.date_range("2026-01-01", periods=30, freq="D", tz="UTC")
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
        with patch("app.main.fetch_binance_ohlcv", return_value=bars) as fetch:
            result = asyncio.run(
                _fetch_crypto_assets(["BTC"], date(2026, 1, 1), date(2026, 1, 30))
            )

        asset = result["assets"][0]
        self.assertEqual(asset["name"], "BTC")
        self.assertEqual(asset["category"], "Layer 1")
        self.assertEqual(len(asset["prices"]["daily"]), 30)
        self.assertEqual(asset["prices"]["daily"][0]["volume"], 1000.0)
        self.assertEqual(len(asset["rsi"]["daily"]), 30)
        self.assertEqual(len(asset["ema10"]["daily"]), 30)
        self.assertEqual(fetch.call_count, 4)
        self.assertTrue(all(call.args[0] == "BTCUSDT" for call in fetch.call_args_list))

    def test_crypto_endpoint_rejects_unconfigured_symbols(self) -> None:
        with self.assertRaises(HTTPException) as error:
            asyncio.run(get_crypto(symbols=["NOTACOIN"]))

        self.assertEqual(error.exception.status_code, 422)

    def test_crypto_endpoint_uses_configured_public_usdt_pairs(self) -> None:
        self.assertEqual(CRYPTO_ASSETS["BTC"]["pair"], "BTCUSDT")
        self.assertEqual(CRYPTO_ASSETS["ETH"]["pair"], "ETHUSDT")
        with patch(
            "app.main._fetch_crypto_assets",
            new=AsyncMock(return_value={"assets": []}),
        ) as fetch:
            result = asyncio.run(get_crypto(symbols=["eth"]))

        self.assertEqual(result, {"assets": []})
        self.assertEqual(fetch.await_args.args[0], ["ETH"])

    def test_crypto_prices_endpoint_exposes_binance_quote_data(self) -> None:
        with patch(
            "app.main.fetch_binance_prices",
            return_value={"BTC": 100000.0},
        ) as fetch:
            result = asyncio.run(get_crypto_prices())

        self.assertEqual(result, {"prices": {"BTC": 100000.0}})
        self.assertEqual(fetch.call_args.args[0]["BTC"], "BTCUSDT")


if __name__ == "__main__":
    unittest.main()
