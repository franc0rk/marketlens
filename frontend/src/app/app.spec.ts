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
  getMarketAssets: vi.fn(() => of({ stocks: [stock] })),
  getUsdMxnRate: vi.fn(() => of({ rate: 1, date: '2026-10-23' })),
  refreshStocks: vi.fn(() => of({ stocks: [stock] })),
  refreshMarketAssets: vi.fn(() => of({ stocks: [stock] })),
  getCryptoPrices: vi.fn(() => of({ prices: { TEST: 123.45 } })),
};

describe('App price indicator rotation', () => {
  let fixture: ComponentFixture<App> | undefined;

  beforeEach(async () => {
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
    TestBed.resetTestingModule();
  });

  beforeEach(() => {
    vi.clearAllMocks();
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
