import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export type Timeframe = 'monthly' | 'weekly' | 'daily' | '4h';

export const TIMEFRAMES: Timeframe[] = ['monthly', 'weekly', 'daily', '4h'];

export interface PriceBar {
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

export interface BollingerBands {
  upper: number | null;
  middle: number | null;
  lower: number | null;
}

export interface TimeframeValues<T> {
  monthly: T[];
  weekly: T[];
  daily: T[];
  '4h': T[];
}

export interface TimeframeValue<T> {
  monthly: T;
  weekly: T;
  daily: T;
  '4h': T;
}

export interface Stock {
  name: string;
  category: string;
  timestamps: TimeframeValues<string>;
  prices: TimeframeValues<PriceBar>;
  close: TimeframeValues<number | null>;
  ema10?: TimeframeValues<number | null>;
  ema55?: TimeframeValues<number | null>;
  rsi: TimeframeValues<number | null>;
  adx: TimeframeValues<number | null>;
  bbands: TimeframeValues<BollingerBands>;
  bbands_position_streak: TimeframeValue<number | null>;
}

export interface StocksResponse {
  stocks: Stock[];
}

export interface ExchangeRate {
  rate: number;
  date: string;
}

@Injectable({ providedIn: 'root' })
export class StockDataService {
  constructor(private readonly http: HttpClient) {}

  getStocks(): Observable<StocksResponse> {
    return this.http.get<StocksResponse>('/api/stocks/cache');
  }

  getUsdMxnRate(): Observable<ExchangeRate> {
    return this.http.get<ExchangeRate>('/api/exchange-rate');
  }

  refreshStocks(symbol?: string): Observable<StocksResponse> {
    let params = this.lastYearParams();
    if (symbol) {
      params = params.set('symbols', symbol);
    }
    return this.http.post<StocksResponse>('/api/stocks/refresh', null, { params });
  }

  private lastYearParams(): HttpParams {
    const end = new Date();
    const start = new Date(end);
    start.setUTCFullYear(start.getUTCFullYear() - 1);
    return new HttpParams()
      .set('start', start.toISOString().slice(0, 10))
      .set('end', end.toISOString().slice(0, 10));
  }
}
