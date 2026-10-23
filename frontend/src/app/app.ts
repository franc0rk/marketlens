import {
  AfterViewInit,
  Component,
  computed,
  ElementRef,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
  ViewChild,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { EMPTY, Subscription, timer } from 'rxjs';
import { catchError, exhaustMap, tap } from 'rxjs/operators';
import {
  CandlestickData,
  CandlestickSeries,
  ColorType,
  createChart,
  IChartApi,
  LineData,
  LineSeries,
  UTCTimestamp,
} from 'lightweight-charts';
import {
  BollingerBands,
  MarketType,
  PriceBar,
  Stock,
  StockDataService,
  Timeframe,
  TIMEFRAMES,
} from './stock-data';

type AnalysisTab = 'summary' | 'chart';
type PriceOverlayMode = 'bbands' | 'emas';
type StockSortField =
  | 'name'
  | 'category'
  | 'price'
  | 'rsi'
  | 'adx'
  | 'bbandsStreak';

@Component({
  selector: 'app-market-page',
  imports: [RouterLink],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit, OnChanges, AfterViewInit, OnDestroy {
  @Input() market: MarketType = 'stocks';
  @ViewChild('priceChart') private priceChartElement?: ElementRef<HTMLDivElement>;
  @ViewChild('rsiChart') private rsiChartElement?: ElementRef<HTMLDivElement>;
  @ViewChild('adxChart') private adxChartElement?: ElementRef<HTMLDivElement>;

  protected readonly stocks = signal<Stock[]>([]);
  protected readonly usdMxnRate = signal<number | null>(null);
  protected readonly usdMxnRateDate = signal('');
  protected readonly exchangeRateError = signal('');
  protected readonly livePrices = signal<Record<string, number>>({});
  protected readonly livePriceError = signal('');
  protected readonly lastPriceUpdate = signal('');
  protected readonly nameFilter = signal('');
  protected readonly categoryFilter = signal('');
  protected readonly sortField = signal<StockSortField>('name');
  protected readonly sortOptions: { value: StockSortField; label: string }[] = [
    { value: 'name', label: 'Name' },
    { value: 'category', label: 'Category' },
    { value: 'price', label: 'Price' },
    { value: 'rsi', label: 'RSI' },
    { value: 'adx', label: 'ADX' },
    { value: 'bbandsStreak', label: 'BBANDS streak' },
  ];
  protected readonly categories = computed(() =>
    [...new Set(this.stocks().map((stock) => stock.category))].sort((left, right) =>
      left.localeCompare(right),
    ),
  );
  protected readonly filteredStocks = computed(() => {
    const name = this.nameFilter().trim().toLowerCase();
    const category = this.categoryFilter();
    const sortField = this.sortField();

    return this.stocks()
      .filter(
        (stock) =>
          stock.name.toLowerCase().includes(name) &&
          (!category || stock.category === category),
      )
      .sort((left, right) => {
        const leftValue = this.stockSortValue(left, sortField);
        const rightValue = this.stockSortValue(right, sortField);
        if (leftValue === null) {
          return rightValue === null ? left.name.localeCompare(right.name) : 1;
        }
        if (rightValue === null) {
          return -1;
        }
        const comparison =
          typeof leftValue === 'number' && typeof rightValue === 'number'
            ? leftValue - rightValue
            : String(leftValue).localeCompare(String(rightValue), undefined, {
                numeric: true,
                sensitivity: 'base',
              });
        return comparison === 0
          ? left.name.localeCompare(right.name)
          : comparison;
      });
  });
  protected readonly filtersActive = computed(
    () => this.nameFilter().trim().length > 0 || this.categoryFilter().length > 0,
  );
  protected readonly selectedStock = signal<Stock | null>(null);
  protected readonly activeTab = signal<AnalysisTab>('summary');
  protected readonly selectedTimeframe = signal<Timeframe>('daily');
  protected readonly priceOverlayMode = signal<PriceOverlayMode>('bbands');
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly refreshing = signal(false);
  protected readonly refreshingTicker = signal<string | null>(null);
  protected readonly refreshError = signal('');
  protected readonly timeframes = TIMEFRAMES;

  private chartApis: IChartApi[] = [];
  private resizeObserver?: ResizeObserver;
  private indicatorRotationTimer?: number;
  private updatePriceOverlayVisibility?: (mode: PriceOverlayMode) => void;
  private viewReady = false;
  private initialized = false;
  private pricePoll?: Subscription;

  constructor(private readonly stockData: StockDataService) {}

  ngOnInit(): void {
    this.initialized = true;
    this.initializeMarket();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.initialized && changes['market'] && !changes['market'].firstChange) {
      this.closeStock();
      this.nameFilter.set('');
      this.categoryFilter.set('');
      this.sortField.set('name');
      this.initializeMarket();
    }
  }

  private initializeMarket(): void {
    this.pricePoll?.unsubscribe();
    this.livePrices.set({});
    this.livePriceError.set('');
    this.lastPriceUpdate.set('');
    this.loadStocks();
    if (this.isCrypto) {
      this.startPricePolling();
      this.usdMxnRate.set(null);
      this.usdMxnRateDate.set('');
      this.exchangeRateError.set('');
    } else {
      this.loadExchangeRate();
    }
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
  }

  ngOnDestroy(): void {
    this.pricePoll?.unsubscribe();
    this.stopIndicatorRotation();
    this.destroyCharts();
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.closeStock();
  }

  protected loadStocks(): void {
    this.loading.set(true);
    this.error.set('');
    this.stockData.getMarketAssets(this.market).subscribe({
      next: ({ stocks }) => {
        this.stocks.set(stocks.map((stock) => this.normalizeStock(stock)));
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(error instanceof Error ? error.message : 'The data request failed.');
        this.loading.set(false);
      },
    });
  }

  protected refreshAll(): void {
    this.refreshStocks();
  }

  protected refreshTicker(symbol: string): void {
    this.refreshStocks(symbol);
  }

  protected setNameFilter(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) {
      this.nameFilter.set(input.value);
    }
  }

  protected setCategoryFilter(event: Event): void {
    const select = event.target;
    if (select instanceof HTMLSelectElement) {
      this.categoryFilter.set(select.value);
    }
  }

  protected setSortField(event: Event): void {
    const select = event.target;
    if (select instanceof HTMLSelectElement) {
      const option = this.sortOptions.find(({ value }) => value === select.value);
      if (option) {
        this.sortField.set(option.value);
      }
    }
  }

  protected clearFilters(): void {
    this.nameFilter.set('');
    this.categoryFilter.set('');
  }

  private stockSortValue(stock: Stock, field: StockSortField): number | string | null {
    switch (field) {
      case 'name':
        return stock.name;
      case 'category':
        return stock.category;
      case 'price':
        return this.finiteSortValue(this.displayPrice(stock));
      case 'rsi':
        return this.finiteSortValue(this.latest(stock.rsi.daily));
      case 'adx':
        return this.finiteSortValue(this.latest(stock.adx.daily));
      case 'bbandsStreak':
        return this.finiteSortValue(this.bbandsStreakFor(stock, 'daily'));
    }
  }

  private finiteSortValue(value: number | null | undefined): number | null {
    return value != null && Number.isFinite(value) ? value : null;
  }

  protected openStock(stock: Stock): void {
    this.selectedStock.set(stock);
    this.activeTab.set('summary');
    this.selectedTimeframe.set('daily');
  }

  protected closeStock(): void {
    this.stopIndicatorRotation();
    this.selectedStock.set(null);
    this.destroyCharts();
  }

  protected selectTab(tab: AnalysisTab): void {
    this.activeTab.set(tab);
    if (tab === 'chart') {
      this.startIndicatorRotation();
      window.setTimeout(() => this.renderCharts(), 0);
    } else {
      this.stopIndicatorRotation();
      this.destroyCharts();
    }
  }

  protected selectTimeframe(timeframe: Timeframe): void {
    this.selectedTimeframe.set(timeframe);
    this.renderCharts();
  }

  protected latest<T>(values: T[] | undefined): T | undefined {
    return values?.length ? values[values.length - 1] : undefined;
  }

  protected get isCrypto(): boolean {
    return this.market === 'crypto';
  }

  protected get priceCurrency(): string {
    return this.isCrypto ? 'USDT' : 'USD';
  }

  protected displayPrice(stock: Stock): number | null | undefined {
    return this.isCrypto
      ? (this.livePrices()[stock.name] ?? this.latest(stock.prices.daily)?.close)
      : this.latest(stock.prices.daily)?.close;
  }

  private emaValues(
    stock: Stock,
    timeframe: Timeframe,
    length: 10 | 55,
  ): (number | null)[] {
    const existing = length === 10 ? stock.ema10?.[timeframe] : stock.ema55?.[timeframe];
    if (existing) {
      return existing;
    }

    const closes = stock.close[timeframe];
    const alpha = 2 / (length + 1);
    let previous: number | null = null;
    let validCount = 0;
    return closes.map((close) => {
      if (close == null || !Number.isFinite(close)) {
        return null;
      }
      validCount += 1;
      previous = previous === null ? close : alpha * close + (1 - alpha) * previous;
      return validCount >= length ? previous : null;
    });
  }

  private normalizeStock(stock: Stock): Stock {
    return {
      ...stock,
      ema10: stock.ema10 ?? {
        monthly: this.emaValues(stock, 'monthly', 10),
        weekly: this.emaValues(stock, 'weekly', 10),
        daily: this.emaValues(stock, 'daily', 10),
        '4h': this.emaValues(stock, '4h', 10),
      },
      ema55: stock.ema55 ?? {
        monthly: this.emaValues(stock, 'monthly', 55),
        weekly: this.emaValues(stock, 'weekly', 55),
        daily: this.emaValues(stock, 'daily', 55),
        '4h': this.emaValues(stock, '4h', 55),
      },
    };
  }

  protected formatValue(value: number | null | undefined): string {
    return value == null || !Number.isFinite(value) ? '—' : value.toFixed(2);
  }

  protected formatPrice(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) {
      return '—';
    }
    const formatted = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
    return `$${formatted}`;
  }

  protected formatConvertedPrice(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) {
      return '—';
    }
    const rate = this.usdMxnRate();
    if (rate == null) {
      return this.exchangeRateError() ? 'Unavailable' : 'Loading…';
    }
    return this.formatPrice(value * rate);
  }

  protected formatExchangeRate(value: number | null): string {
    if (value == null || !Number.isFinite(value)) {
      return '—';
    }
    return `$${new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    }).format(value)}`;
  }

  protected rsiColor(value: number | null | undefined): string | null {
    if (value == null || !Number.isFinite(value)) {
      return null;
    }
    if (value <= 30) {
      return '#f18b8d';
    }
    if (value <= 50) {
      return this.interpolateColor(value, 30, 50, '#f18b8d', '#edc77e');
    }
    if (value <= 70) {
      return this.interpolateColor(value, 50, 70, '#edc77e', '#86d8a5');
    }
    return '#86d8a5';
  }

  protected adxColor(value: number | null | undefined): string | null {
    if (value == null || !Number.isFinite(value)) {
      return null;
    }
    if (value < 23) {
      return '#f18b8d';
    }
    if (value <= 30) {
      return this.interpolateColor(value, 23, 30, '#f18b8d', '#edc77e');
    }
    if (value < 40) {
      return this.interpolateColor(value, 30, 40, '#edc77e', '#86d8a5');
    }
    if (value <= 60) {
      return '#86d8a5';
    }
    return '#e3ad59';
  }

  protected bbandsPosition(
    price: number | null | undefined,
    middle: number | null | undefined,
  ): 'below' | 'above' | 'at' | null {
    if (
      price == null ||
      middle == null ||
      !Number.isFinite(price) ||
      !Number.isFinite(middle)
    ) {
      return null;
    }
    if (price < middle) {
      return 'below';
    }
    if (price > middle) {
      return 'above';
    }
    return 'at';
  }

  protected bbandsPositionColor(position: 'below' | 'above' | 'at' | null): string | null {
    if (position === 'below') {
      return '#f18b8d';
    }
    if (position === 'above') {
      return '#86d8a5';
    }
    return position === 'at' ? '#edc77e' : null;
  }

  protected bbandsStreakLabel(
    streak: number | null | undefined,
    position: 'below' | 'above' | 'at' | null,
    timeframe: Timeframe,
  ): string | null {
    if (streak == null || streak <= 0 || position === null || position === 'at') {
      return null;
    }
    const unit: Record<Timeframe, [string, string]> = {
      monthly: ['month', 'months'],
      weekly: ['week', 'weeks'],
      daily: ['day', 'days'],
      '4h': ['bar', 'bars'],
    };
    const [singular, plural] = unit[timeframe];
    return `${streak} ${streak === 1 ? singular : plural}`;
  }

  protected bbandsStreakFor(stock: Stock, timeframe: Timeframe): number | null {
    const apiStreak = stock.bbands_position_streak?.[timeframe];
    if (apiStreak != null) {
      return apiStreak;
    }

    const prices = stock.prices[timeframe];
    const bands = stock.bbands[timeframe];
    const barCount = Math.min(prices.length, bands.length);
    if (barCount === 0) {
      return null;
    }

    const position = this.bbandsPosition(
      prices[barCount - 1]?.close,
      bands[barCount - 1]?.middle,
    );
    if (position === null) {
      return null;
    }
    if (position === 'at') {
      return 0;
    }

    let streak = 0;
    for (let index = barCount - 1; index >= 0; index -= 1) {
      const barPosition = this.bbandsPosition(
        prices[index]?.close,
        bands[index]?.middle,
      );
      if (barPosition !== position) {
        break;
      }
      streak += 1;
    }
    return streak;
  }

  private interpolateColor(
    value: number,
    startValue: number,
    endValue: number,
    startColor: string,
    endColor: string,
  ): string {
    const ratio = (value - startValue) / (endValue - startValue);
    const start = this.parseHexColor(startColor);
    const end = this.parseHexColor(endColor);
    const channels = start.map((channel, index) =>
      Math.round(channel + (end[index] - channel) * ratio),
    );
    return `rgb(${channels.join(', ')})`;
  }

  private parseHexColor(color: string): [number, number, number] {
    return [
      Number.parseInt(color.slice(1, 3), 16),
      Number.parseInt(color.slice(3, 5), 16),
      Number.parseInt(color.slice(5, 7), 16),
    ];
  }

  protected timeframeLabel(timeframe: Timeframe): string {
    return timeframe === '4h' ? '4H' : timeframe.toUpperCase();
  }

  protected dataSourceLabel(): string {
    return this.isCrypto ? 'Binance · LIVE' : 'Saved data';
  }

  protected displayedDateRange(): string {
    const daily = this.stocks()[0]?.timestamps.daily;
    const first = daily?.[0];
    const last = this.latest(daily);
    if (!first || !last) {
      return 'Date range unavailable';
    }
    const format = (value: string) =>
      new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(value));
    return `${format(first)} — ${format(last)}`;
  }

  protected latestTimestamp(stock: Stock, timeframe: Timeframe): string {
    const timestamp = this.latest(stock.timestamps[timeframe]);
    if (!timestamp) {
      return 'No data';
    }
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(timestamp));
  }

  protected tickerInitial(symbol: string): string {
    return symbol.replace(/[^A-Z]/g, '').slice(0, 1) || symbol.slice(0, 1);
  }

  protected avatarClass(symbol: string): string {
    const palette = ['avatar-blue', 'avatar-violet', 'avatar-teal', 'avatar-amber', 'avatar-rose'];
    const value = [...symbol].reduce((sum, character) => sum + character.charCodeAt(0), 0);
    return palette[value % palette.length];
  }

  private refreshStocks(symbol?: string): void {
    if (this.refreshing()) {
      return;
    }

    this.refreshing.set(true);
    this.refreshingTicker.set(symbol ?? null);
    this.refreshError.set('');
    if (!symbol && !this.isCrypto) {
      this.loadExchangeRate();
    }
    this.stockData.refreshMarketAssets(this.market, symbol).subscribe({
      next: ({ stocks }) => {
        const normalizedStocks = stocks.map((stock) => this.normalizeStock(stock));
        const mergedStocks =
          this.isCrypto && symbol
            ? this.stocks().map(
                (stock) => normalizedStocks.find((fresh) => fresh.name === stock.name) ?? stock,
              )
            : normalizedStocks;
        this.stocks.set(mergedStocks);
        const selectedName = this.selectedStock()?.name;
        if (selectedName) {
          this.selectedStock.set(mergedStocks.find((stock) => stock.name === selectedName) ?? null);
        }
        this.refreshing.set(false);
        this.refreshingTicker.set(null);
        if (this.activeTab() === 'chart' && this.selectedStock()) {
          window.setTimeout(() => this.renderCharts(), 0);
        }
      },
      error: (error: unknown) => {
        this.refreshError.set(error instanceof Error ? error.message : 'The market data refresh failed.');
        this.refreshing.set(false);
        this.refreshingTicker.set(null);
      },
    });
  }

  private startPricePolling(): void {
    this.pricePoll = timer(0, 5_000)
      .pipe(
        exhaustMap(() =>
          this.stockData.getCryptoPrices().pipe(
            tap(({ prices }) => {
              this.livePrices.set(prices);
              this.lastPriceUpdate.set(new Date().toLocaleTimeString());
              this.livePriceError.set('');
            }),
            catchError((error: unknown) => {
              this.livePriceError.set(
                error instanceof Error ? error.message : 'The live price request failed.',
              );
              return EMPTY;
            }),
          ),
        ),
      )
      .subscribe();
  }

  private loadExchangeRate(): void {
    this.exchangeRateError.set('');
    this.stockData.getUsdMxnRate().subscribe({
      next: ({ rate, date }) => {
        this.usdMxnRate.set(rate);
        this.usdMxnRateDate.set(date);
      },
      error: (error: unknown) => {
        this.usdMxnRate.set(null);
        this.usdMxnRateDate.set('');
        this.exchangeRateError.set(
          error instanceof Error ? error.message : 'The exchange-rate request failed.',
        );
      },
    });
  }

  private renderCharts(): void {
    if (
      !this.viewReady ||
      this.activeTab() !== 'chart' ||
      !this.priceChartElement ||
      !this.rsiChartElement ||
      !this.adxChartElement
    ) {
      return;
    }

    const stock = this.selectedStock();
    if (!stock) {
      return;
    }
    this.destroyCharts();

    const timeframe = this.selectedTimeframe();
    const timestamps = stock.timestamps[timeframe];
    const prices = stock.prices[timeframe];
    const ema10 = stock.ema10?.[timeframe] ?? [];
    const ema55 = stock.ema55?.[timeframe] ?? [];
    const priceHost = this.priceChartElement.nativeElement;
    const rsiHost = this.rsiChartElement.nativeElement;
    const adxHost = this.adxChartElement.nativeElement;

    if (!timestamps.length || !prices.length) {
      return;
    }

    const charts = [
      this.createChart(priceHost, timeframe, 310),
      this.createChart(rsiHost, timeframe, 112),
      this.createChart(adxHost, timeframe, 112),
    ];
    this.chartApis = charts;

    const candleData: CandlestickData<UTCTimestamp>[] = [];
    const upperBand: LineData<UTCTimestamp>[] = [];
    const middleBand: LineData<UTCTimestamp>[] = [];
    const lowerBand: LineData<UTCTimestamp>[] = [];
    const ema10Data: LineData<UTCTimestamp>[] = [];
    const ema55Data: LineData<UTCTimestamp>[] = [];
    const rsiData: LineData<UTCTimestamp>[] = [];
    const adxData: LineData<UTCTimestamp>[] = [];

    timestamps.forEach((timestamp, index) => {
      const time = Math.floor(new Date(timestamp).getTime() / 1000) as UTCTimestamp;
      const price = prices[index];
      if (this.isPriceBarComplete(price)) {
        candleData.push({
          time,
          open: price.open,
          high: price.high,
          low: price.low,
          close: price.close,
        });
      }

      this.appendBand(upperBand, time, stock.bbands[timeframe][index], 'upper');
      this.appendBand(middleBand, time, stock.bbands[timeframe][index], 'middle');
      this.appendBand(lowerBand, time, stock.bbands[timeframe][index], 'lower');
      this.appendLine(ema10Data, time, ema10[index]);
      this.appendLine(ema55Data, time, ema55[index]);
      this.appendLine(rsiData, time, stock.rsi[timeframe][index]);
      this.appendLine(adxData, time, stock.adx[timeframe][index]);
    });

    charts[0].addSeries(CandlestickSeries, {
      upColor: '#39c98a',
      downColor: '#f16b75',
      borderVisible: false,
      wickUpColor: '#39c98a',
      wickDownColor: '#f16b75',
    }).setData(candleData);
    const bbandsSeries = [
      charts[0].addSeries(LineSeries, { color: '#e3ad59', lineWidth: 1, lastValueVisible: false, priceLineVisible: false }),
      charts[0].addSeries(LineSeries, { color: '#7e8799', lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false }),
      charts[0].addSeries(LineSeries, { color: '#e3ad59', lineWidth: 1, lastValueVisible: false, priceLineVisible: false }),
    ];
    const emaSeries = [
      charts[0].addSeries(LineSeries, { color: '#75c7f1', lineWidth: 2, lastValueVisible: false, priceLineVisible: false }),
      charts[0].addSeries(LineSeries, { color: '#c5a6f4', lineWidth: 2, lastValueVisible: false, priceLineVisible: false }),
    ];
    bbandsSeries[0].setData(upperBand);
    bbandsSeries[1].setData(middleBand);
    bbandsSeries[2].setData(lowerBand);
    emaSeries[0].setData(ema10Data);
    emaSeries[1].setData(ema55Data);
    this.updatePriceOverlayVisibility = (mode) => {
      for (const series of bbandsSeries) {
        series.applyOptions({ visible: mode === 'bbands' });
      }
      for (const series of emaSeries) {
        series.applyOptions({ visible: mode === 'emas' });
      }
    };
    this.updatePriceOverlayVisibility(this.priceOverlayMode());
    charts[1].addSeries(LineSeries, { color: '#b28af7', lineWidth: 2, lastValueVisible: true, priceLineVisible: false }).setData(rsiData);
    charts[2].addSeries(LineSeries, { color: '#53b5e8', lineWidth: 2, lastValueVisible: true, priceLineVisible: false }).setData(adxData);

    charts[1].addSeries(LineSeries, { color: 'rgba(255,255,255,0.16)', lineWidth: 1, lastValueVisible: false, priceLineVisible: false })
      .setData(timestamps.map((timestamp) => ({ time: this.toChartTime(timestamp), value: 70 })));
    charts[1].addSeries(LineSeries, { color: 'rgba(255,255,255,0.16)', lineWidth: 1, lastValueVisible: false, priceLineVisible: false })
      .setData(timestamps.map((timestamp) => ({ time: this.toChartTime(timestamp), value: 30 })));
    charts[2].addSeries(LineSeries, { color: 'rgba(255,255,255,0.08)', lineWidth: 1, lastValueVisible: false, priceLineVisible: false })
      .setData(timestamps.map((timestamp) => ({ time: this.toChartTime(timestamp), value: 0 })));

    this.syncChartRanges(charts);
    charts[0].timeScale().fitContent();
    this.resizeObserver = new ResizeObserver(() => {
      for (const chart of charts) {
        chart.applyOptions({ width: chart.chartElement().clientWidth });
      }
    });
    this.resizeObserver.observe(priceHost.parentElement ?? priceHost);
  }

  private createChart(host: HTMLDivElement, timeframe: Timeframe, height: number): IChartApi {
    return createChart(host, {
      width: host.clientWidth || 600,
      height,
      layout: {
        background: { type: ColorType.Solid, color: '#0d1219' },
        textColor: '#7f899b',
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: 'rgba(117, 132, 155, 0.08)' },
        horzLines: { color: 'rgba(117, 132, 155, 0.10)' },
      },
      rightPriceScale: { borderColor: 'rgba(117, 132, 155, 0.16)' },
      timeScale: {
        borderColor: 'rgba(117, 132, 155, 0.16)',
        timeVisible: timeframe === '4h',
        secondsVisible: false,
        rightOffset: 4,
      },
      crosshair: { vertLine: { color: 'rgba(176, 191, 214, 0.3)' }, horzLine: { color: 'rgba(176, 191, 214, 0.3)' } },
      handleScroll: true,
      handleScale: true,
    });
  }

  private syncChartRanges(charts: IChartApi[]): void {
    let synchronizing = false;
    for (const source of charts) {
      source.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (!range || synchronizing) {
          return;
        }
        synchronizing = true;
        for (const target of charts) {
          if (target !== source) {
            target.timeScale().setVisibleLogicalRange(range);
          }
        }
        synchronizing = false;
      });
    }
  }

  private appendBand(
    destination: LineData<UTCTimestamp>[],
    time: UTCTimestamp,
    bands: BollingerBands | undefined,
    key: keyof BollingerBands,
  ): void {
    const value = bands?.[key];
    if (value != null && Number.isFinite(value)) {
      destination.push({ time, value });
    }
  }

  private appendLine(
    destination: LineData<UTCTimestamp>[],
    time: UTCTimestamp,
    value: number | null | undefined,
  ): void {
    if (value != null && Number.isFinite(value)) {
      destination.push({ time, value });
    }
  }

  private isPriceBarComplete(bar: PriceBar | undefined): bar is PriceBar & {
    open: number;
    high: number;
    low: number;
    close: number;
  } {
    return (
      bar?.open != null &&
      bar.high != null &&
      bar.low != null &&
      bar.close != null &&
      [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)
    );
  }

  private toChartTime(timestamp: string): UTCTimestamp {
    return Math.floor(new Date(timestamp).getTime() / 1000) as UTCTimestamp;
  }

  private destroyCharts(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.updatePriceOverlayVisibility = undefined;
    for (const chart of this.chartApis) {
      chart.remove();
    }
    this.chartApis = [];
  }

  private startIndicatorRotation(): void {
    this.stopIndicatorRotation();
    this.priceOverlayMode.set('bbands');
    this.indicatorRotationTimer = window.setInterval(() => {
      const nextMode = this.priceOverlayMode() === 'bbands' ? 'emas' : 'bbands';
      this.priceOverlayMode.set(nextMode);
      this.updatePriceOverlayVisibility?.(nextMode);
    }, 5_000);
  }

  private stopIndicatorRotation(): void {
    if (this.indicatorRotationTimer !== undefined) {
      window.clearInterval(this.indicatorRotationTimer);
      this.indicatorRotationTimer = undefined;
    }
  }
}
