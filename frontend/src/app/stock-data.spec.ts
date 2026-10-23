import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StockDataService } from './stock-data';

describe('StockDataService market data', () => {
  let service: StockDataService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        StockDataService,
      ],
    });
    service = TestBed.inject(StockDataService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads crypto history and maps API assets into the dashboard model', () => {
    let result: unknown;
    service.getMarketAssets('crypto').subscribe((response) => (result = response));

    const request = http.expectOne('/api/crypto');
    expect(request.request.method).toBe('GET');
    request.flush({ assets: [{ name: 'BTC' }] });

    expect(result).toEqual({ stocks: [{ name: 'BTC' }] });
  });

  it('requests a selected crypto asset and polls Binance spot prices', () => {
    service.refreshMarketAssets('crypto', 'BTC').subscribe();
    const historyRequest = http.expectOne('/api/crypto?symbols=BTC');
    expect(historyRequest.request.method).toBe('GET');
    historyRequest.flush({ assets: [] });

    let prices: unknown;
    service.getCryptoPrices().subscribe((response) => (prices = response));
    const priceRequest = http.expectOne('/api/crypto/prices');
    expect(priceRequest.request.method).toBe('GET');
    priceRequest.flush({ prices: { BTC: 100_000 } });

    expect(prices).toEqual({ prices: { BTC: 100_000 } });
  });
});
