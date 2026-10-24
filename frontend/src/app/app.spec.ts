import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { Stock, StockDataService, TimeframeValue, TimeframeValues } from './stock-data';

const emptyTimeframes = <T>(): TimeframeValues<T> => ({
  monthly: [],
  weekly: [],
  daily: [],
  '4h': [],
});

const stock: Stock = {
  name: 'TEST',
  category: 'Test',
  timestamps: emptyTimeframes<string>(),
  prices: emptyTimeframes<Stock['prices']['daily'][number]>(),
  close: emptyTimeframes<number | null>(),
  ema10: emptyTimeframes<number | null>(),
  ema55: emptyTimeframes<number | null>(),
  rsi: emptyTimeframes<number | null>(),
  adx: emptyTimeframes<number | null>(),
  bbands: emptyTimeframes<Stock['bbands']['daily'][number]>(),
  bbands_position_streak: {
    monthly: null,
    weekly: null,
    daily: null,
    '4h': null,
  } satisfies TimeframeValue<number | null>,
};

const stockDataMock = {
  getStocks: vi.fn(() => of({ stocks: [stock] })),
  getMarketAssets: vi.fn((market: 'stocks' | 'crypto') =>
    of({
      stocks: [
        market === 'crypto' ? { ...stock, category: 'Layer 1' } : stock,
      ],
    }),
  ),
  getUsdMxnRate: vi.fn(() => of({ rate: 1, date: '2026-10-23' })),
  refreshStocks: vi.fn(() => of({ stocks: [stock] })),
  refreshMarketAssets: vi.fn(() => of({ stocks: [stock] })),
  getCryptoPrices: vi.fn(() => of({ prices: { TEST: 123.45 } })),
};

const preferencesStorageKey = 'marketlens.stock-list-preferences';

describe('App', () => {
  let fixture: ComponentFixture<App> | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.removeItem(preferencesStorageKey);
    localStorage.removeItem('marketlens.crypto-list-preferences');
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        { provide: StockDataService, useValue: stockDataMock },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    fixture?.destroy();
    fixture = undefined;
    vi.useRealTimers();
    localStorage.removeItem(preferencesStorageKey);
    localStorage.removeItem('marketlens.crypto-list-preferences');
    TestBed.resetTestingModule();
  });

  it('persists and restores stock list filters and sorting', () => {
    fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;

    const nameInput = page.querySelector<HTMLInputElement>('input[type="search"]');
    const categorySelect = page.querySelector<HTMLSelectElement>(
      '.filter-controls select',
    );
    const sortSelect = page.querySelector<HTMLSelectElement>('.sort-field select');
    if (!nameInput || !categorySelect || !sortSelect) {
      throw new Error('Could not find the stock list preference controls.');
    }

    nameInput.value = 'test';
    nameInput.dispatchEvent(new Event('input'));
    categorySelect.value = 'Test';
    categorySelect.dispatchEvent(new Event('change'));
    sortSelect.value = 'price';
    sortSelect.dispatchEvent(new Event('change'));

    expect(localStorage.getItem(preferencesStorageKey)).toBe(
      JSON.stringify({
        nameFilter: 'test',
        categoryFilter: 'Test',
        sortField: 'price',
      }),
    );

    fixture.destroy();
    fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const restoredPage = fixture.nativeElement as HTMLElement;
    expect(restoredPage.querySelector<HTMLInputElement>('input[type="search"]')?.value).toBe(
      'test',
    );
    expect(
      restoredPage.querySelector<HTMLSelectElement>('.filter-controls select')?.value,
    ).toBe('Test');
    expect(
      restoredPage.querySelector<HTMLSelectElement>('.sort-field select')?.value,
    ).toBe('price');
  });

  it('clears stored filters without resetting the selected sort', () => {
    localStorage.setItem(
      preferencesStorageKey,
      JSON.stringify({
        nameFilter: 'test',
        categoryFilter: 'Test',
        sortField: 'price',
      }),
    );
    fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;
    clickButton(page, '.clear-filters-button');

    expect(localStorage.getItem(preferencesStorageKey)).toBe(
      JSON.stringify({
        nameFilter: '',
        categoryFilter: '',
        sortField: 'price',
      }),
    );
  });

  it('imports account balances and shows purchasable shares for the displayed stocks', async () => {
    const pricedStock: Stock = {
      ...stock,
      prices: {
        ...emptyTimeframes<Stock['prices']['daily'][number]>(),
        daily: [{ open: 125, high: 125, low: 125, close: 125, volume: 1 }],
      },
    };
    const otherPricedStock: Stock = {
      ...pricedStock,
      name: 'ALT',
      prices: {
        ...emptyTimeframes<Stock['prices']['daily'][number]>(),
        daily: [{ open: 200, high: 200, low: 200, close: 200, volume: 1 }],
      },
    };
    stockDataMock.getMarketAssets.mockReturnValueOnce(
      of({ stocks: [pricedStock, otherPricedStock] }),
    );
    vi.useFakeTimers();
    fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;

    clickButton(page, '.import-balances-button');
    fixture.detectChanges();
    expect(page.querySelector('[role="dialog"]')?.textContent).toContain(
      'Drop your export.json file here',
    );

    const file = new File(
      [
        JSON.stringify({
          totalBalanceUsd: 1_000,
          positions: [
            { group: 'bonds', platform: 'gbm', currentValueUsd: 1_250 },
            { group: 'bonds', platform: 'binance', currentValueUsd: 625 },
            { group: 'crypto', currentValueUsd: 9_000 },
          ],
        }),
      ],
      'export.json',
      { type: 'application/json' },
    );
    Object.defineProperty(file, 'text', {
      value: () =>
        Promise.resolve(
          JSON.stringify({
            totalBalanceUsd: 1_000,
            positions: [
              { group: 'bonds', platform: 'gbm', currentValueUsd: 1_250 },
              { group: 'bonds', platform: 'binance', currentValueUsd: 625 },
              { group: 'crypto', currentValueUsd: 9_000 },
            ],
          }),
        ),
    });
    const dropzone = page.querySelector('.balance-dropzone');
    if (!dropzone) {
      throw new Error('Could not find the balance import dropzone.');
    }
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: { files: [file] },
    });
    dropzone.dispatchEvent(dropEvent);
    await Promise.resolve();
    fixture.detectChanges();

    expect(page.querySelector('.balance-dropzone')?.textContent).toContain(
      'Scanning export.json',
    );
    vi.advanceTimersByTime(1_200);
    fixture.detectChanges();

    const rows = page.querySelectorAll('.balance-table tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelectorAll('td')[0]?.textContent?.trim()).toBe('ALT');
    expect(rows[0]?.querySelectorAll('td')[2]?.textContent?.trim()).toBe('5');
    expect(rows[1]?.querySelectorAll('td')[0]?.textContent?.trim()).toBe('TEST');
    expect(rows[1]?.querySelectorAll('td')[2]?.textContent?.trim()).toBe('8');
    expect(rows[1]?.querySelectorAll('td')[3]?.textContent?.trim()).toBe('10');
    expect(rows[1]?.querySelectorAll('td')[4]?.textContent?.trim()).toBe('5');
    expect(rows[1]?.querySelectorAll('td')[5]?.querySelectorAll('button')).toHaveLength(3);
    expect(page.querySelector('.balance-table thead')?.textContent).toContain('WITH GBM LIQUIDITY');
    expect(page.querySelector('.balance-table thead')?.textContent).toContain('WITH BINANCE LIQUIDITY');
    expect(page.querySelector('.balance-table thead')?.textContent).not.toContain('BONDS LIQUIDITY');
    expect(page.querySelector('.balance-table thead')?.textContent).toContain('ACTIONS');
    expect(page.querySelector('.balance-summary')?.textContent).toContain('$1,000.00');
    expect(page.querySelector('.balance-summary')?.textContent).toContain('$1,250.00');
    expect(page.querySelector('.balance-summary')?.textContent).toContain('$625.00');

    const testActionCell = page.querySelectorAll('.balance-table tbody tr')[1]?.querySelectorAll('td')[5];
    const allocationButtons = testActionCell?.querySelectorAll<HTMLButtonElement>('button');
    allocationButtons?.[1]?.click();
    fixture.detectChanges();
    let updatedTestCells = page.querySelectorAll('.balance-table tbody tr')[1]?.querySelectorAll('td');
    expect(updatedTestCells?.[3]?.textContent?.trim()).toBe('2');
    expect(updatedTestCells?.[4]?.textContent?.trim()).toBe('1');
    expect(allocationButtons?.[1]?.getAttribute('aria-pressed')).toBe('true');
    expect(
      page.querySelectorAll('.balance-table tbody tr')[0]?.querySelectorAll('td')[3]?.textContent?.trim(),
    ).toBe('6');
    allocationButtons?.[2]?.click();
    fixture.detectChanges();
    updatedTestCells = page.querySelectorAll('.balance-table tbody tr')[1]?.querySelectorAll('td');
    expect(updatedTestCells?.[3]?.textContent?.trim()).toBe('1');
    expect(updatedTestCells?.[4]?.textContent?.trim()).toBe('0');
    allocationButtons?.[2]?.click();
    fixture.detectChanges();
    updatedTestCells = page.querySelectorAll('.balance-table tbody tr')[1]?.querySelectorAll('td');
    expect(updatedTestCells?.[3]?.textContent?.trim()).toBe('10');
    expect(updatedTestCells?.[4]?.textContent?.trim()).toBe('5');

    clickButton(page, '.balance-table th:nth-child(3) button');
    fixture.detectChanges();
    expect(
      page.querySelector('.balance-table tbody tr:first-child td:first-child')?.textContent?.trim(),
    ).toBe('ALT');
    clickButton(page, '.balance-table th:nth-child(3) button');
    fixture.detectChanges();
    expect(
      page.querySelector('.balance-table tbody tr:first-child td:first-child')?.textContent?.trim(),
    ).toBe('TEST');
  });

  it('alternates between Bollinger Bands and EMAs every five seconds in the chart tab', () => {
    vi.useFakeTimers();
    fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;

    clickButton(page, '.ticker-card-open');
    fixture.detectChanges();
    clickButton(page, '.modal-tabs button:last-child');
    fixture.detectChanges();
    vi.advanceTimersByTime(0);
    fixture.detectChanges();

    expect(priceLegend(page)).toContain('BB upper');
    expect(priceLegend(page)).not.toContain('EMA 10');
    expect(priceHeading(page)).toContain('BOLLINGER BANDS');

    vi.advanceTimersByTime(4_999);
    fixture.detectChanges();
    expect(priceHeading(page)).toContain('BOLLINGER BANDS');

    vi.advanceTimersByTime(1);
    fixture.detectChanges();
    expect(priceLegend(page)).toContain('EMA 10');
    expect(priceLegend(page)).not.toContain('BB upper');
    expect(priceHeading(page)).toContain('EMA 10 / 55');

    vi.advanceTimersByTime(5_000);
    fixture.detectChanges();
    expect(priceLegend(page)).toContain('BB upper');
    expect(priceHeading(page)).toContain('BOLLINGER BANDS');
  });

  it('imports balances on the crypto page without showing GBM liquidity', async () => {
    const pricedCrypto: Stock = {
      ...stock,
      name: 'BTC',
      category: 'Layer 1',
      prices: {
        ...emptyTimeframes<Stock['prices']['daily'][number]>(),
        daily: [{ open: 120, high: 125, low: 120, close: 123.45, volume: 1 }],
      },
    };
    stockDataMock.getMarketAssets.mockReturnValueOnce(of({ stocks: [pricedCrypto] }));
    vi.useFakeTimers();
    fixture = TestBed.createComponent(App);
    fixture.componentRef.setInput('market', 'crypto');
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;

    expect(page.querySelector('.import-balances-button')).not.toBeNull();
    clickButton(page, '.import-balances-button');
    fixture.detectChanges();
    expect(page.querySelector('[role="dialog"]')?.textContent).toContain(
      'Estimate whole units available for each crypto asset.',
    );

    const contents = JSON.stringify({
      totalBalanceUsd: 1_000,
      positions: [
        { group: 'bonds', platform: 'gbm', currentValueUsd: 1_250 },
        { group: 'bonds', platform: 'binance', currentValueUsd: 625 },
      ],
    });
    const file = new File([contents], 'export.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(contents) });
    const dropzone = page.querySelector('.balance-dropzone');
    if (!dropzone) {
      throw new Error('Could not find the balance import dropzone.');
    }
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, 'dataTransfer', { value: { files: [file] } });
    dropzone.dispatchEvent(dropEvent);
    await Promise.resolve();
    fixture.detectChanges();
    vi.advanceTimersByTime(1_200);
    fixture.detectChanges();

    const table = page.querySelector('.balance-table');
    expect(table?.textContent).toContain('CRYPTO ASSET');
    expect(table?.textContent).toContain('PRICE (USDT)');
    expect(table?.textContent).toContain('WITH ACCOUNT BALANCE');
    expect(table?.textContent).toContain('WITH BINANCE LIQUIDITY');
    expect(table?.textContent).not.toContain('GBM');
    expect(table?.querySelectorAll('tbody tr')).toHaveLength(1);
    const cells = table?.querySelectorAll('tbody tr td');
    expect(cells?.[0]?.textContent?.trim()).toBe('BTC');
    expect(Number(cells?.[2]?.textContent?.trim())).toBeCloseTo(8.1, 1);
    expect(Number(cells?.[3]?.textContent?.trim())).toBeCloseTo(5.06, 2);
    expect(page.querySelector('.balance-summary')?.textContent).toContain('$625.00');
    expect(page.querySelector('.balance-summary')?.textContent).not.toContain('$1,250.00');

    const allocationButtons = cells?.[4]?.querySelectorAll<HTMLButtonElement>('button');
    allocationButtons?.[1]?.click();
    fixture.detectChanges();
    const updatedCells = table?.querySelectorAll('tbody tr td');
    expect(Number(updatedCells?.[2]?.textContent?.trim())).toBeCloseTo(8.1, 1);
    expect(Number(updatedCells?.[3]?.textContent?.trim())).toBeCloseTo(1.01, 2);
    expect(allocationButtons?.[1]?.getAttribute('aria-label')).toContain('Binance liquidity');
    expect(allocationButtons?.[1]?.getAttribute('aria-label')).not.toContain('GBM');
    expect(allocationButton?.getAttribute('aria-label')).toContain('Binance liquidity');
    expect(allocationButton?.getAttribute('aria-label')).not.toContain('GBM');
  });

  it('shows Binance quotes and polls them every five seconds on the crypto page', () => {
    vi.useFakeTimers();
    fixture = TestBed.createComponent(App);
    fixture.componentRef.setInput('market', 'crypto');
    fixture.detectChanges();
    vi.advanceTimersByTime(0);
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;

    expect(page.querySelector('h1')?.textContent).toContain('Crypto');
    expect(page.querySelector('.live-price-status')?.textContent).toContain(
      'updates every 5 seconds',
    );
    expect(page.querySelector('.last-price')?.textContent).toContain('$123.45');
    expect(page.querySelector('.price-currency')?.textContent).toContain('USDT');
    expect(page.textContent).not.toContain('MXN');
    expect(stockDataMock.getCryptoPrices).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(4_999);
    expect(stockDataMock.getCryptoPrices).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(stockDataMock.getCryptoPrices).toHaveBeenCalledTimes(2);
  });

  it('restores crypto filters separately from stock filters', () => {
    localStorage.setItem(
      preferencesStorageKey,
      JSON.stringify({
        nameFilter: 'stock',
        categoryFilter: '',
        sortField: 'name',
      }),
    );
    localStorage.setItem(
      'marketlens.crypto-list-preferences',
      JSON.stringify({
        nameFilter: 'bitcoin',
        categoryFilter: 'Layer 1',
        sortField: 'price',
      }),
    );
    fixture = TestBed.createComponent(App);
    fixture.componentRef.setInput('market', 'crypto');
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;

    expect(page.querySelector<HTMLInputElement>('input[type="search"]')?.value).toBe(
      'bitcoin',
    );
    expect(
      page.querySelector<HTMLSelectElement>('.filter-controls select')?.value,
    ).toBe('Layer 1');
    expect(page.querySelector<HTMLSelectElement>('.sort-field select')?.value).toBe(
      'price',
    );
  });
});

function clickButton(root: ParentNode, selector: string): void {
  const button = root.querySelector<HTMLButtonElement>(selector);
  if (!button) {
    throw new Error(`Could not find button matching "${selector}".`);
  }
  button.click();
}

function priceLegend(root: ParentNode): string {
  return root.querySelector('.chart-legend')?.textContent ?? '';
}

function priceHeading(root: ParentNode): string {
  return root.querySelector('.price-section .chart-section-title')?.textContent ?? '';
}
