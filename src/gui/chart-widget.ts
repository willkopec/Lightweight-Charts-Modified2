import { Size, size } from 'fancy-canvas';

import { Pane } from '../model/pane';
import { ensureDefined, ensureNotNull } from '../helpers/assertions';
import { isChromiumBased, isWindows } from '../helpers/browsers';
import { Delegate } from '../helpers/delegate';
import { IDestroyable } from '../helpers/idestroyable';
import { ISubscription } from '../helpers/isubscription';
import { warn } from '../helpers/logger';
import { DeepPartial } from '../helpers/strict-type-checks';

import { ChartModel, ChartOptionsInternal, ChartOptionsInternalBase, IChartModelBase } from '../model/chart-model';
import { Coordinate } from '../model/coordinate';
import { DefaultPriceScaleId } from '../model/default-price-scale';
import { IHorzScaleBehavior } from '../model/ihorz-scale-behavior';
import {
	InvalidateMask,
	InvalidationLevel,
	TimeScaleInvalidation,
	TimeScaleInvalidationType,
} from '../model/invalidate-mask';
import { Point } from '../model/point';
import { Series } from '../model/series';
import { SeriesPlotRow } from '../model/series-data';
import { SeriesType } from '../model/series-options';
import { TimePointIndex } from '../model/time-data';
import { TouchMouseEventData } from '../model/touch-mouse-event-data';

import { suggestChartSize, suggestPriceScaleWidth, suggestTimeScaleHeight } from './internal-layout-sizes-hints';
import { PaneSeparator, SeparatorConstants } from './pane-separator';
import { PaneWidget } from './pane-widget';
import { TimeAxisWidget } from './time-axis-widget';
import { ToolbarWidget, ToolbarCallbacks } from './toolbar-widget';

export interface MouseEventParamsImpl {
	originalTime?: unknown;
	index?: TimePointIndex;
	point?: Point;
	seriesData: Map<Series<SeriesType>, SeriesPlotRow<SeriesType>>;
	paneIndex?: number;
	hoveredSeries?: Series<SeriesType>;
	hoveredObject?: string;
	touchMouseEventData?: TouchMouseEventData;
}

export type MouseEventParamsImplSupplier = () => MouseEventParamsImpl;

const windowsChrome = isChromiumBased() && isWindows();

export interface IChartWidgetBase {
	getPriceAxisWidth(position: DefaultPriceScaleId): number;
	model(): IChartModelBase;
	paneWidgets(): PaneWidget[];
	options(): ChartOptionsInternalBase;
	setCursorStyle(style: string | null): void;
	isDrawingFibonacci(): boolean;
	getFibonacciStartPoint(): { x: number; y: number; time: number; price: number } | null;
	getFibonacciPreviewEnd(): { x: number; y: number; time: number; price: number } | null;
	setFibonacciPreviewEnd(previewEnd: { x: number; y: number; time: number; price: number }): void;
}

export class ChartWidget<HorzScaleItem> implements IDestroyable, IChartWidgetBase {
	private readonly _options: ChartOptionsInternal<HorzScaleItem>;
	private _paneWidgets: PaneWidget[] = [];
	private _paneSeparators: PaneSeparator[] = [];
	private readonly _model: ChartModel<HorzScaleItem>;
	private _drawRafId: number = 0;
	private _height: number = 0;
	private _width: number = 0;
	private _leftPriceAxisWidth: number = 0;
	private _rightPriceAxisWidth: number = 0;
	private _element: HTMLDivElement;
	private readonly _tableElement: HTMLElement;
	private _timeAxisWidget: TimeAxisWidget<HorzScaleItem>;
	private _invalidateMask: InvalidateMask | null = null;
	private _drawPlanned: boolean = false;
	private _clicked: Delegate<MouseEventParamsImplSupplier> = new Delegate();
	private _dblClicked: Delegate<MouseEventParamsImplSupplier> = new Delegate();
	private _crosshairMoved: Delegate<MouseEventParamsImplSupplier> = new Delegate();
	private _onWheelBound: (event: WheelEvent) => void;
	private _observer: ResizeObserver | null = null;

	private _container: HTMLElement;
	private _cursorStyleOverride: string | null = null;

	private _toolbarWidget: ToolbarWidget | null = null;
	private _isDrawingTrendline: boolean = false;
	private _trendlineStartPoint: { x: number; y: number; time: number; price: number } | null = null;
	private _trendlinePreviewEnd: { x: number; y: number; time: number; price: number } | null = null;
	private _originalCrosshairMode: number | null = null;

	private _isDrawingFibonacci: boolean = false;
	private _fibonacciStartPoint: { x: number; y: number; time: number; price: number } | null = null;
	private _fibonacciPreviewEnd: { x: number; y: number; time: number; price: number } | null = null

	private readonly _horzScaleBehavior: IHorzScaleBehavior<HorzScaleItem>;

	public constructor(container: HTMLElement, options: ChartOptionsInternal<HorzScaleItem>, horzScaleBehavior: IHorzScaleBehavior<HorzScaleItem>) {
		this._container = container;
		this._options = options;
		this._horzScaleBehavior = horzScaleBehavior;

		this._element = document.createElement('div');
		this._element.classList.add('tv-lightweight-charts');
		this._element.style.overflow = 'hidden';
		this._element.style.direction = 'ltr';
		this._element.style.width = '100%';
		this._element.style.height = '100%';
		disableSelection(this._element);

		this._tableElement = document.createElement('table');
		this._tableElement.setAttribute('cellspacing', '0');
		this._element.appendChild(this._tableElement);

		this._onWheelBound = this._onMousewheel.bind(this);
		if (shouldSubscribeMouseWheel(this._options)) {
			this._setMouseWheelEventListener(true);
		}
		this._model = new ChartModel(
			this._invalidateHandler.bind(this),
			this._options,
			horzScaleBehavior
		);
		this.model().crosshairMoved().subscribe(this._onPaneWidgetCrosshairMoved.bind(this), this);

		this._timeAxisWidget = new TimeAxisWidget(this, this._horzScaleBehavior);
		this._tableElement.appendChild(this._timeAxisWidget.getElement());

		const usedObserver = options.autoSize && this._installObserver();

		// observer could not fire event immediately for some cases
		// so we have to set initial size manually
		let width = this._options.width;
		let height = this._options.height;
		// ignore width/height options if observer has actually been used
		// however respect options if installing resize observer failed
		if (usedObserver || width === 0 || height === 0) {
			const containerRect = container.getBoundingClientRect();
			width = width || containerRect.width;
			height = height || containerRect.height;
		}

		// BEWARE: resize must be called BEFORE _syncGuiWithModel (in constructor only)
		// or after but with adjustSize to properly update time scale
		this.resize(width, height);

		this._syncGuiWithModel();

		container.appendChild(this._element);
		// Create and add toolbar with callbacks
		const toolbarCallbacks: ToolbarCallbacks = {
    		onTrendlineToolToggle: this._onTrendlineToolToggle.bind(this),
    		onFibonacciToolToggle: this._onFibonacciToolToggle.bind(this)
		};
		this._toolbarWidget = new ToolbarWidget(toolbarCallbacks);
		this._element.appendChild(this._toolbarWidget.getElement());
		this._updateTimeAxisVisibility();
		this._model.timeScale().optionsApplied().subscribe(this._model.fullUpdate.bind(this._model), this);
		this._model.priceScalesOptionsChanged().subscribe(this._model.fullUpdate.bind(this._model), this);
	}

	public model(): ChartModel<HorzScaleItem> {
		return this._model;
	}

	public options(): Readonly<ChartOptionsInternal<HorzScaleItem>> {
		return this._options;
	}

	public paneWidgets(): PaneWidget[] {
		return this._paneWidgets;
	}

	public timeAxisWidget(): TimeAxisWidget<HorzScaleItem> {
		return this._timeAxisWidget;
	}

	public destroy(): void {
		this._setMouseWheelEventListener(false);
		if (this._drawRafId !== 0) {
			window.cancelAnimationFrame(this._drawRafId);
		}

		if (this._toolbarWidget !== null) {
    		this._toolbarWidget.destroy();
    		this._toolbarWidget = null;
		}

		this._model.crosshairMoved().unsubscribeAll(this);
		this._model.timeScale().optionsApplied().unsubscribeAll(this);
		this._model.priceScalesOptionsChanged().unsubscribeAll(this);
		this._model.destroy();

		for (const paneWidget of this._paneWidgets) {
			this._tableElement.removeChild(paneWidget.getElement());
			paneWidget.clicked().unsubscribeAll(this);
			paneWidget.dblClicked().unsubscribeAll(this);
			paneWidget.destroy();
		}
		this._paneWidgets = [];

		for (const paneSeparator of this._paneSeparators) {
			this._destroySeparator(paneSeparator);
		}
		this._paneSeparators = [];

		ensureNotNull(this._timeAxisWidget).destroy();

		if (this._element.parentElement !== null) {
			this._element.parentElement.removeChild(this._element);
		}

		this._crosshairMoved.destroy();
		this._clicked.destroy();
		this._dblClicked.destroy();

		this._uninstallObserver();
	}

	public resize(width: number, height: number, forceRepaint: boolean = false): void {
		if (this._height === height && this._width === width) {
			return;
		}

		const sizeHint = suggestChartSize(size({ width, height }));

		this._height = sizeHint.height;
		this._width = sizeHint.width;

		const heightStr = this._height + 'px';
		const widthStr = this._width + 'px';

		ensureNotNull(this._element).style.height = heightStr;
		ensureNotNull(this._element).style.width = widthStr;

		this._tableElement.style.height = heightStr;
		this._tableElement.style.width = widthStr;

		if (forceRepaint) {
			this._drawImpl(InvalidateMask.full(), performance.now());
		} else {
			this._model.fullUpdate();
		}
	}

	public paint(invalidateMask?: InvalidateMask): void {
		if (invalidateMask === undefined) {
			invalidateMask = InvalidateMask.full();
		}

		for (let i = 0; i < this._paneWidgets.length; i++) {
			this._paneWidgets[i].paint(invalidateMask.invalidateForPane(i).level);
		}

		if (this._options.timeScale.visible) {
			this._timeAxisWidget.paint(invalidateMask.fullInvalidation());
		}
	}

	public applyOptions(options: DeepPartial<ChartOptionsInternal<HorzScaleItem>>): void {
		const currentlyHasMouseWheelListener = shouldSubscribeMouseWheel(this._options);

		// we don't need to merge options here because it's done in chart model
		// and since both model and widget share the same object it will be done automatically for widget as well
		// not ideal solution for sure, but it work's for now ¯\_(ツ)_/¯
		this._model.applyOptions(options);

		const shouldHaveMouseWheelListener = shouldSubscribeMouseWheel(this._options);
		if (shouldHaveMouseWheelListener !== currentlyHasMouseWheelListener) {
			this._setMouseWheelEventListener(shouldHaveMouseWheelListener);
		}

		if (options['layout']?.panes) {
			this._applyPanesOptions();
		}
		this._updateTimeAxisVisibility();

		this._applyAutoSizeOptions(options);
	}

	public clicked(): ISubscription<MouseEventParamsImplSupplier> {
		return this._clicked;
	}

	public dblClicked(): ISubscription<MouseEventParamsImplSupplier> {
		return this._dblClicked;
	}

	public crosshairMoved(): ISubscription<MouseEventParamsImplSupplier> {
		return this._crosshairMoved;
	}

	public takeScreenshot(): HTMLCanvasElement {
		if (this._invalidateMask !== null) {
			this._drawImpl(this._invalidateMask, performance.now());
			this._invalidateMask = null;
		}

		const screeshotBitmapSize = this._traverseLayout(null);
		const screenshotCanvas = document.createElement('canvas');
		screenshotCanvas.width = screeshotBitmapSize.width;
		screenshotCanvas.height = screeshotBitmapSize.height;

		const ctx = ensureNotNull(screenshotCanvas.getContext('2d'));
		this._traverseLayout(ctx);

		return screenshotCanvas;
	}

	public getPriceAxisWidth(position: DefaultPriceScaleId): number {
		if (position === DefaultPriceScaleId.Left && !this._isLeftAxisVisible()) {
			return 0;
		}

		if (position === DefaultPriceScaleId.Right && !this._isRightAxisVisible()) {
			return 0;
		}

		if (this._paneWidgets.length === 0) {
			return 0;
		}

		// we don't need to worry about exactly pane widget here
		// because all pane widgets have the same width of price axis widget
		// see _adjustSizeImpl
		const priceAxisWidget = position === DefaultPriceScaleId.Left
			? this._paneWidgets[0].leftPriceAxisWidget()
			: this._paneWidgets[0].rightPriceAxisWidget();
		return ensureNotNull(priceAxisWidget).getWidth();
	}

	public autoSizeActive(): boolean {
		return this._options.autoSize && this._observer !== null;
	}

	public element(): HTMLDivElement {
		return this._element;
	}

	public setCursorStyle(style: string | null): void {
		this._cursorStyleOverride = style;
		if (this._cursorStyleOverride) {
			this.element().style.setProperty('cursor', style);
		} else {
			this.element().style.removeProperty('cursor');
		}
	}

	public getCursorOverrideStyle(): string | null {
		return this._cursorStyleOverride;
	}

	public paneSize(paneIndex: number): Size {
		return ensureDefined(this._paneWidgets[paneIndex]).getSize();
	}

	public setAndSaveCurrentPosition(x: Coordinate, y: Coordinate, event: TouchMouseEventData | null, pane: Pane, skipEvent?: boolean): void {
    
    // Update trendline preview if we're in drawing mode and have a start point
    if (this._isDrawingTrendline && this._trendlineStartPoint) {
        console.log('Updating trendline preview at:', x, y);
        this._updateTrendlinePreview(x, y, pane);
    }

	if (this._isDrawingFibonacci && this._fibonacciStartPoint) {
    console.log('Updating fibonacci preview at:', x, y);
    this._updateFibonacciPreview(x, y, pane);
}
    
    // Normal crosshair position update
    this._model.setAndSaveCurrentPosition(x, y, event, pane, skipEvent);
}

private _updateTrendlinePreview(x: Coordinate, y: Coordinate, pane: Pane): void {
    const priceScale = pane.defaultPriceScale();
    const firstValue = priceScale.firstValue();
    if (firstValue === null) {
        return;
    }
    
    const price = priceScale.coordinateToPrice(y, firstValue);
    if (price === null) {
        return;
    }
    
    let timeValue: number;
    
    // Use the same time calculation logic as trendline creation
    const timeScale = this._model.timeScale() as any;
    const baseIndex = timeScale._internal_baseIndex();
    const baseCoord = timeScale._internal_indexToCoordinate(baseIndex);
    
    if (baseCoord !== null && x > baseCoord) {
        timeValue = this._extrapolateTimeFromCoordinate(x);
    } else {
        const index = timeScale.coordinateToIndex(x);
        if (index !== null && index !== undefined) {
            const timePoint = timeScale.indexToTimeScalePoint(index)?.originalTime;
            timeValue = timePoint !== undefined ? (timePoint as number) : this._extrapolateTimeFromCoordinate(x);
        } else {
            timeValue = this._extrapolateTimeFromCoordinate(x);
        }
    }
    
    // Update the preview end point
    this._trendlinePreviewEnd = {
        x: x,
        y: y,
        time: timeValue,
        price: price
    };
    
    console.log('Updated trendline preview:', this._trendlinePreviewEnd);
    
    // Trigger a light update to redraw
    this._model.lightUpdate();
}

private _updateFibonacciPreview(x: Coordinate, y: Coordinate, pane: Pane): void {
    const priceScale = pane.defaultPriceScale();
    const firstValue = priceScale.firstValue();
    if (firstValue === null) {
        return;
    }
    
    const price = priceScale.coordinateToPrice(y, firstValue);
    if (price === null) {
        return;
    }
    
    let timeValue: number;
    
    // Use the same time calculation logic as trendline creation
    const timeScale = this._model.timeScale() as any;
    const baseIndex = timeScale._internal_baseIndex();
    const baseCoord = timeScale._internal_indexToCoordinate(baseIndex);
    
    if (baseCoord !== null && x > baseCoord) {
        timeValue = this._extrapolateTimeFromCoordinate(x);
    } else {
        const index = timeScale.coordinateToIndex(x);
        if (index !== null && index !== undefined) {
            const timePoint = timeScale.indexToTimeScalePoint(index)?.originalTime;
            timeValue = timePoint !== undefined ? (timePoint as number) : this._extrapolateTimeFromCoordinate(x);
        } else {
            timeValue = this._extrapolateTimeFromCoordinate(x);
        }
    }
    
    // Update the preview end point
    this._fibonacciPreviewEnd = {
        x: x,
        y: y,
        time: timeValue,
        price: price
    };
    
    console.log('Updated fibonacci preview:', this._fibonacciPreviewEnd);
    
    // Trigger a light update to redraw
    this._model.lightUpdate();
}

	private _onTrendlineToolToggle(active: boolean): void {
    console.log('Trendline tool toggled:', active ? 'ON' : 'OFF');
    
    this._isDrawingTrendline = active;
    this._trendlineStartPoint = null;
    this._trendlinePreviewEnd = null;
    
    // Store state in model so pane widgets can access it
    this._model.setTrendlineDrawingState(active);
    
    const crosshair = this._model.crosshairSource();
    
    if (active) {
        console.log('Activating trendline drawing mode');
        
        this.setCursorStyle('default');

        // Force crosshair to be visible and in drawing mode
        crosshair._visible = true;
        
        // Set drawing mode FIRST before other operations
        crosshair._showCenterDot = true;
        console.log('Crosshair drawing mode set, isDrawingMode =', crosshair.isDrawingMode());
        
        // Store original crosshair mode and switch to Normal mode (no snapping)
        const currentOptions = this._model.options();
        console.log('Current crosshair mode before change:', currentOptions.crosshair.mode);
        this._originalCrosshairMode = currentOptions.crosshair.mode;
        
        this._model.applyOptions({
            crosshair: {
                mode: 0 // CrosshairMode.Normal - follows mouse freely
            }
        });
        
        // Set initial position if we have mouse coordinates
        // This ensures the dot shows immediately when mode is activated
        const mousePos = this._getLastMousePosition();
        if (mousePos) {
            // Set initial crosshair position to show the dot
            crosshair._x = mousePos.x as Coordinate;
            crosshair._y = mousePos.y as Coordinate;
            crosshair._visible = true;
            
            // Calculate price for the initial position
            const panes = this._model.panes();
            if (panes.length > 0) {
                const pane = panes[0];
                const priceScale = pane.defaultPriceScale();
                const firstValue = priceScale.firstValue();
                if (firstValue !== null) {
                    crosshair._price = priceScale.coordinateToPrice(mousePos.y as Coordinate, firstValue);
                    crosshair._pane = pane;
                }
            }
        }
        
        // Force update all crosshair views
        crosshair.updateAllViews();
        this._model.fullUpdate();
        
        // Debug check
        console.log('Trendline drawing mode activated with crosshair state:', {
            visible: crosshair._visible,
            drawingMode: crosshair.isDrawingMode(),
            showCenterDot: crosshair._showCenterDot,
            x: crosshair._x,
            y: crosshair._y
        });
        
    } else {
        console.log('Deactivating trendline drawing mode');
        
        this.setCursorStyle(null);

        // Disable crosshair center dot
        crosshair._showCenterDot = false;
        
        // Restore original crosshair mode
        if (this._originalCrosshairMode !== null) {
            console.log('Restoring crosshair mode to:', this._originalCrosshairMode);
            this._model.applyOptions({
                crosshair: {
                    mode: this._originalCrosshairMode
                }
            });
            this._originalCrosshairMode = null;
        }
        
        // Force update when exiting trendline mode
        crosshair.updateAllViews();
        this._model.fullUpdate();
    }
}

// Helper method to get last known mouse position (you may need to track this)
private _getLastMousePosition(): { x: Coordinate; y: Coordinate } | null {
    // You might want to track the last mouse position in mouse move events
    // For now, return null if not available
    return null;
}

private _onFibonacciToolToggle(active: boolean): void {
    this._isDrawingFibonacci = active;
    this._fibonacciStartPoint = null;
	this._fibonacciPreviewEnd = null;
    console.log('Fibonacci drawing mode:', active ? 'ON' : 'OFF');
    
    if (active) {
        this.setCursorStyle('crosshair');
        
        // Store original crosshair mode and switch to Normal mode (no snapping)
        const currentOptions = this._model.options();
        this._originalCrosshairMode = currentOptions.crosshair.mode;
        
        this._model.applyOptions({
            crosshair: {
                mode: 0 // CrosshairMode.Normal - follows mouse freely
            }
        });
        
    } else {
        this.setCursorStyle(null);
        
        // Restore original crosshair mode
        if (this._originalCrosshairMode !== null) {
            this._model.applyOptions({
                crosshair: {
                    mode: this._originalCrosshairMode
                }
            });
            this._originalCrosshairMode = null;
        }
    }
}

	private _applyPanesOptions(): void {
		this._paneSeparators.forEach((separator: PaneSeparator) => {
			separator.update();
		});
	}

	// eslint-disable-next-line complexity
	private _applyAutoSizeOptions(options: DeepPartial<ChartOptionsInternal<HorzScaleItem>>): void {
		if (options.autoSize === undefined && this._observer && (options.width !== undefined || options.height !== undefined)) {
			warn(`You should turn autoSize off explicitly before specifying sizes; try adding options.autoSize: false to new options`);
			return;
		}
		if (options.autoSize && !this._observer) {
			// installing observer will override resize if successful
			this._installObserver();
		}

		if (options.autoSize === false && this._observer !== null) {
			this._uninstallObserver();
		}

		if (!options.autoSize && (options.width !== undefined || options.height !== undefined)) {
			this.resize(options.width || this._width, options.height || this._height);
		}
	}

	/**
	 * Traverses the widget's layout (pane and axis child widgets),
	 * draws the screenshot (if rendering context is passed) and returns the screenshot bitmap size
	 *
	 * @param ctx - if passed, used to draw the screenshot of widget
	 * @returns screenshot bitmap size
	 */
	private _traverseLayout(ctx: CanvasRenderingContext2D | null): Size {
		let totalWidth = 0;
		let totalHeight = 0;

		const firstPane = this._paneWidgets[0];

		const drawPriceAxises = (position: 'left' | 'right', targetX: number) => {
			let targetY = 0;
			for (let paneIndex = 0; paneIndex < this._paneWidgets.length; paneIndex++) {
				const paneWidget = this._paneWidgets[paneIndex];
				const priceAxisWidget = ensureNotNull(position === 'left' ? paneWidget.leftPriceAxisWidget() : paneWidget.rightPriceAxisWidget());
				const bitmapSize = priceAxisWidget.getBitmapSize();
				if (ctx !== null) {
					priceAxisWidget.drawBitmap(ctx, targetX, targetY);
				}
				targetY += bitmapSize.height;
				if (paneIndex < this._paneWidgets.length - 1) {
					const separator = this._paneSeparators[paneIndex];
					const separatorBitmapSize = separator.getBitmapSize();
					if (ctx !== null) {
						separator.drawBitmap(ctx, targetX, targetY);
					}
					targetY += separatorBitmapSize.height;
				}
			}
		};

		// draw left price scale if exists
		if (this._isLeftAxisVisible()) {
			drawPriceAxises('left', 0);
			const leftAxisBitmapWidth = ensureNotNull(firstPane.leftPriceAxisWidget()).getBitmapSize().width;
			totalWidth += leftAxisBitmapWidth;
		}
		for (let paneIndex = 0; paneIndex < this._paneWidgets.length; paneIndex++) {
			const paneWidget = this._paneWidgets[paneIndex];
			const bitmapSize = paneWidget.getBitmapSize();
			if (ctx !== null) {
				paneWidget.drawBitmap(ctx, totalWidth, totalHeight);
			}
			totalHeight += bitmapSize.height;
			if (paneIndex < this._paneWidgets.length - 1) {
				const separator = this._paneSeparators[paneIndex];
				const separatorBitmapSize = separator.getBitmapSize();
				if (ctx !== null) {
					separator.drawBitmap(ctx, totalWidth, totalHeight);
				}
				totalHeight += separatorBitmapSize.height;
			}
		}
		const firstPaneBitmapWidth = firstPane.getBitmapSize().width;
		totalWidth += firstPaneBitmapWidth;

		// draw right price scale if exists
		if (this._isRightAxisVisible()) {
			drawPriceAxises('right', totalWidth);
			const rightAxisBitmapWidth = ensureNotNull(firstPane.rightPriceAxisWidget()).getBitmapSize().width;
			totalWidth += rightAxisBitmapWidth;
		}

		const drawStub = (position: 'left' | 'right', targetX: number, targetY: number) => {
			const stub = ensureNotNull(position === 'left' ? this._timeAxisWidget.leftStub() : this._timeAxisWidget.rightStub());
			stub.drawBitmap(ensureNotNull(ctx), targetX, targetY);
		};

		// draw time scale and stubs
		if (this._options.timeScale.visible) {
			const timeAxisBitmapSize = this._timeAxisWidget.getBitmapSize();

			if (ctx !== null) {
				let targetX = 0;
				if (this._isLeftAxisVisible()) {
					drawStub('left', targetX, totalHeight);
					targetX = ensureNotNull(firstPane.leftPriceAxisWidget()).getBitmapSize().width;
				}

				this._timeAxisWidget.drawBitmap(ctx, targetX, totalHeight);
				targetX += timeAxisBitmapSize.width;

				if (this._isRightAxisVisible()) {
					drawStub('right', targetX, totalHeight);
				}
			}

			totalHeight += timeAxisBitmapSize.height;
		}

		return size({
			width: totalWidth,
			height: totalHeight,
		});
	}

	// eslint-disable-next-line complexity
	private _adjustSizeImpl(): void {
		let totalStretch = 0;
		let leftPriceAxisWidth = 0;
		let rightPriceAxisWidth = 0;

		for (const paneWidget of this._paneWidgets) {
			if (this._isLeftAxisVisible()) {
				leftPriceAxisWidth = Math.max(
					leftPriceAxisWidth,
					ensureNotNull(paneWidget.leftPriceAxisWidget()).optimalWidth(),
					this._options.leftPriceScale.minimumWidth
				);
			}
			if (this._isRightAxisVisible()) {
				rightPriceAxisWidth = Math.max(
					rightPriceAxisWidth,
					ensureNotNull(paneWidget.rightPriceAxisWidget()).optimalWidth(),
					this._options.rightPriceScale.minimumWidth
				);
			}
			totalStretch += paneWidget.stretchFactor();
		}

		leftPriceAxisWidth = suggestPriceScaleWidth(leftPriceAxisWidth);
		rightPriceAxisWidth = suggestPriceScaleWidth(rightPriceAxisWidth);

		const width = this._width;
		const height = this._height;

		const paneWidth = Math.max(width - leftPriceAxisWidth - rightPriceAxisWidth, 0);

		const separatorCount = this._paneSeparators.length;
		const separatorHeight = SeparatorConstants.SeparatorHeight;
		const separatorsHeight = separatorHeight * separatorCount;
		const timeAxisVisible = this._options.timeScale.visible;
		let timeAxisHeight = timeAxisVisible ? Math.max(this._timeAxisWidget.optimalHeight(), this._options.timeScale.minimumHeight) : 0;
		timeAxisHeight = suggestTimeScaleHeight(timeAxisHeight);

		const otherWidgetHeight = separatorsHeight + timeAxisHeight;
		const totalPaneHeight = height < otherWidgetHeight ? 0 : height - otherWidgetHeight;
		const stretchPixels = totalPaneHeight / totalStretch;

		let accumulatedHeight = 0;

		const pixelRatio = window.devicePixelRatio || 1;

		for (let paneIndex = 0; paneIndex < this._paneWidgets.length; ++paneIndex) {
			const paneWidget = this._paneWidgets[paneIndex];
			paneWidget.setState(this._model.panes()[paneIndex]);

			let paneHeight = 0;
			let calculatePaneHeight = 0;

			if (paneIndex === this._paneWidgets.length - 1) {
				calculatePaneHeight = Math.ceil((totalPaneHeight - accumulatedHeight) * pixelRatio) / pixelRatio;
			} else {
				calculatePaneHeight = Math.round(paneWidget.stretchFactor() * stretchPixels * pixelRatio) / pixelRatio;
			}

			paneHeight = Math.max(calculatePaneHeight, 2);

			accumulatedHeight += paneHeight;

			paneWidget.setSize(size({ width: paneWidth, height: paneHeight }));
			if (this._isLeftAxisVisible()) {
				paneWidget.setPriceAxisSize(leftPriceAxisWidth, 'left');
			}
			if (this._isRightAxisVisible()) {
				paneWidget.setPriceAxisSize(rightPriceAxisWidth, 'right');
			}

			if (paneWidget.state()) {
				this._model.setPaneHeight(paneWidget.state(), paneHeight);
			}
		}

		this._timeAxisWidget.setSizes(
			size({ width: timeAxisVisible ? paneWidth : 0, height: timeAxisHeight }),
			timeAxisVisible ? leftPriceAxisWidth : 0,
			timeAxisVisible ? rightPriceAxisWidth : 0
		);

		this._model.setWidth(paneWidth);
		if (this._leftPriceAxisWidth !== leftPriceAxisWidth) {
			this._leftPriceAxisWidth = leftPriceAxisWidth;
		}
		if (this._rightPriceAxisWidth !== rightPriceAxisWidth) {
			this._rightPriceAxisWidth = rightPriceAxisWidth;
		}
	}

	private _setMouseWheelEventListener(add: boolean): void {
		if (add) {
			this._element.addEventListener('wheel', this._onWheelBound, { passive: false });
			return;
		}
		this._element.removeEventListener('wheel', this._onWheelBound);
	}

	private _determineWheelSpeedAdjustment(event: WheelEvent): number {
		switch (event.deltaMode) {
			case event.DOM_DELTA_PAGE:
				// one screen at time scroll mode
				return 120;
			case event.DOM_DELTA_LINE:
				// one line at time scroll mode
				return 32;
		}

		if (!windowsChrome) {
			return 1;
		}

		// Chromium on Windows has a bug where the scroll speed isn't correctly
		// adjusted for high density displays. We need to correct for this so that
		// scroll speed is consistent between browsers.
		// https://bugs.chromium.org/p/chromium/issues/detail?id=1001735
		// https://bugs.chromium.org/p/chromium/issues/detail?id=1207308
		return (1 / window.devicePixelRatio);
	}

	private _onMousewheel(event: WheelEvent): void {
		if ((event.deltaX === 0 || !this._options['handleScroll'].mouseWheel) &&
			(event.deltaY === 0 || !this._options['handleScale'].mouseWheel)) {
			return;
		}

		const scrollSpeedAdjustment = this._determineWheelSpeedAdjustment(event);

		const deltaX = scrollSpeedAdjustment * event.deltaX / 100;
		const deltaY = -(scrollSpeedAdjustment * event.deltaY / 100);

		if (event.cancelable) {
			event.preventDefault();
		}

		if (deltaY !== 0 && this._options['handleScale'].mouseWheel) {
			const zoomScale = Math.sign(deltaY) * Math.min(1, Math.abs(deltaY));
			const scrollPosition = event.clientX - this._element.getBoundingClientRect().left;
			this.model().zoomTime(scrollPosition as Coordinate, zoomScale);
		}

		if (deltaX !== 0 && this._options['handleScroll'].mouseWheel) {
			this.model().scrollChart(deltaX * -80 as Coordinate); // 80 is a made up coefficient, and minus is for the "natural" scroll
		}
	}

	private _drawImpl(invalidateMask: InvalidateMask, time: number): void {
		const invalidationType = invalidateMask.fullInvalidation();

		// actions for full invalidation ONLY (not shared with light)
		if (invalidationType === InvalidationLevel.Full) {
			this._updateGui();
		}

		// light or full invalidate actions
		if (
			invalidationType === InvalidationLevel.Full ||
			invalidationType === InvalidationLevel.Light
		) {
			this._applyMomentaryAutoScale(invalidateMask);
			this._applyTimeScaleInvalidations(invalidateMask, time);

			this._timeAxisWidget.update();
			this._paneWidgets.forEach((pane: PaneWidget) => {
				pane.updatePriceAxisWidgets();
			});

			const trendlines = this._model.trendlines();
				this._paneWidgets.forEach((pane: PaneWidget) => {
    			pane.updateTrendlines(trendlines);
			});

			const fibonacciRetracements = this._model.fibonacciRetracements();
//console.log('Updating fibonacci retracements in pane widgets, map size:', fibonacciRetracements.size);
this._paneWidgets.forEach((pane: PaneWidget) => {
    pane.updateFibonacciRetracements(fibonacciRetracements);
});

			// In the case a full invalidation has been postponed during the draw, reapply
			// the timescale invalidations. A full invalidation would mean there is a change
			// in the timescale width (caused by price scale changes) that needs to be drawn
			// right away to avoid flickering.
			if (this._invalidateMask?.fullInvalidation() === InvalidationLevel.Full) {
				this._invalidateMask.merge(invalidateMask);

				this._updateGui();

				this._applyMomentaryAutoScale(this._invalidateMask);
				this._applyTimeScaleInvalidations(this._invalidateMask, time);

				invalidateMask = this._invalidateMask;
				this._invalidateMask = null;
			}
		}

		this.paint(invalidateMask);
	}

	private _applyTimeScaleInvalidations(invalidateMask: InvalidateMask, time: number): void {
		for (const tsInvalidation of invalidateMask.timeScaleInvalidations()) {
			this._applyTimeScaleInvalidation(tsInvalidation, time);
		}
	}

	private _applyMomentaryAutoScale(invalidateMask: InvalidateMask): void {
		const panes = this._model.panes();
		for (let i = 0; i < panes.length; i++) {
			if (invalidateMask.invalidateForPane(i).autoScale) {
				panes[i].momentaryAutoScale();
			}
		}
	}

	private _applyTimeScaleInvalidation(invalidation: TimeScaleInvalidation, time: number): void {
		const timeScale = this._model.timeScale();
		switch (invalidation.type) {
			case TimeScaleInvalidationType.FitContent:
				timeScale.fitContent();
				break;
			case TimeScaleInvalidationType.ApplyRange:
				timeScale.setLogicalRange(invalidation.value);
				break;
			case TimeScaleInvalidationType.ApplyBarSpacing:
				timeScale.setBarSpacing(invalidation.value);
				break;
			case TimeScaleInvalidationType.ApplyRightOffset:
				timeScale.setRightOffset(invalidation.value);
				break;
			case TimeScaleInvalidationType.Reset:
				timeScale.restoreDefault();
				break;
			case TimeScaleInvalidationType.Animation:
				if (!invalidation.value.finished(time)) {
					timeScale.setRightOffset(invalidation.value.getPosition(time));
				}
				break;
		}
	}

	private _invalidateHandler(invalidateMask: InvalidateMask): void {
		if (this._invalidateMask !== null) {
			this._invalidateMask.merge(invalidateMask);
		} else {
			this._invalidateMask = invalidateMask;
		}

		if (!this._drawPlanned) {
			this._drawPlanned = true;
			this._drawRafId = window.requestAnimationFrame((time: number) => {
				this._drawPlanned = false;
				this._drawRafId = 0;

				if (this._invalidateMask !== null) {
					const mask = this._invalidateMask;
					this._invalidateMask = null;
					this._drawImpl(mask, time);

					for (const tsInvalidation of mask.timeScaleInvalidations()) {
						if (tsInvalidation.type === TimeScaleInvalidationType.Animation && !tsInvalidation.value.finished(time)) {
							this.model().setTimeScaleAnimation(tsInvalidation.value);
							break;
						}
					}
				}
			});
		}
	}

	private _updateGui(): void {
		this._syncGuiWithModel();
	}

	private _destroySeparator(separator: PaneSeparator): void {
		this._tableElement.removeChild(separator.getElement());
		separator.destroy();
	}

	private _syncGuiWithModel(): void {
		const panes = this._model.panes();
		const targetPaneWidgetsCount = panes.length;
		const actualPaneWidgetsCount = this._paneWidgets.length;

		// Remove (if needed) pane widgets and separators
		for (let i = targetPaneWidgetsCount; i < actualPaneWidgetsCount; i++) {
			const paneWidget = ensureDefined(this._paneWidgets.pop());
			this._tableElement.removeChild(paneWidget.getElement());
			paneWidget.clicked().unsubscribeAll(this);
			paneWidget.dblClicked().unsubscribeAll(this);
			paneWidget.destroy();

			const paneSeparator = this._paneSeparators.pop();
			if (paneSeparator !== undefined) {
				this._destroySeparator(paneSeparator);
			}
		}

		// Create (if needed) new pane widgets and separators
		for (let i = actualPaneWidgetsCount; i < targetPaneWidgetsCount; i++) {
			const paneWidget = new PaneWidget(this, panes[i]);
			paneWidget.clicked().subscribe(this._onPaneWidgetClicked.bind(this, paneWidget), this);
			paneWidget.dblClicked().subscribe(this._onPaneWidgetDblClicked.bind(this, paneWidget), this);

			this._paneWidgets.push(paneWidget);

			// create and insert separator
			if (i > 0) {
				const paneSeparator = new PaneSeparator(this, i - 1, i);
				this._paneSeparators.push(paneSeparator);
				this._tableElement.insertBefore(paneSeparator.getElement(), this._timeAxisWidget.getElement());
			}

			// insert paneWidget
			this._tableElement.insertBefore(paneWidget.getElement(), this._timeAxisWidget.getElement());
		}

		for (let i = 0; i < targetPaneWidgetsCount; i++) {
			const state = panes[i];
			const paneWidget = this._paneWidgets[i];
			if (paneWidget.state() !== state) {
				paneWidget.setState(state);
			} else {
				paneWidget.updatePriceAxisWidgetsStates();
			}
		}

		this._updateTimeAxisVisibility();
		this._adjustSizeImpl();
	}

	private _getMouseEventParamsImpl(
		index: TimePointIndex | null,
		point: Point | null,
		event: TouchMouseEventData | null,
		pane?: PaneWidget
	): MouseEventParamsImpl {
		const seriesData = new Map<Series<SeriesType>, SeriesPlotRow<SeriesType>>();
		if (index !== null) {
			const serieses = this._model.serieses();
			serieses.forEach((s: Series<SeriesType>) => {
				// TODO: replace with search left
				const data = s.bars().search(index);
				if (data !== null) {
					seriesData.set(s, data);
				}
			});
		}
		let clientTime: unknown;
		if (index !== null) {
			const timePoint = this._model.timeScale().indexToTimeScalePoint(index)?.originalTime;
			if (timePoint !== undefined) {
				clientTime = timePoint;
			}
		}

		const hoveredSource = this.model().hoveredSource();

		const hoveredSeries = hoveredSource !== null && hoveredSource.source instanceof Series
			? hoveredSource.source
			: undefined;

		const hoveredObject = hoveredSource !== null && hoveredSource.object !== undefined
			? hoveredSource.object.externalId
			: undefined;

		const paneIndex = this._getPaneIndex(pane);

		return {
			originalTime: clientTime,
			index: index ?? undefined,
			point: point ?? undefined,
			paneIndex: paneIndex !== -1 ? paneIndex : undefined,
			hoveredSeries,
			seriesData,
			hoveredObject,
			touchMouseEventData: event ?? undefined,
		};
	}

	private _getPaneIndex(pane?: PaneWidget): number {
		let paneIndex = -1;

		if (pane) {
			paneIndex = this._paneWidgets.indexOf(pane);
		} else {
			const crosshairPane = this.model().crosshairSource().pane();
			if (crosshairPane !== null) {
				paneIndex = this.model().panes().indexOf(crosshairPane);
			}
		}
		return paneIndex;
	}

	private _onPaneWidgetClicked(
    pane: PaneWidget,
    time: TimePointIndex | null,
    point: Point | null,
    event: TouchMouseEventData
): void {
    console.log('Click detected - Trendline mode:', this._isDrawingTrendline, 'Fibonacci mode:', this._isDrawingFibonacci, 'Time:', time, 'Point:', point);

// Handle trendline drawing mode
if (this._isDrawingTrendline) {
    if (point !== null) {
        // Always allow clicks when in drawing mode, even if time is null
        this._handleTrendlineClick(pane, time, point, event);
    }
    return;
}

// Handle fibonacci drawing mode
if (this._isDrawingFibonacci) {
    if (point !== null) {
        this._handleFibonacciClick(pane, time, point, event);
    }
    return;
}

// Normal click handling
this._clicked.fire(() => this._getMouseEventParamsImpl(time, point, event, pane));
}

private _handleTrendlineClick(
    pane: PaneWidget,
    time: TimePointIndex | null,
    point: Point | null,
    event: TouchMouseEventData
): void {
    if (point === null) {
        return;
    }

    const priceScale = pane.state().defaultPriceScale();
    const firstValue = priceScale.firstValue();
    if (firstValue === null) {
        return;
    }

    const price = priceScale.coordinateToPrice(point.y, firstValue);
    
    let timeValue: number;
    
    // Check if this click is beyond the rightmost data
    const timeScale = this._model.timeScale() as any;
    const baseIndex = timeScale._internal_baseIndex();
    const baseCoord = timeScale._internal_indexToCoordinate(baseIndex);
    
    if (baseCoord !== null && point.x > baseCoord) {
        // Click is beyond the rightmost data point
        timeValue = this._extrapolateTimeFromCoordinate(point.x);
    } else if (time !== null) {
        // Try to get time from the time index
        const timePoint = this._model.timeScale().indexToTimeScalePoint(time)?.originalTime;
        if (timePoint !== undefined) {
            timeValue = timePoint as number;
        } else {
            // Index exists but no time data - extrapolate
            timeValue = this._extrapolateTimeFromCoordinate(point.x);
        }
    } else {
        // No time index at all - extrapolate
        timeValue = this._extrapolateTimeFromCoordinate(point.x);
    }

    if (price === null) {
        return;
    }

    if (this._trendlineStartPoint === null) {
        // First click - store start point
        this._trendlineStartPoint = {
            x: point.x,
            y: point.y,
            time: timeValue,
            price: price
        };
        
        // Store in model
        this._model.setTrendlineStartPoint(this._trendlineStartPoint);
    } else {
        // Second click - create trendline
        const endPoint = {
            x: point.x,
            y: point.y,
            time: timeValue,
            price: price
        };
        
        this._model.addTrendline({
            id: 'trendline_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            point1: { 
                time: this._trendlineStartPoint.time, 
                value: this._trendlineStartPoint.price
            },
            point2: { 
                time: endPoint.time, 
                value: endPoint.price
            }
        });
        
        // COMPLETE CLEANUP - This is the key fix
        this._isDrawingTrendline = false;
        this._trendlineStartPoint = null;
        this._trendlinePreviewEnd = null;
        
        // Clear the model's drawing state
        this._model.setTrendlineDrawingState(false);
        this._model.setTrendlineStartPoint(null);
        this._model.setTrendlinePreviewEnd(null);
        
        // Reset cursor
        this.setCursorStyle(null);
        
        // Reset crosshair drawing mode
        const crosshair = this._model.crosshairSource();
        crosshair._showCenterDot = false;
        
        // Restore original crosshair mode
        if (this._originalCrosshairMode !== null) {
            this._model.applyOptions({
                crosshair: {
                    mode: this._originalCrosshairMode
                }
            });
            this._originalCrosshairMode = null;
        }
        
        // THIS IS THE KEY FIX: Deactivate the toolbar tool
        if (this._toolbarWidget) {
            this._toolbarWidget.deactivateTrendlineTool();
        }
        
        // Force crosshair update
        crosshair.updateAllViews();
        this._model.fullUpdate();
    }
}

public getTrendlinePreviewEnd(): { x: number; y: number; time: number; price: number } | null {
    return this._trendlinePreviewEnd;
}

public setTrendlinePreviewEnd(previewEnd: { x: number; y: number; time: number; price: number }): void {
    this._trendlinePreviewEnd = previewEnd;
}

// In src/gui/chart-widget.ts
// Add this method after the existing getTrendlinePreviewEnd method:

public isDrawingTrendline(): boolean {
    return this._isDrawingTrendline;
}

public isDrawingFibonacci(): boolean {
    return this._isDrawingFibonacci;
}

public getTrendlineStartPoint(): { x: number; y: number; time: number; price: number } | null {
    return this._trendlineStartPoint;
}

public getFibonacciStartPoint(): { x: number; y: number; time: number; price: number } | null {
    return this._fibonacciStartPoint;
}

public getFibonacciPreviewEnd(): { x: number; y: number; time: number; price: number } | null {
    return this._fibonacciPreviewEnd;
}

public setFibonacciPreviewEnd(previewEnd: { x: number; y: number; time: number; price: number }): void {
    this._fibonacciPreviewEnd = previewEnd;
}

private _handleFibonacciClick(
    pane: PaneWidget,
    time: TimePointIndex | null,
    point: Point | null,
    event: TouchMouseEventData
): void {
    if (point === null) {
        return;
    }

    const priceScale = pane.state().defaultPriceScale();
    const firstValue = priceScale.firstValue();
    if (firstValue === null) {
        return;
    }

    const price = priceScale.coordinateToPrice(point.y, firstValue);
    
    let timeValue: number;
    
    // Check if this click is beyond the rightmost data
    const timeScale = this._model.timeScale() as any;
    const baseIndex = timeScale._internal_baseIndex();
    const baseCoord = timeScale._internal_indexToCoordinate(baseIndex);
    
    console.log('Fibonacci click analysis:', {
        clickX: point.x,
        baseIndex,
        baseCoord,
        isBeyondData: point.x > (baseCoord || 0)
    });
    
    if (baseCoord !== null && point.x > baseCoord) {
        // Click is beyond the rightmost data point
        console.log('Click detected beyond data range for Fibonacci');
        timeValue = this._extrapolateTimeFromCoordinate(point.x);
    } else if (time !== null) {
        // Try to get time from the time index
        const timePoint = this._model.timeScale().indexToTimeScalePoint(time)?.originalTime;
        if (timePoint !== undefined) {
            timeValue = timePoint as number;
        } else {
            // Index exists but no time data - extrapolate
            console.log('Index exists but no time data, extrapolating for Fibonacci...');
            timeValue = this._extrapolateTimeFromCoordinate(point.x);
        }
    } else {
        // No time index at all - extrapolate
        console.log('No time index, extrapolating for Fibonacci...');
        timeValue = this._extrapolateTimeFromCoordinate(point.x);
    }

    if (price === null) {
        return;
    }

    if (this._fibonacciStartPoint === null) {
        // First click - store start point
        this._fibonacciStartPoint = {
            x: point.x,
            y: point.y,
            time: timeValue,
            price: price
        };
        console.log('Fibonacci start point set:', this._fibonacciStartPoint);
    } else {
        // Second click - create fibonacci retracement
        const endPoint = {
            x: point.x,
            y: point.y,
            time: timeValue,
            price: price
        };
        
        console.log('Creating Fibonacci retracement from', this._fibonacciStartPoint, 'to', endPoint);
        
        // Create the fibonacci retracement with only time/price data
const fibId = 'fibonacci_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
const fibData = {
    id: fibId,
    point1: { 
        time: this._fibonacciStartPoint.time, 
        value: this._fibonacciStartPoint.price
    },
    point2: { 
        time: endPoint.time, 
        value: endPoint.price
    }
};
console.log('Creating fibonacci with ID:', fibId, 'and data:', fibData);
this._model.addFibonacci(fibData);
        
        // Reset drawing mode
        this._isDrawingFibonacci = false;
this._fibonacciStartPoint = null;
this._fibonacciPreviewEnd = null;
this.setCursorStyle(null);
this._toolbarWidget?.deactivateFibonacciTool();
    }
}

private _extrapolateTimeFromCoordinate(x: number): number {
    const timeScale = this._model.timeScale() as any;
    
    // Get the base (rightmost) data point
    const baseIndex = timeScale._internal_baseIndex();
    const baseTime = timeScale._internal_indexToTimeScalePoint(baseIndex)?.originalTime;
    const baseCoord = timeScale._internal_indexToCoordinate(baseIndex);
    
    // Get the previous data point to calculate time interval
    const prevIndex = baseIndex - 1;
    const prevTime = timeScale._internal_indexToTimeScalePoint(prevIndex)?.originalTime;
    const prevCoord = timeScale._internal_indexToCoordinate(prevIndex);
    
    if (baseTime !== undefined && baseCoord !== null && 
        prevTime !== undefined && prevCoord !== null) {
        
        // Calculate time per pixel based on the last two data points
        const timeInterval = (baseTime as number) - (prevTime as number);
        const coordInterval = baseCoord - prevCoord;
        
        if (coordInterval !== 0) {
            const timePerPixel = timeInterval / coordInterval;
            const pixelsBeyondBase = x - baseCoord;
            const extrapolatedTime = (baseTime as number) + (pixelsBeyondBase * timePerPixel);
            
            return extrapolatedTime;
        }
    }
    
    // Fallback: assume daily intervals (86400 seconds)
    const fallbackTime = Date.now() / 1000 + (x * 86400 / 100);
    return fallbackTime;
}

	private _onPaneWidgetDblClicked(
		pane: PaneWidget,
		time: TimePointIndex | null,
		point: Point | null,
		event: TouchMouseEventData
	): void {
		this._dblClicked.fire(() => this._getMouseEventParamsImpl(time, point, event, pane));
	}

	private _onPaneWidgetCrosshairMoved(
		time: TimePointIndex | null,
		point: Point | null,
		event: TouchMouseEventData | null
	): void {
		this.setCursorStyle(this.model().hoveredSource()?.cursorStyle ?? null);
		this._crosshairMoved.fire(() => this._getMouseEventParamsImpl(time, point, event));
	}

	private _updateTimeAxisVisibility(): void {
		const display = this._options.timeScale.visible ? '' : 'none';
		this._timeAxisWidget.getElement().style.display = display;
	}

	private _isLeftAxisVisible(): boolean {
		return this._paneWidgets[0].state().leftPriceScale().options().visible;
	}

	private _isRightAxisVisible(): boolean {
		return this._paneWidgets[0].state().rightPriceScale().options().visible;
	}

	private _installObserver(): boolean {
		// eslint-disable-next-line no-restricted-syntax
		if (!('ResizeObserver' in window)) {
			warn('Options contains "autoSize" flag, but the browser does not support ResizeObserver feature. Please provide polyfill.');
			return false;
		} else {
			this._observer = new ResizeObserver((entries: ResizeObserverEntry[]) => {
				// There is no need to check if entry.target === this._container since there is only
				// a single element being observed.
				// and we want to use the last entry (if multiple) because it would be most up to date
				// (since the browser may batch multiple updates).
				const containerEntry = entries[entries.length - 1];
				if (!containerEntry) {
					// this may be undefined if the entries array was empty.
					return;
				}
				this.resize(containerEntry.contentRect.width, containerEntry.contentRect.height);
			});
			this._observer.observe(this._container, { box: 'border-box' });
			return true;
		}
	}

	private _uninstallObserver(): void {
		if (this._observer !== null) {
			this._observer.disconnect();
		}
		this._observer = null;
	}
}

function disableSelection(element: HTMLElement): void {
	element.style.userSelect = 'none';
	// eslint-disable-next-line deprecation/deprecation
	element.style.webkitUserSelect = 'none';
	// eslint-disable-next-line @typescript-eslint/no-explicit-any,@typescript-eslint/no-unsafe-member-access
	(element.style as any).msUserSelect = 'none';
	// eslint-disable-next-line @typescript-eslint/no-explicit-any,@typescript-eslint/no-unsafe-member-access
	(element.style as any).MozUserSelect = 'none';

	// eslint-disable-next-line @typescript-eslint/no-explicit-any,@typescript-eslint/no-unsafe-member-access
	(element.style as any).webkitTapHighlightColor = 'transparent';
}

function shouldSubscribeMouseWheel<HorzScaleItem>(options: ChartOptionsInternal<HorzScaleItem>): boolean {
	return Boolean(options['handleScroll'].mouseWheel || options['handleScale'].mouseWheel);
}