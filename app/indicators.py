from __future__ import annotations

import pandas as pd


def calculate_ema(close: pd.Series, length: int) -> pd.Series:
    """Return the exponential moving average after ``length`` warmup bars."""
    if length < 1:
        return pd.Series(float("nan"), index=close.index, dtype="float64")
    return close.ewm(span=length, adjust=False, min_periods=length).mean()


def rma(values: pd.Series, length: int) -> pd.Series:
    """Wilder's moving average, seeded with the first ``length``-value SMA."""
    result = pd.Series(float("nan"), index=values.index, dtype="float64")
    if length < 1:
        return result

    valid_positions = values.notna().to_numpy().nonzero()[0]
    if len(valid_positions) < length:
        return result

    seed_position = valid_positions[length - 1]
    result.iloc[seed_position] = values.iloc[valid_positions[:length]].mean()
    for position in range(seed_position + 1, len(values)):
        current = values.iloc[position]
        result.iloc[position] = (
            result.iloc[position - 1]
            if pd.isna(current)
            else (
                result.iloc[position - 1] * (length - 1) + current
            )
            / length
        )
    return result


def calculate_rsi(close: pd.Series, length: int = 14) -> pd.Series:
    change = close.diff()
    gains = change.clip(lower=0)
    losses = -change.clip(upper=0)
    average_gain = rma(gains, length)
    average_loss = rma(losses, length)
    relative_strength = average_gain / average_loss
    return 100 - 100 / (1 + relative_strength)


def calculate_adx(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    di_length: int = 14,
    adx_smoothing: int = 14,
) -> pd.Series:
    upward_move = high.diff().fillna(0)
    downward_move = -low.diff().fillna(0)
    plus_dm = upward_move.where(
        (upward_move > downward_move) & (upward_move > 0), 0.0
    )
    minus_dm = downward_move.where(
        (downward_move > upward_move) & (downward_move > 0), 0.0
    )

    previous_close = close.shift(1)
    true_range = pd.concat(
        [
            high - low,
            (high - previous_close).abs(),
            (low - previous_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    smoothed_range = rma(true_range, di_length)
    plus_di = 100 * rma(plus_dm, di_length) / smoothed_range
    minus_di = 100 * rma(minus_dm, di_length) / smoothed_range
    di_sum = plus_di + minus_di
    dx = (100 * (plus_di - minus_di).abs() / di_sum).where(di_sum != 0)
    return rma(dx, adx_smoothing)


def calculate_bbands(
    close: pd.Series, length: int = 20, std_dev: float = 2.0
) -> pd.DataFrame:
    middle = close.rolling(window=length, min_periods=length).mean()
    deviation = close.rolling(window=length, min_periods=length).std(ddof=0)
    return pd.DataFrame(
        {
            "upper": middle + std_dev * deviation,
            "middle": middle,
            "lower": middle - std_dev * deviation,
        },
        index=close.index,
    )


def calculate_bbands_position_streak(
    close: pd.Series, middle: pd.Series
) -> pd.Series:
    """Return consecutive bars on the same side of the middle band."""
    streaks: list[int | None] = []
    previous_position: str | None = None
    streak = 0

    for price, middle_value in zip(close, middle.reindex(close.index)):
        if pd.isna(price) or pd.isna(middle_value):
            streaks.append(None)
            previous_position = None
            streak = 0
            continue

        position = "below" if price < middle_value else "above" if price > middle_value else "at"
        if position == "at":
            streak = 0
        elif position == previous_position:
            streak += 1
        else:
            streak = 1

        streaks.append(streak)
        previous_position = position

    return pd.Series(streaks, index=close.index, dtype="Int64")
