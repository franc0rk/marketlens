export interface AccountBalances {
  totalBalanceUsd: number;
  gbmLiquidityUsd: number;
  binanceLiquidityUsd: number;
}

export function parseAccountBalances(contents: string): AccountBalances {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('The JSON must contain an account export object.');
  }

  const data = parsed as Record<string, unknown>;
  if (!isNonNegativeNumber(data['totalBalanceUsd'])) {
    throw new Error('The export must contain a valid totalBalanceUsd value.');
  }
  if (!Array.isArray(data['positions'])) {
    throw new Error('The export must contain a positions array.');
  }

  let gbmLiquidityUsd = 0;
  let binanceLiquidityUsd = 0;
  for (const position of data['positions']) {
    if (typeof position !== 'object' || position === null || Array.isArray(position)) {
      throw new Error('Each position in the export must be an object.');
    }
    const candidate = position as Record<string, unknown>;
    if (candidate['group'] === 'bonds') {
      if (!isNonNegativeNumber(candidate['currentValueUsd'])) {
        throw new Error('Bond positions must contain a valid currentValueUsd value.');
      }
      if (candidate['platform'] === 'gbm') {
        gbmLiquidityUsd += candidate['currentValueUsd'];
      } else if (candidate['platform'] === 'binance') {
        binanceLiquidityUsd += candidate['currentValueUsd'];
      }
    }
  }

  return {
    totalBalanceUsd: data['totalBalanceUsd'],
    gbmLiquidityUsd,
    binanceLiquidityUsd,
  };
}

export function sharesAffordable(budgetUsd: number, priceUsd: number | null | undefined): number | null {
  if (
    !Number.isFinite(budgetUsd) ||
    budgetUsd < 0 ||
    priceUsd == null ||
    !Number.isFinite(priceUsd) ||
    priceUsd <= 0
  ) {
    return null;
  }
  return Math.floor(budgetUsd / priceUsd);
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
