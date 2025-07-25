import { assert, ensureNotNull } from '../helpers/assertions';
import { Delegate } from '../helpers/delegate';
import { IDestroyable } from '../helpers/idestroyable';
import { ISubscription } from '../helpers/isubscription';
import { DeepPartial, merge } from '../helpers/strict-type-checks';

import { PriceAxisViewRendererOptions } from '../renderers/iprice-axis-view-renderer';
import { PriceAxisRendererOptionsProvider } from '../renderers/price-axis-renderer-options-provider';

import { ColorParser } from './colors';
import { Coordinate } from './coordinate';
import { Crosshair, CrosshairOptions } from './crosshair';
import { DefaultPriceScaleId, isDefaultPriceScale } from './default-price-scale';
import { GridOptions } from './grid';
import { IPrimitiveHitTestSource } from './idata-source';
import { IHorzScaleBehavior, InternalHorzScaleItem } from './ihorz-scale-behavior';
import { InvalidateMask, InvalidationLevel, ITimeScaleAnimation } from './invalidate-mask';
import { IPriceDataSource } from './iprice-data-source';
import { ISeries } from './iseries';
import { ColorType, LayoutOptions } from './layout-options';
import { LocalizationOptions, LocalizationOptionsBase } from './localization-options';
import { Magnet } from './magnet';
import { DEFAULT_STRETCH_FACTOR, MIN_PANE_HEIGHT, Pane } from './pane';
import { hitTestPane } from './pane-hit-test';
import { Point } from './point';
import { PriceScale, PriceScaleOptions } from './price-scale';
import { Series } from './series';
import { SeriesType } from './series-options';
import { LogicalRange, TimePointIndex, TimeScalePoint } from './time-data';
import { HorzScaleOptions, ITimeScale, TimeScale } from './time-scale';
import { TouchMouseEventData } from './touch-mouse-event-data';
import { Trendline } from './trendline';
import { TrendlineData } from './trendline-data';
import { FibonacciRetracement } from './fibonacci-retracement';

/**
 * Represents options for how the chart is scrolled by the mouse and touch gestures.
 */
export interface HandleScrollOptions {
	/**
	 * Enable scrolling with the mouse wheel.
	 *
	 * @defaultValue `true`
	 */
	mouseWheel: boolean;

	/**
	 * Enable scrolling by holding down the left mouse button and moving the mouse.
	 *
	 * @defaultValue `true`
	 */
	pressedMouseMove: boolean;

	/**
	 * Enable horizontal touch scrolling.
	 *
	 * When enabled the chart handles touch gestures that would normally scroll the webpage horizontally.
	 *
	 * @defaultValue `true`
	 */
	horzTouchDrag: boolean;

	/**
	 * Enable vertical touch scrolling.
	 *
	 * When enabled the chart handles touch gestures that would normally scroll the webpage vertically.
	 *
	 * @defaultValue `true`
	 */
	vertTouchDrag: boolean;
}

/**
 * Represents options for how the chart is scaled by the mouse and touch gestures.
 */
export interface HandleScaleOptions {
	/**
	 * Enable scaling with the mouse wheel.
	 *
	 * @defaultValue `true`
	 */
	mouseWheel: boolean;

	/**
	 * Enable scaling with pinch/zoom gestures.
	 *
	 * @defaultValue `true`
	 */
	pinch: boolean;

	/**
	 * Enable scaling the price and/or time scales by holding down the left mouse button and moving the mouse.
	 */
	axisPressedMouseMove: AxisPressedMouseMoveOptions | boolean;

	/**
	 * Enable resetting scaling by double-clicking the left mouse button.
	 */
	axisDoubleClickReset: AxisDoubleClickOptions | boolean;
}

/**
 * Represents options for enabling or disabling kinetic scrolling with mouse and touch gestures.
 */
export interface KineticScrollOptions {
	/**
	 * Enable kinetic scroll with touch gestures.
	 *
	 * @defaultValue `true`
	 */
	touch: boolean;

	/**
	 * Enable kinetic scroll with the mouse.
	 *
	 * @defaultValue `false`
	 */
	mouse: boolean;
}

type HandleScaleOptionsInternal =
	Omit<HandleScaleOptions, 'axisPressedMouseMove' | 'axisDoubleClickReset'>
	& {
		/** @public */
		axisPressedMouseMove: AxisPressedMouseMoveOptions;

		/** @public */
		axisDoubleClickReset: AxisDoubleClickOptions;
	};

/**
 * Represents options for how the time and price axes react to mouse movements.
 */
export interface AxisPressedMouseMoveOptions {
	/**
	 * Enable scaling the time axis by holding down the left mouse button and moving the mouse.
	 *
	 * @defaultValue `true`
	 */
	time: boolean;

	/**
	 * Enable scaling the price axis by holding down the left mouse button and moving the mouse.
	 *
	 * @defaultValue `true`
	 */
	price: boolean;
}

/**
 * Represents options for how the time and price axes react to mouse double click.
 */
export interface AxisDoubleClickOptions {
	/**
	 * Enable resetting scaling the time axis by double-clicking the left mouse button.
	 *
	 * @defaultValue `true`
	 */
	time: boolean;

	/**
	 * Enable reseting scaling the price axis by by double-clicking the left mouse button.
	 *
	 * @defaultValue `true`
	 */
	price: boolean;
}

export interface HoveredObject {
	hitTestData?: unknown;
	externalId?: string;
}

export interface HoveredSource {
	source: IPriceDataSource | IPrimitiveHitTestSource;
	object?: HoveredObject;
	cursorStyle?: string | null;
}

export interface PriceScaleOnPane {
	priceScale: PriceScale;
	pane: Pane;
}

const enum BackgroundColorSide {
	Top,
	Bottom,
}

type InvalidateHandler = (mask: InvalidateMask) => void;

/**
 * Represents a visible price scale's options.
 *
 * @see {@link PriceScaleOptions}
 */
export type VisiblePriceScaleOptions = PriceScaleOptions;

/**
 * Represents overlay price scale options.
 */
export type OverlayPriceScaleOptions = Omit<PriceScaleOptions, 'visible' | 'autoScale'>;

/**
 * Determine how to exit the tracking mode.
 *
 * By default, mobile users will long press to deactivate the scroll and have the ability to check values and dates.
 * Another press is required to activate the scroll, be able to move left/right, zoom, etc.
 */
export const enum TrackingModeExitMode {
	/**
	 * Tracking Mode will be deactivated on touch end event.
	 */
	OnTouchEnd,
	/**
	 * Tracking Mode will be deactivated on the next tap event.
	 */
	OnNextTap,
}

/**
 * Represent options for the tracking mode's behavior.
 *
 * Mobile users will not have the ability to see the values/dates like they do on desktop.
 * To see it, they should enter the tracking mode. The tracking mode will deactivate the scrolling
 * and make it possible to check values and dates.
 */
export interface TrackingModeOptions {
	// eslint-disable-next-line tsdoc/syntax
	/** @inheritDoc TrackingModeExitMode
	 *
	 * @defaultValue {@link TrackingModeExitMode.OnNextTap}
	 */
	exitMode: TrackingModeExitMode;
}

/**
 * Represents common chart options
 */
export interface ChartOptionsBase {
	/**
	 * Width of the chart in pixels
	 *
	 * @defaultValue If `0` (default) or none value provided, then a size of the widget will be calculated based its container's size.
	 */
	width: number;

	/**
	 * Height of the chart in pixels
	 *
	 * @defaultValue If `0` (default) or none value provided, then a size of the widget will be calculated based its container's size.
	 */
	height: number;

	/**
	 * Setting this flag to `true` will make the chart watch the chart container's size and automatically resize the chart to fit its container whenever the size changes.
	 *
	 * This feature requires [`ResizeObserver`](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver) class to be available in the global scope.
	 * Note that calling code is responsible for providing a polyfill if required. If the global scope does not have `ResizeObserver`, a warning will appear and the flag will be ignored.
	 *
	 * Please pay attention that `autoSize` option and explicit sizes options `width` and `height` don't conflict with one another.
	 * If you specify `autoSize` flag, then `width` and `height` options will be ignored unless `ResizeObserver` has failed. If it fails then the values will be used as fallback.
	 *
	 * The flag `autoSize` could also be set with and unset with `applyOptions` function.
	 * ```js
	 * const chart = LightweightCharts.createChart(document.body, {
	 *     autoSize: true,
	 * });
	 * ```
	 */
	autoSize: boolean;

	/**
	 * Layout options
	 */
	layout: LayoutOptions;

	/**
	 * Left price scale options
	 */
	leftPriceScale: VisiblePriceScaleOptions;
	/**
	 * Right price scale options
	 */
	rightPriceScale: VisiblePriceScaleOptions;
	/**
	 * Overlay price scale options
	 */
	overlayPriceScales: OverlayPriceScaleOptions;

	/**
	 * Time scale options
	 */
	timeScale: HorzScaleOptions;

	/**
	 * The crosshair shows the intersection of the price and time scale values at any point on the chart.
	 *
	 */
	crosshair: CrosshairOptions;

	/**
	 * A grid is represented in the chart background as a vertical and horizontal lines drawn at the levels of visible marks of price and the time scales.
	 */
	grid: GridOptions;

	/**
	 * Scroll options, or a boolean flag that enables/disables scrolling
	 */
	handleScroll: HandleScrollOptions | boolean;

	/**
	 * Scale options, or a boolean flag that enables/disables scaling
	 */
	handleScale: HandleScaleOptions | boolean;

	/**
	 * Kinetic scroll options
	 */
	kineticScroll: KineticScrollOptions;

	// eslint-disable-next-line tsdoc/syntax
	/** @inheritDoc TrackingModeOptions
	 */
	trackingMode: TrackingModeOptions;

	/**
	 * Basic localization options
	 */
	localization: LocalizationOptionsBase;
}

/**
 * Structure describing options of the chart. Series options are to be set separately
 */
export interface ChartOptionsImpl<HorzScaleItem> extends ChartOptionsBase {

	/**
	 * Localization options.
	 */
	localization: LocalizationOptions<HorzScaleItem>;
}

/**
 * These properties should not be renamed by `ts-transformer-properties-rename`.
 * To ensure that this is respected in all places, please only use the
 * ['name'] syntax to read or write these properties.
 */
interface ChartOptionsInternalFixedNames {
	/**
	 * **Only access using ['handleScroll']**
	 * @public
	 */
	handleScroll: HandleScrollOptions;
	/**
	 * **Only access using ['handleScale']**
	 * @public
	 */
	handleScale: HandleScaleOptionsInternal;
	/**
	 * **Only access using ['layout']**
	 * @public
	 */
	layout: LayoutOptions;
}

export type ChartOptionsInternalBase =
	Omit<ChartOptionsBase, 'handleScroll' | 'handleScale' | 'layout'>
	& ChartOptionsInternalFixedNames;

export type ChartOptionsInternal<HorzScaleItem> =
	Omit<ChartOptionsImpl<HorzScaleItem>, 'handleScroll' | 'handleScale' | 'layout'>
	& ChartOptionsInternalFixedNames;

interface GradientColorsCache {
	topColor: string;
	bottomColor: string;
	colors: Map<number, string>;
}

export interface IChartModelBase {
	applyPriceScaleOptions(priceScaleId: string, options: DeepPartial<PriceScaleOptions>, paneIndex?: number): void;
	findPriceScale(priceScaleId: string, paneIndex: number): PriceScaleOnPane | null;
	options(): Readonly<ChartOptionsInternalBase>;
	timeScale(): ITimeScale;
	serieses(): readonly Series<SeriesType>[];

	updateSource(source: IPriceDataSource): void;
	updateCrosshair(): void;
	cursorUpdate(): void;
	clearCurrentPosition(): void;
	setAndSaveCurrentPosition(x: Coordinate, y: Coordinate, event: TouchMouseEventData | null, pane: Pane): void;

	recalculatePane(pane: Pane | null): void;

	lightUpdate(): void;
	fullUpdate(): void;

	backgroundBottomColor(): string;
	backgroundTopColor(): string;
	backgroundColorAtYPercentFromTop(percent: number): string;

	paneForSource(source: IPriceDataSource): Pane | null;
	moveSeriesToScale(series: ISeries<SeriesType>, targetScaleId: string): void;

	priceAxisRendererOptions(): Readonly<PriceAxisViewRendererOptions>;
	rendererOptionsProvider(): PriceAxisRendererOptionsProvider;

	priceScalesOptionsChanged(): ISubscription;

	hoveredSource(): HoveredSource | null;
	setHoveredSource(source: HoveredSource | null): void;

	crosshairSource(): Crosshair;

	startScrollPrice(pane: Pane, priceScale: PriceScale, x: number): void;
	scrollPriceTo(pane: Pane, priceScale: PriceScale, x: number): void;
	endScrollPrice(pane: Pane, priceScale: PriceScale): void;
	resetPriceScale(pane: Pane, priceScale: PriceScale): void;

	startScalePrice(pane: Pane, priceScale: PriceScale, x: number): void;
	scalePriceTo(pane: Pane, priceScale: PriceScale, x: number): void;
	endScalePrice(pane: Pane, priceScale: PriceScale): void;

	zoomTime(pointX: Coordinate, scale: number): void;
	startScrollTime(x: Coordinate): void;
	scrollTimeTo(x: Coordinate): void;
	endScrollTime(): void;

	setTimeScaleAnimation(animation: ITimeScaleAnimation): void;

	stopTimeScaleAnimation(): void;
	moveSeriesToPane(series: Series<SeriesType>, newPaneIndex: number): void;
	panes(): readonly Pane[];
	getPaneIndex(pane: Pane): number;
	swapPanes(first: number, second: number): void;
	removePane(index: number): void;
	changePanesHeight(paneIndex: number, height: number): void;

	colorParser(): ColorParser;

	setTrendlineDrawingState(isDrawing: boolean): void;
	isDrawingTrendline(): boolean;
	setTrendlineStartPoint(point: { x: number; y: number; time: number; price: number } | null): void;
	getTrendlineStartPoint(): { x: number; y: number; time: number; price: number } | null;
	setTrendlinePreviewEnd(point: { x: number; y: number; time: number; price: number } | null): void;
	getTrendlinePreviewEnd(): { x: number; y: number; time: number; price: number } | null;

	// New pane management methods
	addPane(height?: number): number;
	deletePaneById(paneIndex: number): void;
	getPaneById(paneIndex: number): Pane | null;
}

// Interface for additional pane data
export interface PaneData {
	id: string;
	title?: string;
	series: Array<{
		id: string;
		type: SeriesType;
		data: any[];
		options?: any;
	}>;
	height?: number;
}

function isPanePrimitive(source: IPriceDataSource | IPrimitiveHitTestSource): source is IPrimitiveHitTestSource | Pane {
	return source instanceof Pane;
}

export class ChartModel<HorzScaleItem> implements IDestroyable, IChartModelBase {
	private readonly _options: ChartOptionsInternal<HorzScaleItem>;
	private readonly _invalidateHandler: InvalidateHandler;

	private readonly _rendererOptionsProvider: PriceAxisRendererOptionsProvider;

	private readonly _timeScale: TimeScale<HorzScaleItem>;
	private readonly _panes: Pane[] = [];
	private readonly _crosshair: Crosshair;
	private readonly _magnet: Magnet;

	private _serieses: Series<SeriesType>[] = [];

	private _width: number = 0;
	private _hoveredSource: HoveredSource | null = null;
	private readonly _priceScalesOptionsChanged: Delegate = new Delegate();
	private _crosshairMoved: Delegate<TimePointIndex | null, Point | null, TouchMouseEventData | null> = new Delegate();

	private _backgroundTopColor: string;
	private _backgroundBottomColor: string;
	private _gradientColorsCache: GradientColorsCache | null = null;

	private readonly _horzScaleBehavior: IHorzScaleBehavior<HorzScaleItem>;

	private _colorParser: ColorParser;

	private _currentSymbol: string = '';
	private _trendlinesBySymbol: Map<string, Map<string, Trendline>> = new Map();
	private _fibonacciRetrracementsBySymbol: Map<string, Map<string, FibonacciRetracement>> = new Map();

	private _trendlines: Map<string, Trendline> = new Map();
	private _fibonacciRetracements: Map<string, FibonacciRetracement> = new Map();

	private _isDrawingTrendline: boolean = false;
	private _trendlineStartPoint: { x: number; y: number; time: number; price: number } | null = null;
	private _trendlinePreviewEnd: { x: number; y: number; time: number; price: number } | null = null;

	// New properties for pane management
	private _paneDataMap: Map<number, PaneData> = new Map();
	private _nextPaneId: number = 1; // Start from 1 since 0 is the main chart pane

	private _getCurrentSymbolTrendlines(): Map<string, Trendline> {
    if (!this._currentSymbol) {
        return this._trendlines; // fallback to global storage if no symbol set
    }
    
    if (!this._trendlinesBySymbol.has(this._currentSymbol)) {
        this._trendlinesBySymbol.set(this._currentSymbol, new Map());
    }
    
    return this._trendlinesBySymbol.get(this._currentSymbol)!;
}

private _getCurrentSymbolFibonacci(): Map<string, FibonacciRetracement> {
    if (!this._currentSymbol) {
        return this._fibonacciRetracements; // fallback to global storage if no symbol set
    }
    
    if (!this._fibonacciRetrracementsBySymbol.has(this._currentSymbol)) {
        this._fibonacciRetrracementsBySymbol.set(this._currentSymbol, new Map());
    }
    
    return this._fibonacciRetrracementsBySymbol.get(this._currentSymbol)!;
}

public setCurrentSymbol(symbol: string): void {
    this._currentSymbol = symbol;
    // Initialize storage for this symbol if it doesn't exist
    if (!this._trendlinesBySymbol.has(symbol)) {
        this._trendlinesBySymbol.set(symbol, new Map());
    }
    if (!this._fibonacciRetrracementsBySymbol.has(symbol)) {
        this._fibonacciRetrracementsBySymbol.set(symbol, new Map());
    }
    this.fullUpdate();
}

private async _saveTrendlinesToStorage(): Promise<void> {
    try {
        const allTrendlines: { [symbol: string]: any } = {};
        
        this._trendlinesBySymbol.forEach((trendlines, symbol) => {
            const symbolTrendlines: any = {};
            trendlines.forEach((trendline, id) => {
                symbolTrendlines[id] = {
                    data: trendline.data(),
                    options: trendline.options()
                };
            });
            if (Object.keys(symbolTrendlines).length > 0) {
                allTrendlines[symbol] = symbolTrendlines;
            }
        });
        
        // Use IndexedDB
        const request = indexedDB.open('TradingChartDB', 1);
        
        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains('trendlines')) {
                db.createObjectStore('trendlines');
            }
        };
        
        request.onsuccess = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            const transaction = db.transaction(['trendlines'], 'readwrite');
            const store = transaction.objectStore('trendlines');
            store.put(allTrendlines, 'all_trendlines');
            console.log('Saved trendlines to IndexedDB:', allTrendlines);
        };
        
        request.onerror = (event) => {
            console.error('Failed to save trendlines to IndexedDB:', event);
        };
    } catch (error) {
        console.error('Failed to save trendlines:', error);
    }
}

private async _loadTrendlinesFromStorage(): Promise<void> {
    try {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('TradingChartDB', 1);
            
            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains('trendlines')) {
                    db.createObjectStore('trendlines');
                }
            };
            
            request.onsuccess = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                const transaction = db.transaction(['trendlines'], 'readonly');
                const store = transaction.objectStore('trendlines');
                const getRequest = store.get('all_trendlines');
                
                getRequest.onsuccess = () => {
                    const allTrendlines = getRequest.result;
                    if (allTrendlines) {
                        Object.keys(allTrendlines).forEach(symbol => {
                            const symbolTrendlines = allTrendlines[symbol];
                            const trendlineMap = new Map();
                            
                            Object.keys(symbolTrendlines).forEach(id => {
                                const { data, options } = symbolTrendlines[id];
                                const trendline = new Trendline(data, options);
                                trendlineMap.set(id, trendline);
                            });
                            
                            if (trendlineMap.size > 0) {
                                this._trendlinesBySymbol.set(symbol, trendlineMap);
                            }
                        });
                        
                        console.log('Loaded trendlines from IndexedDB:', allTrendlines);
                    }
                    resolve();
                };
                
                getRequest.onerror = () => {
                    console.error('Failed to load trendlines from IndexedDB');
                    resolve(); // Don't reject, just continue without data
                };
            };
            
            request.onerror = () => {
                console.error('Failed to open IndexedDB');
                resolve(); // Don't reject, just continue without data
            };
        });
    } catch (error) {
        console.error('Failed to load trendlines:', error);
    }
}

private _saveFibonacciToStorage(): void {
    try {
        const allFibonacci: { [symbol: string]: any } = {};
        
        this._fibonacciRetrracementsBySymbol.forEach((fibonaccis, symbol) => {
            const symbolFibonaccis: any = {};
            fibonaccis.forEach((fibonacci, id) => {
                symbolFibonaccis[id] = {
                    data: fibonacci.data(),
                    options: fibonacci.options()
                };
            });
            if (Object.keys(symbolFibonaccis).length > 0) {
                allFibonacci[symbol] = symbolFibonaccis;
            }
        });
        
        localStorage.setItem('trading_chart_fibonacci', JSON.stringify(allFibonacci));
        console.log('Saved fibonacci retracements to localStorage');
    } catch (error) {
        console.error('Failed to save fibonacci retracements to localStorage:', error);
    }
}

private _loadFibonacciFromStorage(): void {
    try {
        const stored = localStorage.getItem('trading_chart_fibonacci');
        if (stored) {
            const allFibonacci = JSON.parse(stored);
            
            Object.keys(allFibonacci).forEach(symbol => {
                const symbolFibonaccis = allFibonacci[symbol];
                const fibonacciMap = new Map();
                
                Object.keys(symbolFibonaccis).forEach(id => {
                    const { data, options } = symbolFibonaccis[id];
                    const fibonacci = new FibonacciRetracement(data, options);
                    fibonacciMap.set(id, fibonacci);
                });
                
                if (fibonacciMap.size > 0) {
                    this._fibonacciRetrracementsBySymbol.set(symbol, fibonacciMap);
                }
            });
            
            console.log('Loaded fibonacci retracements from localStorage');
        }
    } catch (error) {
        console.error('Failed to load fibonacci retracements from localStorage:', error);
    }
}

	public constructor(invalidateHandler: InvalidateHandler, options: ChartOptionsInternal<HorzScaleItem>, horzScaleBehavior: IHorzScaleBehavior<HorzScaleItem>) {
		this._invalidateHandler = invalidateHandler;
		this._options = options;
		this._horzScaleBehavior = horzScaleBehavior;
		this._colorParser = new ColorParser(this._options.layout.colorParsers);

		this._rendererOptionsProvider = new PriceAxisRendererOptionsProvider(this);

		this._timeScale = new TimeScale(this, options.timeScale, this._options.localization, horzScaleBehavior);
		this._crosshair = new Crosshair(this, options.crosshair);
		this._magnet = new Magnet(options.crosshair);

		this._getOrCreatePane(0);
		this._panes[0].setStretchFactor(DEFAULT_STRETCH_FACTOR * 2);

		this._backgroundTopColor = this._getBackgroundColor(BackgroundColorSide.Top);
		this._backgroundBottomColor = this._getBackgroundColor(BackgroundColorSide.Bottom);

		this._loadTrendlinesFromStorage().then(() => {
    		this.fullUpdate(); // Trigger a redraw after loading
		});
		this._loadFibonacciFromStorage();
	}

	// New pane management methods
	public addPane(height: number = 100): number {
		const paneIndex = this._panes.length;
		const pane = this._getOrCreatePane(paneIndex);
		
		if (height > 0) {
			pane.setStretchFactor(height * DEFAULT_STRETCH_FACTOR / 100);
		}

		// Create pane data entry
		const paneData: PaneData = {
			id: `pane_${this._nextPaneId++}`,
			title: `Pane ${paneIndex}`,
			series: [],
			height: height
		};
		this._paneDataMap.set(paneIndex, paneData);

		this.fullUpdate();
		return paneIndex;
	}

	public deletePaneById(paneIndex: number): void {
		if (paneIndex === 0) {
			console.warn('Cannot delete the main chart pane');
			return;
		}

		if (paneIndex >= this._panes.length || paneIndex < 0) {
			console.warn('Invalid pane index:', paneIndex);
			return;
		}

		// Remove all series from this pane first
		const pane = this._panes[paneIndex];
		const seriesToRemove = pane.series().slice(); // Make a copy
		seriesToRemove.forEach(series => {
			this.removeSeries(series);
		});

		// Remove the pane data
		this._paneDataMap.delete(paneIndex);

		// Remove the pane itself
		this.removePane(paneIndex);
		
		// Adjust the pane data map indices for panes that were shifted down
		const updatedPaneDataMap = new Map<number, PaneData>();
		this._paneDataMap.forEach((data, index) => {
			if (index > paneIndex) {
				updatedPaneDataMap.set(index - 1, data);
			} else {
				updatedPaneDataMap.set(index, data);
			}
		});
		this._paneDataMap = updatedPaneDataMap;

		this.fullUpdate();
	}

	public getPaneById(paneIndex: number): Pane | null {
		if (paneIndex >= 0 && paneIndex < this._panes.length) {
			return this._panes[paneIndex];
		}
		return null;
	}

	public addTrendline(data: TrendlineData, options?: any): string {
    const trendline = new Trendline(data, options);
    this._getCurrentSymbolTrendlines().set(data.id, trendline);
    this._saveTrendlinesToStorage().catch(console.error);
    this.fullUpdate();
    return data.id;
}

public removeTrendline(id: string): void {
    if (this._getCurrentSymbolTrendlines().delete(id)) {
        this._saveTrendlinesToStorage().catch(console.error);
        this.fullUpdate();
    }
}

public updateTrendline(id: string, data?: Partial<TrendlineData>, options?: any): void {
    const trendline = this._getCurrentSymbolTrendlines().get(id);
    if (trendline) {
        if (data) {
            trendline.updateData(data);
        }
        if (options) {
            trendline.updateOptions(options);
        }
        this._saveTrendlinesToStorage().catch(console.error);
        this.fullUpdate();
    }
}

public trendlines(): Map<string, Trendline> {
    return this._getCurrentSymbolTrendlines();
}

public trendline(id: string): Trendline | undefined {
    return this._getCurrentSymbolTrendlines().get(id);
}

public addFibonacci(data: any, options?: any): string {
    console.log('Model addFibonacci: received data:', data);
    
    const fibonacciRetracement = new FibonacciRetracement(data, options);
    
    const map = this._getCurrentSymbolFibonacci();
    console.log('Model addFibonacci: storing with key:', data.id);
    map.set(data.id, fibonacciRetracement); // This should ADD, not replace the entire map
    
    this._saveFibonacciToStorage();
    this.fullUpdate();
    return data.id;
}

public removeFibonacci(id: string): void {
    this._getCurrentSymbolFibonacci().delete(id);
    this._saveFibonacciToStorage();
    this.fullUpdate();
}

public updateFibonacci(id: string, point1?: any, point2?: any, options?: any): void {
    const fibonacci = this._getCurrentSymbolFibonacci().get(id);
    if (fibonacci) {
        const data = fibonacci.data() as any;
        
        // Update point1 if provided
        if (point1) {
            data._internal_point1._internal_time = point1.time;
            data._internal_point1._internal_value = point1.value;
            if (data.point1) {
                data.point1.time = point1.time;
                data.point1.value = point1.value;
            }
        }
        
        // Update point2 if provided
        if (point2) {
            data._internal_point2._internal_time = point2.time;
            data._internal_point2._internal_value = point2.value;
            if (data.point2) {
                data.point2.time = point2.time;
                data.point2.value = point2.value;
            }
        }
        
        // Update options if provided
        if (options) {
            fibonacci.applyOptions(options);
        }
        
        this._saveFibonacciToStorage();
        this.fullUpdate();
    }
}

public fibonacciRetracements(): Map<string, FibonacciRetracement> {
    return this._getCurrentSymbolFibonacci();
}

	public fullUpdate(): void {
		this._invalidate(InvalidateMask.full());
	}

	public lightUpdate(): void {
		this._invalidate(InvalidateMask.light());
	}

	public cursorUpdate(): void {
		this._invalidate(new InvalidateMask(InvalidationLevel.Cursor));
	}

	public updateSource(source: IPriceDataSource | IPrimitiveHitTestSource): void {
		const inv = this._invalidationMaskForSource(source);
		this._invalidate(inv);
	}

	public hoveredSource(): HoveredSource | null {
		return this._hoveredSource;
	}

	public setHoveredSource(source: HoveredSource | null): void {
		if (this._hoveredSource?.source === source?.source && this._hoveredSource?.object?.externalId === source?.object?.externalId) {
			return;
		}
		const prevSource = this._hoveredSource;
		this._hoveredSource = source;
		if (prevSource !== null) {
			this.updateSource(prevSource.source);
		}
		// additional check to prevent unnecessary updates of same source
		if (source !== null && source.source !== prevSource?.source) {
			this.updateSource(source.source);
		}
	}

	public options(): Readonly<ChartOptionsInternal<HorzScaleItem>> {
		return this._options;
	}

	public applyOptions(options: DeepPartial<ChartOptionsInternal<HorzScaleItem>>): void {
		merge(this._options, options);

		this._panes.forEach((p: Pane) => p.applyScaleOptions(options));

		if (options.timeScale !== undefined) {
			this._timeScale.applyOptions(options.timeScale);
		}

		if (options.localization !== undefined) {
			this._timeScale.applyLocalizationOptions(options.localization);
		}

		if (options.leftPriceScale || options.rightPriceScale) {
			this._priceScalesOptionsChanged.fire();
		}

		this._backgroundTopColor = this._getBackgroundColor(BackgroundColorSide.Top);
		this._backgroundBottomColor = this._getBackgroundColor(BackgroundColorSide.Bottom);

		this.fullUpdate();
	}

	public applyPriceScaleOptions(priceScaleId: string, options: DeepPartial<PriceScaleOptions>, paneIndex: number = 0): void {
		const pane = this._panes[paneIndex];
		if (pane === undefined) {
			if (process.env.NODE_ENV === 'development') {
				throw new Error(`Trying to apply price scale options with incorrect pane index: ${paneIndex}`);
			}
			return;
		}

		// eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
		if (priceScaleId === DefaultPriceScaleId.Left) {
			merge(this._options, {
				leftPriceScale: options,
			});
			pane.applyScaleOptions({
				leftPriceScale: options,
			});

			this._priceScalesOptionsChanged.fire();
			this.fullUpdate();
			return;
		// eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
		} else if (priceScaleId === DefaultPriceScaleId.Right) {
			merge(this._options, {
				rightPriceScale: options,
			});
			pane.applyScaleOptions({
				rightPriceScale: options,
			});

			this._priceScalesOptionsChanged.fire();
			this.fullUpdate();
			return;
		}

		const res = this.findPriceScale(priceScaleId, paneIndex);

		if (res === null) {
			if (process.env.NODE_ENV === 'development') {
				throw new Error(`Trying to apply price scale options with incorrect ID: ${priceScaleId}`);
			}

			return;
		}

		res.priceScale.applyOptions(options);
		this._priceScalesOptionsChanged.fire();
	}

	public findPriceScale(priceScaleId: string, paneIndex: number): PriceScaleOnPane | null {
		const pane = this._panes[paneIndex];
		if (pane === undefined) {
			return null;
		}

		const priceScale = pane.priceScaleById(priceScaleId);
		if (priceScale !== null) {
			return {
				pane,
				priceScale,
			};
		}
		return null;
	}

	public timeScale(): TimeScale<HorzScaleItem> {
		return this._timeScale;
	}

	public panes(): readonly Pane[] {
		return this._panes;
	}

	public crosshairSource(): Crosshair {
		return this._crosshair;
	}

	public crosshairMoved(): ISubscription<TimePointIndex | null, Point | null, TouchMouseEventData | null> {
		return this._crosshairMoved;
	}

	public setPaneHeight(pane: Pane, height: number): void {
		pane.setHeight(height);
		this.recalculateAllPanes();
	}

	public setWidth(width: number): void {
		this._width = width;
		this._timeScale.setWidth(this._width);
		this._panes.forEach((pane: Pane) => pane.setWidth(width));
		this.recalculateAllPanes();
	}

	public removePane(index: number): void {
		if (this._panes.length === 1) {
			return;
		}

		assert(index >= 0 && index < this._panes.length, 'Invalid pane index');

		this._panes.splice(index, 1);
		this.fullUpdate();
	}

	public changePanesHeight(paneIndex: number, height: number): void {
		if (this._panes.length < 2) {
			return;
		}

		assert(paneIndex >= 0 && paneIndex < this._panes.length, 'Invalid pane index');
		const targetPane = this._panes[paneIndex];

		const totalStretch = this._panes.reduce((prevValue: number, pane: Pane) => prevValue + pane.stretchFactor(), 0);
		const totalHeight = this._panes.reduce((prevValue: number, pane: Pane) => prevValue + pane.height(), 0);
		const maxPaneHeight = totalHeight - MIN_PANE_HEIGHT * (this._panes.length - 1);
		height = Math.min(maxPaneHeight, Math.max(MIN_PANE_HEIGHT, height));
		const pixelStretchFactor = totalStretch / totalHeight;

		const oldHeight = targetPane.height();
		targetPane.setStretchFactor(height * pixelStretchFactor);

		let otherPanesChange = height - oldHeight;
		let panesCount = this._panes.length - 1;

		for (const pane of this._panes) {
			if (pane !== targetPane) {
				const newPaneHeight = Math.min(maxPaneHeight, Math.max(30, pane.height() - otherPanesChange / panesCount));
				otherPanesChange -= (pane.height() - newPaneHeight);
				panesCount -= 1;
				const newStretchFactor = newPaneHeight * pixelStretchFactor;
				pane.setStretchFactor(newStretchFactor);
			}
		}

		this.fullUpdate();
	}

	public swapPanes(first: number, second: number): void {
		assert(first >= 0 && first < this._panes.length && second >= 0 && second < this._panes.length, 'Invalid pane index');
		const firstPane = this._panes[first];
		const secondPane = this._panes[second];
		this._panes[first] = secondPane;
		this._panes[second] = firstPane;
		this.fullUpdate();
	}

	public startScalePrice(pane: Pane, priceScale: PriceScale, x: number): void {
		pane.startScalePrice(priceScale, x);
	}

	public scalePriceTo(pane: Pane, priceScale: PriceScale, x: number): void {
		pane.scalePriceTo(priceScale, x);
		this.updateCrosshair();
		this._invalidate(this._paneInvalidationMask(pane, InvalidationLevel.Light));
	}

	public endScalePrice(pane: Pane, priceScale: PriceScale): void {
		pane.endScalePrice(priceScale);
		this._invalidate(this._paneInvalidationMask(pane, InvalidationLevel.Light));
	}

	public startScrollPrice(pane: Pane, priceScale: PriceScale, x: number): void {
		if (priceScale.isAutoScale()) {
			return;
		}
		pane.startScrollPrice(priceScale, x);
	}

	public scrollPriceTo(pane: Pane, priceScale: PriceScale, x: number): void {
		if (priceScale.isAutoScale()) {
			return;
		}
		pane.scrollPriceTo(priceScale, x);
		this.updateCrosshair();
		this._invalidate(this._paneInvalidationMask(pane, InvalidationLevel.Light));
	}

	public endScrollPrice(pane: Pane, priceScale: PriceScale): void {
		if (priceScale.isAutoScale()) {
			return;
		}
		pane.endScrollPrice(priceScale);
		this._invalidate(this._paneInvalidationMask(pane, InvalidationLevel.Light));
	}

	public resetPriceScale(pane: Pane, priceScale: PriceScale): void {
		pane.resetPriceScale(priceScale);
		this._invalidate(this._paneInvalidationMask(pane, InvalidationLevel.Light));
	}

	public startScaleTime(position: Coordinate): void {
		this._timeScale.startScale(position);
	}

	/**
	 * Zoom in/out the chart (depends on scale value).
	 *
	 * @param pointX - X coordinate of the point to apply the zoom (the point which should stay on its place)
	 * @param scale - Zoom value. Negative value means zoom out, positive - zoom in.
	 */
	public zoomTime(pointX: Coordinate, scale: number): void {
		const timeScale = this.timeScale();
		if (timeScale.isEmpty() || scale === 0) {
			return;
		}

		const timeScaleWidth = timeScale.width();
		pointX = Math.max(1, Math.min(pointX, timeScaleWidth)) as Coordinate;

		timeScale.zoom(pointX, scale);

		this.recalculateAllPanes();
	}

	public scrollChart(x: Coordinate): void {
		this.startScrollTime(0 as Coordinate);
		this.scrollTimeTo(x);
		this.endScrollTime();
	}

	public scaleTimeTo(x: Coordinate): void {
		this._timeScale.scaleTo(x);
		this.recalculateAllPanes();
	}

	public endScaleTime(): void {
		this._timeScale.endScale();
		this.lightUpdate();
	}

	public startScrollTime(x: Coordinate): void {
		this._timeScale.startScroll(x);
	}

	public scrollTimeTo(x: Coordinate): void {
		this._timeScale.scrollTo(x);
		this.recalculateAllPanes();
	}

	public endScrollTime(): void {
		this._timeScale.endScroll();
		this.lightUpdate();
	}

	public serieses(): readonly Series<SeriesType>[] {
		return this._serieses;
	}

	public setAndSaveCurrentPosition(x: Coordinate, y: Coordinate, event: TouchMouseEventData | null, pane: Pane, skipEvent?: boolean): void {
		this._crosshair.saveOriginCoord(x, y);
		let price = NaN;
		let index = this._timeScale.coordinateToIndex(x, true);

		const visibleBars = this._timeScale.visibleStrictRange();
		if (visibleBars !== null) {
			index = Math.min(Math.max(visibleBars.left(), index), visibleBars.right()) as TimePointIndex;
		}

		const priceScale = pane.defaultPriceScale();
		const firstValue = priceScale.firstValue();
		if (firstValue !== null) {
			price = priceScale.coordinateToPrice(y, firstValue);
		}
		price = this._magnet.align(price, index, pane);

		this._crosshair.setPosition(index, price, pane);

		this.cursorUpdate();
		if (!skipEvent) {
			const hitTest = hitTestPane(pane, x, y);
			this.setHoveredSource(hitTest && { source: hitTest.source, object: hitTest.object, cursorStyle: hitTest.cursorStyle || null });
			this._crosshairMoved.fire(this._crosshair.appliedIndex(), { x, y }, event);
		}
	}

	// A position provided external (not from an internal event listener)
	public setAndSaveSyntheticPosition(price: number, horizontalPosition: HorzScaleItem, pane: Pane): void {
		const priceScale = pane.defaultPriceScale();
		const firstValue = priceScale.firstValue();
		const y = priceScale.priceToCoordinate(price, ensureNotNull(firstValue));
		const index = this._timeScale.timeToIndex(horizontalPosition as InternalHorzScaleItem, true);
		const x = this._timeScale.indexToCoordinate(ensureNotNull(index));
		this.setAndSaveCurrentPosition(x, y, null, pane, true);
	}

	public clearCurrentPosition(skipEvent?: boolean): void {
		const crosshair = this.crosshairSource();
		crosshair.clearPosition();
		this.cursorUpdate();
		if (!skipEvent) {
			this._crosshairMoved.fire(null, null, null);
		}
	}

	public updateCrosshair(): void {
		// apply magnet
		const pane = this._crosshair.pane();
		if (pane !== null) {
			const x = this._crosshair.originCoordX();
			const y = this._crosshair.originCoordY();
			this.setAndSaveCurrentPosition(x, y, null, pane);
		}

		this._crosshair.updateAllViews();
	}

	public updateTimeScale(newBaseIndex: TimePointIndex | null, newPoints?: readonly TimeScalePoint[], firstChangedPointIndex?: number): void {
		const oldFirstTime = this._timeScale.indexToTime(0 as TimePointIndex);

		if (newPoints !== undefined && firstChangedPointIndex !== undefined) {
			this._timeScale.update(newPoints, firstChangedPointIndex);
		}

		const newFirstTime = this._timeScale.indexToTime(0 as TimePointIndex);

		const currentBaseIndex = this._timeScale.baseIndex();
		const visibleBars = this._timeScale.visibleStrictRange();

		// if time scale cannot return current visible bars range (e.g. time scale has zero-width)
		// then we do not need to update right offset to shift visible bars range to have the same right offset as we have before new bar
		// (and actually we cannot)
		if (visibleBars !== null && oldFirstTime !== null && newFirstTime !== null) {
			const isLastSeriesBarVisible = visibleBars.contains(currentBaseIndex);
			const isLeftBarShiftToLeft = this._horzScaleBehavior.key(oldFirstTime) > this._horzScaleBehavior.key(newFirstTime);
			const isSeriesPointsAdded = newBaseIndex !== null && newBaseIndex > currentBaseIndex;
			const isSeriesPointsAddedToRight = isSeriesPointsAdded && !isLeftBarShiftToLeft;

			const allowShiftWhenReplacingWhitespace = this._timeScale.options().allowShiftVisibleRangeOnWhitespaceReplacement;
			const replacedExistingWhitespace = firstChangedPointIndex === undefined;
			const needShiftVisibleRangeOnNewBar = isLastSeriesBarVisible && (!replacedExistingWhitespace || allowShiftWhenReplacingWhitespace) && this._timeScale.options().shiftVisibleRangeOnNewBar;
			if (isSeriesPointsAddedToRight && !needShiftVisibleRangeOnNewBar) {
				const compensationShift = newBaseIndex - currentBaseIndex;
				this._timeScale.setRightOffset(this._timeScale.rightOffset() - compensationShift);
			}
		}

		this._timeScale.setBaseIndex(newBaseIndex);
	}

	public recalculatePane(pane: Pane | null): void {
		if (pane !== null) {
			pane.recalculate();
		}
	}

	public paneForSource(source: IPriceDataSource | IPrimitiveHitTestSource): Pane | null {
		if (isPanePrimitive(source)) {
			return source as Pane;
		}
		const pane = this._panes.find((p: Pane) => p.orderedSources().includes(source));
		return pane === undefined ? null : pane;
	}

	public recalculateAllPanes(): void {
		this._panes.forEach((p: Pane) => p.recalculate());
		this.updateCrosshair();
	}

	public destroy(): void {
		this._panes.forEach((p: Pane) => p.destroy());
		this._panes.length = 0;

		// to avoid memleaks
		this._options.localization.priceFormatter = undefined;
		this._options.localization.percentageFormatter = undefined;
		this._options.localization.timeFormatter = undefined;
	}

	public rendererOptionsProvider(): PriceAxisRendererOptionsProvider {
		return this._rendererOptionsProvider;
	}

	public priceAxisRendererOptions(): Readonly<PriceAxisViewRendererOptions> {
		return this._rendererOptionsProvider.options();
	}

	public priceScalesOptionsChanged(): ISubscription {
		return this._priceScalesOptionsChanged;
	}

	public addSeriesToPane<T extends SeriesType>(
		series: Series<T>,
		paneIndex: number
	): void {
		const pane = this._getOrCreatePane(paneIndex);
		this._addSeriesToPane(series, pane);

		this._serieses.push(series);
		if (this._serieses.length === 1) {
			// call fullUpdate to recalculate chart's parts geometry
			this.fullUpdate();
		} else {
			this.lightUpdate();
		}
	}

	public removeSeries(series: Series<SeriesType>): void {
		const pane = this.paneForSource(series);

		const seriesIndex = this._serieses.indexOf(series);
		assert(seriesIndex !== -1, 'Series not found');
		const paneImpl = ensureNotNull(pane);
		this._serieses.splice(seriesIndex, 1);
		paneImpl.removeDataSource(series);
		if (series.destroy) {
			series.destroy();
		}

		this._timeScale.recalculateIndicesWithData();

		this._cleanupIfPaneIsEmpty(paneImpl);
	}

	public moveSeriesToScale(series: ISeries<SeriesType>, targetScaleId: string): void {
		const pane = ensureNotNull(this.paneForSource(series));
		pane.removeDataSource(series, true);
		pane.addDataSource(series, targetScaleId, true);
	}

	public fitContent(): void {
		const mask = InvalidateMask.light();
		mask.setFitContent();
		this._invalidate(mask);
	}

	public setTargetLogicalRange(range: LogicalRange): void {
		const mask = InvalidateMask.light();
		mask.applyRange(range);
		this._invalidate(mask);
	}

	public resetTimeScale(): void {
		const mask = InvalidateMask.light();
		mask.resetTimeScale();
		this._invalidate(mask);
	}

	public setBarSpacing(spacing: number): void {
		const mask = InvalidateMask.light();
		mask.setBarSpacing(spacing);
		this._invalidate(mask);
	}

	public setRightOffset(offset: number): void {
		const mask = InvalidateMask.light();
		mask.setRightOffset(offset);
		this._invalidate(mask);
	}

	public setTimeScaleAnimation(animation: ITimeScaleAnimation): void {
		const mask = InvalidateMask.light();
		mask.setTimeScaleAnimation(animation);
		this._invalidate(mask);
	}

	public stopTimeScaleAnimation(): void {
		const mask = InvalidateMask.light();
		mask.stopTimeScaleAnimation();
		this._invalidate(mask);
	}

	public defaultVisiblePriceScaleId(): string {
		return this._options.rightPriceScale.visible ? DefaultPriceScaleId.Right : DefaultPriceScaleId.Left;
	}

	public moveSeriesToPane(series: Series<SeriesType>, newPaneIndex: number): void {
		assert(newPaneIndex >= 0, 'Index should be greater or equal to 0');
		const fromPaneIndex = this._seriesPaneIndex(series);
		if (newPaneIndex === fromPaneIndex) {
			return;
		}

		const previousPane = ensureNotNull(this.paneForSource(series));
		previousPane.removeDataSource(series);
		const newPane = this._getOrCreatePane(newPaneIndex);
		this._addSeriesToPane(series, newPane);

		if (previousPane.dataSources().length === 0) {
			this._cleanupIfPaneIsEmpty(previousPane);
		}
	}

	public backgroundBottomColor(): string {
		return this._backgroundBottomColor;
	}

	public backgroundTopColor(): string {
		return this._backgroundTopColor;
	}

	public backgroundColorAtYPercentFromTop(percent: number): string {
		const bottomColor = this._backgroundBottomColor;
		const topColor = this._backgroundTopColor;

		if (bottomColor === topColor) {
			// solid background
			return bottomColor;
		}

		// gradient background

		// percent should be from 0 to 100 (we're using only integer values to make cache more efficient)
		percent = Math.max(0, Math.min(100, Math.round(percent * 100)));

		if (this._gradientColorsCache === null ||
			this._gradientColorsCache.topColor !== topColor || this._gradientColorsCache.bottomColor !== bottomColor) {
			this._gradientColorsCache = {
				topColor: topColor,
				bottomColor: bottomColor,
				colors: new Map(),
			};
		} else {
			const cachedValue = this._gradientColorsCache.colors.get(percent);
			if (cachedValue !== undefined) {
				return cachedValue;
			}
		}

		const result = this._colorParser.gradientColorAtPercent(topColor, bottomColor, percent / 100);
		this._gradientColorsCache.colors.set(percent, result);
		return result;
	}

	public getPaneIndex(pane: Pane): number {
		return this._panes.indexOf(pane);
	}

	public colorParser(): ColorParser {
		return this._colorParser;
	}

	private _getOrCreatePane(index: number): Pane {
		assert(index >= 0, 'Index should be greater or equal to 0');
		index = Math.min(this._panes.length, index);
		if (index < this._panes.length) {
			return this._panes[index];
		}

		const pane = new Pane(this._timeScale, this);
		this._panes.push(pane);

		// we always do autoscaling on the creation
		// if autoscale option is true, it is ok, just recalculate by invalidation mask
		// if autoscale option is false, autoscale anyway on the first draw
		// also there is a scenario when autoscale is true in constructor and false later on applyOptions
		const mask = InvalidateMask.full();
		mask.invalidatePane(index, {
			level: InvalidationLevel.None,
			autoScale: true,
		});
		this._invalidate(mask);
		return pane;
	}

	private _seriesPaneIndex(series: Series<SeriesType>): number {
		return this._panes.findIndex((pane: Pane) => pane.series().includes(series));
	}

	private _paneInvalidationMask(pane: Pane | null, level: InvalidationLevel): InvalidateMask {
		const inv = new InvalidateMask(level);
		if (pane !== null) {
			const index = this._panes.indexOf(pane);
			inv.invalidatePane(index, {
				level,
			});
		}
		return inv;
	}

	private _invalidationMaskForSource(source: IPriceDataSource | IPrimitiveHitTestSource, invalidateType?: InvalidationLevel): InvalidateMask {
		if (invalidateType === undefined) {
			invalidateType = InvalidationLevel.Light;
		}

		return this._paneInvalidationMask(this.paneForSource(source), invalidateType);
	}

	private _invalidate(mask: InvalidateMask): void {
		if (this._invalidateHandler) {
			this._invalidateHandler(mask);
		}

		this._panes.forEach((pane: Pane) => pane.grid().paneView().update());
	}

	private _addSeriesToPane(series: Series<SeriesType>, pane: Pane): void {
		const priceScaleId = series.options().priceScaleId;
		const targetScaleId: string = priceScaleId !== undefined ? priceScaleId : this.defaultVisiblePriceScaleId();
		pane.addDataSource(series, targetScaleId);

		if (!isDefaultPriceScale(targetScaleId)) {
			// let's apply that options again to apply margins
			series.applyOptions(series.options());
		}
	}

	private _getBackgroundColor(side: BackgroundColorSide): string {
		const layoutOptions = this._options['layout'];

		if (layoutOptions.background.type === ColorType.VerticalGradient) {
			return side === BackgroundColorSide.Top ?
				layoutOptions.background.topColor :
				layoutOptions.background.bottomColor;
		}

		return layoutOptions.background.color;
	}

	private _cleanupIfPaneIsEmpty(pane: Pane): void {
		if (pane.dataSources().length === 0 && this._panes.length > 1) {
			this._panes.splice(this.getPaneIndex(pane), 1);
			this.fullUpdate();
		}
	}

	public setTrendlineDrawingState(isDrawing: boolean): void {
    this._isDrawingTrendline = isDrawing;
    if (!isDrawing) {
        this._trendlineStartPoint = null;
        this._trendlinePreviewEnd = null;
    }
}

public isDrawingTrendline(): boolean {
    return this._isDrawingTrendline;
}

public setTrendlineStartPoint(point: { x: number; y: number; time: number; price: number } | null): void {
    this._trendlineStartPoint = point;
}

public getTrendlineStartPoint(): { x: number; y: number; time: number; price: number } | null {
    return this._trendlineStartPoint;
}

public setTrendlinePreviewEnd(point: { x: number; y: number; time: number; price: number } | null): void {
    this._trendlinePreviewEnd = point;
}

public getTrendlinePreviewEnd(): { x: number; y: number; time: number; price: number } | null {
    return this._trendlinePreviewEnd;

}
}