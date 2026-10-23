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
