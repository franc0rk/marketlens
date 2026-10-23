import asyncio
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.main import get_exchange_rate
from app.market_data import MarketDataError


class ExchangeRateTests(unittest.TestCase):
    def test_returns_the_latest_usd_mxn_rate(self) -> None:
        expected = {"rate": 18.5, "date": "2026-10-22"}
        with patch("app.main.fetch_usd_mxn_rate", return_value=expected):
            result = asyncio.run(get_exchange_rate())

        self.assertEqual(result, expected)

    def test_reports_provider_failure_as_bad_gateway(self) -> None:
        with (
            patch(
                "app.main.fetch_usd_mxn_rate",
                side_effect=MarketDataError("No USD/MXN exchange-rate data returned."),
            ),
            self.assertRaises(HTTPException) as raised,
        ):
            asyncio.run(get_exchange_rate())

        self.assertEqual(raised.exception.status_code, 502)
        self.assertEqual(
            raised.exception.detail,
            "No USD/MXN exchange-rate data returned.",
        )


if __name__ == "__main__":
    unittest.main()
