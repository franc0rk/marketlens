import { describe, expect, it } from 'vitest';
import { parseAccountBalances, sharesAffordable } from './balances';

describe('account balance import', () => {
  it('reads the account balance and sums bond liquidity by platform', () => {
    const result = parseAccountBalances(
      JSON.stringify({
        totalBalanceUsd: 1_000,
        positions: [
          { group: 'bonds', platform: 'gbm', currentValueUsd: 125.5 },
          { group: 'stocks', platform: 'binance', currentValueUsd: 500 },
          { group: 'bonds', platform: 'binance', currentValueUsd: 74.5 },
          { group: 'bonds', platform: 'other', currentValueUsd: 20 },
        ],
      }),
    );

    expect(result).toEqual({
      totalBalanceUsd: 1_000,
      gbmLiquidityUsd: 125.5,
      binanceLiquidityUsd: 74.5,
    });
  });

  it('rejects invalid JSON and malformed balance exports', () => {
    expect(() => parseAccountBalances('{')).toThrow('not valid JSON');
    expect(() => parseAccountBalances(JSON.stringify({ positions: [] }))).toThrow(
      'totalBalanceUsd',
    );
    expect(() =>
      parseAccountBalances(
        JSON.stringify({
          totalBalanceUsd: 1_000,
          positions: [{ group: 'bonds', currentValueUsd: null }],
        }),
      ),
    ).toThrow('currentValueUsd');
  });

  it('calculates affordable whole shares and handles unavailable prices', () => {
    expect(sharesAffordable(1_000, 125)).toBe(8);
    expect(sharesAffordable(100, 125)).toBe(0);
    expect(sharesAffordable(1_000, null)).toBeNull();
    expect(sharesAffordable(1_000, 0)).toBeNull();
  });
});
