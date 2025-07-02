import {
	BitmapCoordinatesRenderingScope,
	CanvasElementBitmapSizeBinding,
	CanvasRenderingTarget2D,
	equalSizes,
	Size,
	size,
	tryCreateCanvasRenderingTarget2D,
} from 'fancy-canvas';
import { Trendline } from '../model/trendline';
import { FibonacciRetracement } from '../model/fibonacci-retracement';

import { ensureNotNull } from '../helpers/assertions';
import { clearRect, clearRectWithGradient } from '../helpers/canvas-helpers';
import { Delegate } from '../helpers/delegate';
import { IDestroyable } from '../helpers/idestroyable';
import { ISubscription } from '../helpers/isubscription';

import { IChartModelBase, TrackingModeExitMode } from '../model/chart-model';
import { Coordinate } from '../model/coordinate';
import { IDataSourcePaneViews } from '../model/idata-source';
import { InvalidationLevel } from '../model/invalidate-mask';
import { KineticAnimation } from '../model/kinetic-animation';
import { Pane } from '../model/pane';
import { hitTestPane, HitTestResult } from '../model/pane-hit-test';
import { Point } from '../model/point';
import { TimePointIndex } from '../model/time-data';
import { TouchMouseEventData } from '../model/touch-mouse-event-data';
import { IPaneRenderer } from '../renderers/ipane-renderer';
import { IPaneView } from '../views/pane/ipane-view';

import { AttributionLogoWidget } from './attribution-logo-widget';
import { createBoundCanvas, releaseCanvas } from './canvas-utils';
import { IChartWidgetBase } from './chart-widget';
import { drawBackground, drawForeground, DrawFunction, drawSourceViews, ViewsGetter } from './draw-functions';
import { MouseEventHandler, MouseEventHandlerEventBase, MouseEventHandlerMouseEvent, MouseEventHandlers, MouseEventHandlerTouchEvent, Position, TouchMouseEvent } from './mouse-event-handler';
import { PriceAxisWidget, PriceAxisWidgetSide } from './price-axis-widget';

const SELECTION_DOT_RADIUS = 6;
const SELECTION_HIT_TOLERANCE = 8;
const LINE_HIT_TOLERANCE = 5;

interface TrendlineHitResult {
    trendlineId: string;
    hitType: 'line' | 'point1' | 'point2';
    distance: number;
}

interface TrendlineSelectionState {
    selectedTrendlineId: string | null;
    dragState: {
        isDragging: boolean;
        dragType: 'point' | 'line'; // New: track if dragging a point or the whole line
        dragPointIndex: number; // 0 for point1, 1 for point2 (only used when dragType is 'point')
        startMousePos: Point;
        originalPoint: { time: number; value: number }; // Only used for point dragging
        originalLine?: { // New: store both points for line dragging
            point1: { time: number; value: number };
            point2: { time: number; value: number };
        };
    } | null;
}

const enum KineticScrollConstants {
	MinScrollSpeed = 0.2,
	MaxScrollSpeed = 7,
	DumpingCoeff = 0.997,
	ScrollMinMove = 15,
}

function sourceBottomPaneViews(source: IDataSourcePaneViews, pane: Pane): readonly IPaneView[] {
	return source.bottomPaneViews?.(pane) ?? [];
}
function sourcePaneViews(source: IDataSourcePaneViews, pane: Pane): readonly IPaneView[] {
	return source.paneViews?.(pane) ?? [];
}
function sourceLabelPaneViews(source: IDataSourcePaneViews, pane: Pane): readonly IPaneView[] {
	return source.labelPaneViews?.(pane) ?? [];
}
function sourceTopPaneViews(source: IDataSourcePaneViews, pane: Pane): readonly IPaneView[] {
	return source.topPaneViews?.(pane) ?? [];
}

interface StartScrollPosition extends Point {
	timestamp: number;
	localX: Coordinate;
	localY: Coordinate;
}

interface FibonacciSelectionState {
    selectedFibonacciId: string | null;
    dragState: {
        isDragging: boolean;
        dragCorner: 'topRight' | 'bottomLeft'; // Only allow corner dragging
        startMousePos: Point;
        originalPoints: {
            point1: { time: number; value: number };
            point2: { time: number; value: number };
        };
    } | null;
}

export class PaneWidget implements IDestroyable, MouseEventHandlers {
	private readonly _chart: IChartWidgetBase;
	private _state: Pane | null;
	private _size: Size = size({ width: 0, height: 0 });
	private _leftPriceAxisWidget: PriceAxisWidget | null = null;
	private _rightPriceAxisWidget: PriceAxisWidget | null = null;
	private _attributionLogoWidget: AttributionLogoWidget | null = null;
	private readonly _paneCell: HTMLElement;
	private readonly _leftAxisCell: HTMLElement;
	private readonly _rightAxisCell: HTMLElement;
	private readonly _canvasBinding: CanvasElementBitmapSizeBinding;
	private readonly _topCanvasBinding: CanvasElementBitmapSizeBinding;
	private readonly _rowElement: HTMLElement;
	private readonly _mouseEventHandler: MouseEventHandler;
	private _startScrollingPos: StartScrollPosition | null = null;
	private _isScrolling: boolean = false;
	private _clicked: Delegate<TimePointIndex | null, Point, TouchMouseEventData> = new Delegate();
	private _dblClicked: Delegate<TimePointIndex | null, Point, TouchMouseEventData> = new Delegate();
	private _prevPinchScale: number = 0;
	private _longTap: boolean = false;
	private _startTrackPoint: Point | null = null;
	private _exitTrackingModeOnNextTry: boolean = false;
	private _initCrosshairPosition: Point | null = null;

	private _scrollXAnimation: KineticAnimation | null = null;

	private _isSettingSize: boolean = false;
	private _trendlines: Map<string, Trendline> = new Map();
	private _fibonacciRetracements: Map<string, FibonacciRetracement> = new Map();

	private _trendlineSelection: TrendlineSelectionState = {
    	selectedTrendlineId: null,
    	dragState: null
	};

    private _fibonacciSelection: FibonacciSelectionState = {
        selectedFibonacciId: null,
        dragState: null
    };
    

public constructor(chart: IChartWidgetBase, state: Pane) {
    this._chart = chart;

		this._state = state;
		this._state.onDestroyed().subscribe(this._onStateDestroyed.bind(this), this, true);

		this._paneCell = document.createElement('td');
		this._paneCell.style.padding = '0';
		this._paneCell.style.position = 'relative';

		const paneWrapper = document.createElement('div');
		paneWrapper.style.width = '100%';
		paneWrapper.style.height = '100%';
		paneWrapper.style.position = 'relative';
		paneWrapper.style.overflow = 'hidden';

		this._leftAxisCell = document.createElement('td');
		this._leftAxisCell.style.padding = '0';

		this._rightAxisCell = document.createElement('td');
		this._rightAxisCell.style.padding = '0';

		this._paneCell.appendChild(paneWrapper);

		this._canvasBinding = createBoundCanvas(paneWrapper, size({ width: 16, height: 16 }));
		this._canvasBinding.subscribeSuggestedBitmapSizeChanged(this._canvasSuggestedBitmapSizeChangedHandler);
		const canvas = this._canvasBinding.canvasElement;
		canvas.style.position = 'absolute';
		canvas.style.zIndex = '1';
		canvas.style.left = '0';
		canvas.style.top = '0';

		this._topCanvasBinding = createBoundCanvas(paneWrapper, size({ width: 16, height: 16 }));
		this._topCanvasBinding.subscribeSuggestedBitmapSizeChanged(this._topCanvasSuggestedBitmapSizeChangedHandler);
		const topCanvas = this._topCanvasBinding.canvasElement;
		topCanvas.style.position = 'absolute';
		topCanvas.style.zIndex = '2';
		topCanvas.style.left = '0';
		topCanvas.style.top = '0';

		this._rowElement = document.createElement('tr');
		this._rowElement.appendChild(this._leftAxisCell);
		this._rowElement.appendChild(this._paneCell);
		this._rowElement.appendChild(this._rightAxisCell);
		this.updatePriceAxisWidgetsStates();

		this._mouseEventHandler = new MouseEventHandler(
			this._topCanvasBinding.canvasElement,
			this,
			{
				treatVertTouchDragAsPageScroll: () => this._startTrackPoint === null && !this._chart.options()['handleScroll'].vertTouchDrag,
				treatHorzTouchDragAsPageScroll: () => this._startTrackPoint === null && !this._chart.options()['handleScroll'].horzTouchDrag,
			}
		);
	}

	public destroy(): void {
		if (this._leftPriceAxisWidget !== null) {
			this._leftPriceAxisWidget.destroy();
		}
		if (this._rightPriceAxisWidget !== null) {
			this._rightPriceAxisWidget.destroy();
		}
		this._attributionLogoWidget = null;

		this._topCanvasBinding.unsubscribeSuggestedBitmapSizeChanged(this._topCanvasSuggestedBitmapSizeChangedHandler);
		releaseCanvas(this._topCanvasBinding.canvasElement);
		this._topCanvasBinding.dispose();

		this._canvasBinding.unsubscribeSuggestedBitmapSizeChanged(this._canvasSuggestedBitmapSizeChangedHandler);
		releaseCanvas(this._canvasBinding.canvasElement);
		this._canvasBinding.dispose();

		if (this._state !== null) {
			this._state.onDestroyed().unsubscribeAll(this);
			this._state.destroy();
		}

		this._mouseEventHandler.destroy();
	}

	public state(): Pane {
		return ensureNotNull(this._state);
	}

	public setState(pane: Pane | null): void {
		if (this._state !== null) {
			this._state.onDestroyed().unsubscribeAll(this);
		}

		this._state = pane;

		if (this._state !== null) {
			this._state.onDestroyed().subscribe(PaneWidget.prototype._onStateDestroyed.bind(this), this, true);
		}

		this.updatePriceAxisWidgetsStates();

		if (this._chart.paneWidgets().indexOf(this) === this._chart.paneWidgets().length - 1) {
			this._attributionLogoWidget = this._attributionLogoWidget ?? new AttributionLogoWidget(this._paneCell, this._chart);
			this._attributionLogoWidget.update();
		} else {
			this._attributionLogoWidget?.removeElement();
			this._attributionLogoWidget = null;
		}
	}

	public chart(): IChartWidgetBase {
		return this._chart;
	}

	public getElement(): HTMLElement {
		return this._rowElement;
	}

	public updatePriceAxisWidgetsStates(): void {
		if (this._state === null) {
			return;
		}

		this._recreatePriceAxisWidgets();
		if (this._model().serieses().length === 0) {
			return;
		}

		if (this._leftPriceAxisWidget !== null) {
			const leftPriceScale = this._state.leftPriceScale();
			this._leftPriceAxisWidget.setPriceScale(ensureNotNull(leftPriceScale));
		}
		if (this._rightPriceAxisWidget !== null) {
			const rightPriceScale = this._state.rightPriceScale();
			this._rightPriceAxisWidget.setPriceScale(ensureNotNull(rightPriceScale));
		}
	}

	public updatePriceAxisWidgets(): void {
		if (this._leftPriceAxisWidget !== null) {
			this._leftPriceAxisWidget.update();
		}
		if (this._rightPriceAxisWidget !== null) {
			this._rightPriceAxisWidget.update();
		}
	}

	public updateTrendlines(trendlines: Map<string, Trendline>): void {
    // Store trendlines for rendering
    this._trendlines = trendlines;
}

public selectTrendline(trendlineId: string | null): void {
    this._trendlineSelection.selectedTrendlineId = trendlineId;
    this._model().lightUpdate(); // Trigger redraw
}

public getSelectedTrendline(): string | null {
    return this._trendlineSelection.selectedTrendlineId;
}

public clearTrendlineSelection(): void {
    this._trendlineSelection.selectedTrendlineId = null;
    this._trendlineSelection.dragState = null;
    this._model().lightUpdate();
}

public selectFibonacci(fibonacciId: string | null): void {
    this._fibonacciSelection.selectedFibonacciId = fibonacciId;
    this._model().lightUpdate(); // Trigger redraw
}

public getSelectedFibonacci(): string | null {
    return this._fibonacciSelection.selectedFibonacciId;
}

public clearFibonacciSelection(): void {
    this._fibonacciSelection.selectedFibonacciId = null;
    this._fibonacciSelection.dragState = null;
    this._model().lightUpdate();
}

// Coordinate conversion helper
private _convertTimeAndPriceToCoordinates(
    targetTime: number, 
    targetPrice: number, 
    timeScale: any, 
    priceScale: any, 
    firstValue: any
): { x: number; y: number } | null {
    
    // Check if this time is beyond our data range by comparing to base time
    const baseIndex = timeScale._internal_baseIndex();
    const baseTime = timeScale._internal_indexToTimeScalePoint(baseIndex)?.originalTime;
    
    if (baseTime !== undefined && targetTime > (baseTime as number)) {
        // This is definitely an extrapolated time - force manual calculation
        return this._forceExtrapolateCoordinate(targetTime, targetPrice, timeScale, priceScale, firstValue);
    }
    
    // Try normal coordinate conversion for times within data range
    const index = timeScale._internal_timeToIndex(targetTime, true);
    
    if (index !== null) {
        // Normal case: time exists in data
        const x = timeScale._internal_indexToCoordinate(index);
        const y = priceScale._internal_priceToCoordinate(targetPrice, firstValue);
        
        if (x !== null && y !== null) {
            return { x, y };
        }
    }
    
    // Fallback to extrapolation
    return this._forceExtrapolateCoordinate(targetTime, targetPrice, timeScale, priceScale, firstValue);
}

private _hitTestFibonacci(x: number, y: number): { fibonacciId: string; hitType: 'topRight' | 'bottomLeft'; distance: number } | null {
    if (this._state === null || this._fibonacciRetracements.size === 0) {
        return null;
    }

    const timeScale = this._model().timeScale() as any;
    const priceScale = this._state.defaultPriceScale() as any;
    const firstValue = priceScale._internal_firstValue();
    
    if (firstValue === null) {
        return null;
    }

    let closestHit: { fibonacciId: string; hitType: 'topRight' | 'bottomLeft'; distance: number } | null = null;
    let closestDistance = Infinity;

    console.log('Fibonacci retracements map:', this._fibonacciRetracements);
console.log('Fibonacci retracements size:', this._fibonacciRetracements.size);
this._fibonacciRetracements.forEach((fibonacci, id) => {
    console.log('Checking fibonacci with ID:', id, 'fibonacci data:', fibonacci);
        const data = fibonacci.data() as any;
        
        // Access the internal properties correctly
        const point1Time = data._internal_point1._internal_time;
        const point1Value = data._internal_point1._internal_value;
        const point2Time = data._internal_point2._internal_time;
        const point2Value = data._internal_point2._internal_value;
        
        // Convert both points to coordinates
        const coords1 = this._timeAndPriceToCoordinates(point1Time, point1Value, timeScale, priceScale, firstValue);
const coords2 = this._timeAndPriceToCoordinates(point2Time, point2Value, timeScale, priceScale, firstValue);
        
        if (coords1 === null || coords2 === null) {
            return;
        }
        
        // Determine which corner is top-right and which is bottom-left
        const leftX = Math.min(coords1.x, coords2.x);
        const rightX = Math.max(coords1.x, coords2.x);
        const topY = Math.min(coords1.y, coords2.y);
        const bottomY = Math.max(coords1.y, coords2.y);
        
        // Test hit on top-right corner
        const topRightDist = Math.sqrt(Math.pow(x - rightX, 2) + Math.pow(y - topY, 2));
        if (topRightDist <= SELECTION_HIT_TOLERANCE && topRightDist < closestDistance) {
    console.log('Top right hit detected for fibonacci ID:', id);
    closestHit = { fibonacciId: id, hitType: 'topRight', distance: topRightDist };
    closestDistance = topRightDist;
}
        
        // Test hit on bottom-left corner
        const bottomLeftDist = Math.sqrt(Math.pow(x - leftX, 2) + Math.pow(y - bottomY, 2));
if (bottomLeftDist <= SELECTION_HIT_TOLERANCE && bottomLeftDist < closestDistance) {
    console.log('Bottom left hit detected for fibonacci ID:', id);
    closestHit = { fibonacciId: id, hitType: 'bottomLeft', distance: bottomLeftDist };
    closestDistance = bottomLeftDist;
}
    });

    return closestHit;
}

// Hit testing for trendlines
private _hitTestTrendlines(x: number, y: number): TrendlineHitResult | null {
    if (this._state === null || this._trendlines.size === 0) {
        return null;
    }

    const timeScale = this._model().timeScale() as any;
    const priceScale = this._state.defaultPriceScale() as any;
    const firstValue = priceScale._internal_firstValue();
    
    if (firstValue === null) {
        return null;
    }

    let closestHit: TrendlineHitResult | null = null;
    let closestDistance = Infinity;

    this._trendlines.forEach((trendline, id) => {
        const data = trendline.data();
        
        // Convert both points to coordinates
        const coords1 = this._convertTimeAndPriceToCoordinates(data.point1.time as number, data.point1.value, timeScale, priceScale, firstValue);
        const coords2 = this._convertTimeAndPriceToCoordinates(data.point2.time as number, data.point2.value, timeScale, priceScale, firstValue);
        
        if (coords1 === null || coords2 === null) {
            return;
        }
        
        // Test hit on endpoints first (they have priority)
        const dist1 = Math.sqrt(Math.pow(x - coords1.x, 2) + Math.pow(y - coords1.y, 2));
        if (dist1 <= SELECTION_HIT_TOLERANCE && dist1 < closestDistance) {
            closestHit = { trendlineId: id, hitType: 'point1', distance: dist1 };
            closestDistance = dist1;
        }
        
        const dist2 = Math.sqrt(Math.pow(x - coords2.x, 2) + Math.pow(y - coords2.y, 2));
        if (dist2 <= SELECTION_HIT_TOLERANCE && dist2 < closestDistance) {
            closestHit = { trendlineId: id, hitType: 'point2', distance: dist2 };
            closestDistance = dist2;
        }
        
        // Test hit on line if no point hit
        if (closestHit === null || closestHit.hitType === 'line') {
            const lineDist = this._distanceToLine(x, y, coords1.x, coords1.y, coords2.x, coords2.y);
            if (lineDist <= LINE_HIT_TOLERANCE && lineDist < closestDistance) {
                closestHit = { trendlineId: id, hitType: 'line', distance: lineDist };
                closestDistance = lineDist;
            }
        }
    });

    return closestHit;
}

// Distance from point to line segment
private _distanceToLine(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    
    if (dx === 0 && dy === 0) {
        // Line is actually a point
        return Math.sqrt(Math.pow(px - x1, 2) + Math.pow(py - y1, 2));
    }
    
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
    const projection = { x: x1 + t * dx, y: y1 + t * dy };
    
    return Math.sqrt(Math.pow(px - projection.x, 2) + Math.pow(py - projection.y, 2));
}

private _handleFibonacciMouseDown(hit: { fibonacciId: string; hitType: 'topRight' | 'bottomLeft'; distance: number }, event: MouseEventHandlerMouseEvent): void {
    // Select the fibonacci
    console.log('Selecting fibonacci with ID:', hit.fibonacciId);
this.selectFibonacci(hit.fibonacciId);
console.log('After selection, selectedId is:', this._fibonacciSelection.selectedFibonacciId)
    
    const fibonacci = this._fibonacciRetracements.get(hit.fibonacciId);
    if (fibonacci) {
        const data = fibonacci.data() as any;
        
        // Store original points for dragging
        this._fibonacciSelection.dragState = {
            isDragging: true,
            dragCorner: hit.hitType,
            startMousePos: { x: event.localX, y: event.localY },
            originalPoints: {
                point1: {
                    time: data._internal_point1._internal_time,
                    value: data._internal_point1._internal_value
                },
                point2: {
                    time: data._internal_point2._internal_time,
                    value: data._internal_point2._internal_value
                }
            }
        };
        
        // Change cursor
        this._topCanvasBinding.canvasElement.style.cursor = 'grabbing';
    }
    
    // Prevent normal mouse down behavior
    event.preventDefault?.();
}

// Handle trendline mouse down
private _handleTrendlineMouseDown(hit: TrendlineHitResult, event: MouseEventHandlerMouseEvent): void {
    // Select the trendline
    this.selectTrendline(hit.trendlineId);
    
    const trendline = this._trendlines.get(hit.trendlineId);
    if (trendline) {
        const data = trendline.data() as any;
        
        if (hit.hitType === 'point1' || hit.hitType === 'point2') {
            // Dragging a specific point
            const pointIndex = hit.hitType === 'point1' ? 0 : 1;
            const originalPoint = pointIndex === 0 ? data._internal_point1 : data._internal_point2;
            
            this._trendlineSelection.dragState = {
                isDragging: true,
                dragType: 'point',
                dragPointIndex: pointIndex,
                startMousePos: { x: event.localX, y: event.localY },
                originalPoint: { 
                    time: originalPoint._internal_time, 
                    value: originalPoint._internal_value 
                }
            };
        } else if (hit.hitType === 'line') {
            // Dragging the whole line
            this._trendlineSelection.dragState = {
                isDragging: true,
                dragType: 'line',
                dragPointIndex: -1, // Not applicable for line dragging
                startMousePos: { x: event.localX, y: event.localY },
                originalPoint: { time: 0, value: 0 }, // Not used for line dragging
                originalLine: {
                    point1: {
                        time: data._internal_point1._internal_time,
                        value: data._internal_point1._internal_value
                    },
                    point2: {
                        time: data._internal_point2._internal_time,
                        value: data._internal_point2._internal_value
                    }
                }
            };
        }
        
        // Change cursor
        this._topCanvasBinding.canvasElement.style.cursor = 'grabbing';
    }
    
    // Prevent normal mouse down behavior
    event.preventDefault?.();
}

// Handle fibonacci dragging
private _handleFibonacciDrag(event: MouseEventHandlerMouseEvent): void {
    const dragState = this._fibonacciSelection.dragState;
    const selectedId = this._fibonacciSelection.selectedFibonacciId;
    
    if (!dragState || !selectedId) {
        return;
    }
    
    const fibonacci = this._fibonacciRetracements.get(selectedId);
    if (!fibonacci) {
        return;
    }
    
    const timeScale = this._model().timeScale() as any;
    const priceScale = this._state?.defaultPriceScale();
    const firstValue = priceScale?.firstValue();
    if (!priceScale || firstValue === null || firstValue === undefined) {
        return;
    }

    const currentPrice = (priceScale as any)._internal_coordinateToPrice(event.localY as Coordinate, firstValue);
    if (currentPrice === null) {
        return;
    }
    
    const currentX = event.localX;
    let currentTime: number;
    
    // Calculate current time using same logic as trendlines
    const index = timeScale._internal_coordinateToIndex(currentX);
    if (index !== null) {
        const timePoint = timeScale._internal_indexToTimeScalePoint(index);
        if (timePoint?.originalTime !== undefined) {
            currentTime = timePoint.originalTime as number;
        } else {
            currentTime = this._extrapolateTimeFromCoordinate(currentX, timeScale);
        }
    } else {
        currentTime = this._extrapolateTimeFromCoordinate(currentX, timeScale);
    }
    
    console.log('Dragging fibonacci corner to new position:', { x: currentX, time: currentTime, price: currentPrice });
    
    try {
        const data = fibonacci.data() as any;
        
        if (dragState.dragCorner === 'topRight') {
            // Update point2 (assuming it's the top-right)
            if (data._internal_point2) {
                data._internal_point2._internal_time = currentTime;
                data._internal_point2._internal_value = currentPrice;
            }
            if (data.point2) {
                data.point2.time = currentTime;
                data.point2.value = currentPrice;
            }
        } else {
            // Update point1 (bottom-left)
            if (data._internal_point1) {
                data._internal_point1._internal_time = currentTime;
                data._internal_point1._internal_value = currentPrice;
            }
            if (data.point1) {
                data.point1.time = currentTime;
                data.point1.value = currentPrice;
            }
        }
        
        this._model().lightUpdate();
        
    } catch (error) {
        console.error('Error updating fibonacci corner:', error);
    }
}

// Handle trendline dragging
private _handleTrendlineDrag(event: MouseEventHandlerMouseEvent): void {
    const dragState = this._trendlineSelection.dragState;
    const selectedId = this._trendlineSelection.selectedTrendlineId;
    
    if (!dragState || !selectedId) {
        return;
    }
    
    const trendline = this._trendlines.get(selectedId);
    if (!trendline) {
        return;
    }
    
    if (dragState.dragType === 'point') {
        // Point dragging logic
        const timeScale = this._model().timeScale() as any;
        const priceScale = this._state?.defaultPriceScale();
        const firstValue = priceScale?.firstValue();
        if (!priceScale || firstValue === null || firstValue === undefined) {
            return;
        }

        const currentPrice = (priceScale as any)._internal_coordinateToPrice(event.localY as Coordinate, firstValue);
        if (currentPrice === null) {
            return;
        }
        
        const currentX = event.localX;
        let currentTime: number;
        
        // Simple time conversion - try direct coordinate to index conversion first
        const index = timeScale._internal_coordinateToIndex(currentX);
        if (index !== null) {
            const timePoint = timeScale._internal_indexToTimeScalePoint(index);
            if (timePoint?.originalTime !== undefined) {
                currentTime = timePoint.originalTime as number;
            } else {
                currentTime = this._extrapolateTimeFromCoordinate(currentX, timeScale);
            }
        } else {
            currentTime = this._extrapolateTimeFromCoordinate(currentX, timeScale);
        }
        
        console.log('Dragging point to new position:', { x: currentX, time: currentTime, price: currentPrice });
        
        try {
            const data = trendline.data() as any;
            
            if (dragState.dragPointIndex === 0) {
                if (data._internal_point1) {
                    data._internal_point1._internal_time = currentTime;
                    data._internal_point1._internal_value = currentPrice;
                }
            } else {
                if (data._internal_point2) {
                    data._internal_point2._internal_time = currentTime;
                    data._internal_point2._internal_value = currentPrice;
                }
                if (data.point2) {
                    data.point2.time = currentTime;
                    data.point2.value = currentPrice;
                }
            }
            
            this._model().lightUpdate();
            
        } catch (error) {
            console.error('Error updating trendline point:', error);
        }
        
    } else if (dragState.dragType === 'line') {
        // Line dragging logic
        if (!dragState.originalLine) {
            return;
        }
        
        // Calculate time and price offsets
        const timeScale = this._model().timeScale() as any;
        const priceScale = this._state?.defaultPriceScale();
        const firstValue = priceScale?.firstValue();
        if (!priceScale || firstValue === null || firstValue === undefined) {
            return;
        }
        
        // Calculate time offset using the same extrapolation logic
        const originalMouseTime = this._extrapolateTimeFromCoordinate(dragState.startMousePos.x, timeScale);
        const newMouseTime = this._extrapolateTimeFromCoordinate(event.localX, timeScale);
        const deltaTime = newMouseTime - originalMouseTime;
        
        // Calculate price offset
        const originalMousePrice = (priceScale as any)._internal_coordinateToPrice(dragState.startMousePos.y as Coordinate, firstValue);
        const newMousePrice = (priceScale as any)._internal_coordinateToPrice(event.localY as Coordinate, firstValue);
        const deltaPrice = newMousePrice - originalMousePrice;
        
        console.log('Dragging line with offsets:', { deltaTime, deltaPrice });
        
        try {
            const data = trendline.data() as any;
            
            // Move both points by the same offset
            if (data._internal_point1) {
                data._internal_point1._internal_time = dragState.originalLine.point1.time + deltaTime;
                data._internal_point1._internal_value = dragState.originalLine.point1.value + deltaPrice;
            }
            
            if (data._internal_point2) {
                data._internal_point2._internal_time = dragState.originalLine.point2.time + deltaTime;
                data._internal_point2._internal_value = dragState.originalLine.point2.value + deltaPrice;
            }
            
            if (data.point2) {
                data.point2.time = dragState.originalLine.point2.time + deltaTime;
                data.point2.value = dragState.originalLine.point2.value + deltaPrice;
            }
            
            this._model().lightUpdate();
            
        } catch (error) {
            console.error('Error updating trendline position:', error);
        }
    }
}

private _extrapolateTimeFromCoordinate(x: number, timeScale: any): number {
    try {
        const baseIndex = timeScale._internal_baseIndex();
        const baseCoord = timeScale._internal_indexToCoordinate(baseIndex);
        const baseTime = timeScale._internal_indexToTimeScalePoint(baseIndex)?.originalTime;
        
        const prevIndex = baseIndex - 1;
        const prevCoord = timeScale._internal_indexToCoordinate(prevIndex);
        const prevTime = timeScale._internal_indexToTimeScalePoint(prevIndex)?.originalTime;
        
        if (baseTime !== undefined && prevTime !== undefined && 
            baseCoord !== null && prevCoord !== null) {
            
            const timeInterval = (baseTime as number) - (prevTime as number);
            const coordInterval = baseCoord - prevCoord;
            
            if (coordInterval !== 0) {
                const timePerPixel = timeInterval / coordInterval;
                const pixelDiff = x - baseCoord;
                return (baseTime as number) + (pixelDiff * timePerPixel);
            }
        }
        
        // Fallback
        return Date.now() / 1000;
    } catch (error) {
        console.error('Error extrapolating time:', error);
        return Date.now() / 1000;
    }
}

private _updateCursorForFibonacciHover(x: number, y: number): void {
    const hit = this._hitTestFibonacci(x, y);
    const canvas = this._topCanvasBinding.canvasElement;
    
    if (hit) {
        canvas.style.cursor = 'grab';
    } else if (canvas.style.cursor === 'grab') {
        canvas.style.cursor = 'default';
    }
}

// Update cursor based on hover
private _updateCursorForTrendlineHover(x: number, y: number): void {
    const hit = this._hitTestTrendlines(x, y);
    const canvas = this._topCanvasBinding.canvasElement;
    
    if (hit) {
        if (hit.hitType === 'point1' || hit.hitType === 'point2') {
            canvas.style.cursor = 'grab';
        } else {
            canvas.style.cursor = 'pointer';
        }
    } else {
        canvas.style.cursor = 'default';
    }
}

// Draw fibonacci selection indicators
private _drawFibonacciSelectionIndicators(target: CanvasRenderingTarget2D): void {
    console.log('Drawing fibonacci selection indicators, selectedId:', this._fibonacciSelection.selectedFibonacciId);
if (!this._fibonacciSelection.selectedFibonacciId || this._state === null) {
    console.log('No selected fibonacci or no state, returning');
    return;
}

    const selectedFibonacci = this._fibonacciRetracements.get(this._fibonacciSelection.selectedFibonacciId);
    if (!selectedFibonacci) {
        return;
    }

    const timeScale = this._model().timeScale() as any;
    const priceScale = this._state.defaultPriceScale() as any;
    const firstValue = priceScale._internal_firstValue();
    
    if (firstValue === null) {
        return;
    }

    const data = selectedFibonacci.data() as any;
    
    // Access the internal properties correctly
    const point1Time = data._internal_point1._internal_time;
    const point1Value = data._internal_point1._internal_value;
    const point2Time = data._internal_point2._internal_time;
    const point2Value = data._internal_point2._internal_value;
    
    // Convert both points to coordinates
    const coords1 = this._timeAndPriceToCoordinates(point1Time, point1Value, timeScale, priceScale, firstValue);
const coords2 = this._timeAndPriceToCoordinates(point2Time, point2Value, timeScale, priceScale, firstValue);
    
    if (coords1 === null || coords2 === null) {
        return;
    }

    target.useBitmapCoordinateSpace((scope) => {
        const ctx = scope.context;
        
        try {
            // Determine corners
            const leftX = Math.min(coords1.x, coords2.x);
            const rightX = Math.max(coords1.x, coords2.x);
            const topY = Math.min(coords1.y, coords2.y);
            const bottomY = Math.max(coords1.y, coords2.y);
            
            const topRightX = rightX * scope.horizontalPixelRatio;
            const topRightY = topY * scope.verticalPixelRatio;
            const bottomLeftX = leftX * scope.horizontalPixelRatio;
            const bottomLeftY = bottomY * scope.verticalPixelRatio;
            
            ctx.save();
            
            // Draw selection dots at editable corners only
            const dotRadius = SELECTION_DOT_RADIUS * scope.horizontalPixelRatio;
            
            // Top-right corner dot
            ctx.fillStyle = '#2196F3';
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 2 * scope.horizontalPixelRatio;
            ctx.beginPath();
            ctx.arc(topRightX, topRightY, dotRadius, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
            
            // Bottom-left corner dot
            ctx.beginPath();
            ctx.arc(bottomLeftX, bottomLeftY, dotRadius, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
            
            ctx.restore();
            
        } catch (error) {
            console.error('Error drawing fibonacci selection indicators:', error);
        }
    });
}

// Draw selection indicators
private _drawTrendlineSelectionIndicators(target: CanvasRenderingTarget2D): void {
    if (!this._trendlineSelection.selectedTrendlineId || this._state === null) {
        return;
    }

    const selectedTrendline = this._trendlines.get(this._trendlineSelection.selectedTrendlineId);
    if (!selectedTrendline) {
        return;
    }

    const timeScale = this._model().timeScale() as any;
    const priceScale = this._state.defaultPriceScale() as any;
    const firstValue = priceScale._internal_firstValue();
    
    if (firstValue === null) {
        return;
    }

    const data = selectedTrendline.data();
    
    // Convert both points to coordinates
    const coords1 = this._convertTimeAndPriceToCoordinates(data.point1.time as number, data.point1.value, timeScale, priceScale, firstValue);
    const coords2 = this._convertTimeAndPriceToCoordinates(data.point2.time as number, data.point2.value, timeScale, priceScale, firstValue);
    
    if (coords1 === null || coords2 === null) {
        return;
    }

    target.useBitmapCoordinateSpace((scope) => {
        const ctx = scope.context;
        
        try {
            const x1 = coords1.x * scope.horizontalPixelRatio;
            const y1 = coords1.y * scope.verticalPixelRatio;
            const x2 = coords2.x * scope.horizontalPixelRatio;
            const y2 = coords2.y * scope.verticalPixelRatio;
            
            ctx.save();
            
            // Draw selection dots at both endpoints
            const dotRadius = SELECTION_DOT_RADIUS * scope.horizontalPixelRatio;
            
            // Point 1 dot
            ctx.fillStyle = '#2196F3';
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 2 * scope.horizontalPixelRatio;
            ctx.beginPath();
            ctx.arc(x1, y1, dotRadius, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
            
            // Point 2 dot
            ctx.beginPath();
            ctx.arc(x2, y2, dotRadius, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
            
            // Highlight the selected trendline
            ctx.strokeStyle = '#2196F3';
            ctx.lineWidth = 3 * scope.horizontalPixelRatio;
            ctx.globalAlpha = 0.8;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            
            ctx.restore();
            
        } catch (error) {
            console.error('Error drawing trendline selection indicators:', error);
        }
    });
}

public updateFibonacciRetracements(fibonacciRetracements: Map<string, FibonacciRetracement>): void {
    console.log('PaneWidget: updateFibonacciRetracements called with map size:', fibonacciRetracements.size);
    console.log('PaneWidget: Received fibonacci map:', fibonacciRetracements);
    // Store fibonacci retracements for rendering
    this._fibonacciRetracements = fibonacciRetracements;
    console.log('PaneWidget: After update, local map size:', this._fibonacciRetracements.size);
    console.log('PaneWidget: Local fibonacci map:', this._fibonacciRetracements);
}

	public stretchFactor(): number {
		return this._state !== null ? this._state.stretchFactor() : 0;
	}

	public setStretchFactor(stretchFactor: number): void {
		if (this._state) {
			this._state.setStretchFactor(stretchFactor);
		}
	}

public mouseEnterEvent(event: MouseEventHandlerMouseEvent): void {
		if (!this._state) {
			return;
		}
		this._onMouseEvent();
		const x = event.localX;
		const y = event.localY;
		this._setCrosshairPosition(x, y, event);
	}

	public mouseDownEvent(event: MouseEventHandlerMouseEvent): void {
    this._onMouseEvent();
    
    // Check for trendline interaction first
    const trendlineHit = this._hitTestTrendlines(event.localX, event.localY);
if (trendlineHit) {
    this._handleTrendlineMouseDown(trendlineHit, event);
    return;
}

// Check for fibonacci interaction
console.log('Testing fibonacci hit at:', event.localX, event.localY);
const fibonacciHit = this._hitTestFibonacci(event.localX, event.localY);
console.log('Fibonacci hit result:', fibonacciHit);
if (fibonacciHit) {
    console.log('Fibonacci hit detected, handling mouse down');
    this._handleFibonacciMouseDown(fibonacciHit, event);
    return;
}

// Clear selections if clicking elsewhere
this.clearTrendlineSelection();
this.clearFibonacciSelection();
    
    this._mouseTouchDownEvent();
    this._setCrosshairPosition(event.localX, event.localY, event);
}

	public mouseMoveEvent(event: MouseEventHandlerMouseEvent): void {
    if (!this._state) {
        return;
    }
    
    // Handle trendline dragging
    if (this._trendlineSelection.dragState?.isDragging) {
    this._handleTrendlineDrag(event);
    return;
}

// Handle fibonacci dragging
if (this._fibonacciSelection.dragState?.isDragging) {
    this._handleFibonacciDrag(event);
    return;
}
    
    this._onMouseEvent();
    const x = event.localX;
    const y = event.localY;
    
    // Get trendline state from model
    const model = this._model();
const isTrendlineDrawing = model.isDrawingTrendline();
const isFibonacciDrawing = this._chart.isDrawingFibonacci();
const trendlineStartPoint = model.getTrendlineStartPoint();
const fibonacciStartPoint = this._chart.getFibonacciStartPoint();

if (isTrendlineDrawing) {
    // If we have a start point, update the preview line
    if (trendlineStartPoint) {
        this._updateTrendlinePreview(x, y);
    }
    // ALWAYS update crosshair position for the dot in drawing mode
    this._setCrosshairPosition(x, y, event);
    return;
}

if (isFibonacciDrawing) {
    // If we have a start point, update the fibonacci preview
    if (fibonacciStartPoint) {
        this._updateFibonacciPreview(x, y);
    }
    // ALWAYS update crosshair position for the dot in drawing mode
    this._setCrosshairPosition(x, y, event);
    return;
}
    
    // Change cursor based on hover state
    this._updateCursorForTrendlineHover(x, y);
this._updateCursorForFibonacciHover(x, y);
    
    this._setCrosshairPosition(x, y, event);
}

private _updateFibonacciPreview(currentX: number, currentY: number): void {
    const fibonacciStartPoint = this._chart.getFibonacciStartPoint();
    if (!fibonacciStartPoint) {
        return;
    }
    
    // Store the preview end point for rendering
    const priceScale = this._state?.defaultPriceScale();
    const firstValue = priceScale?.firstValue();
    if (!priceScale || firstValue === null || firstValue === undefined) {
        return;
    }

    const currentPrice = (priceScale as any)._internal_coordinateToPrice(currentY as Coordinate, firstValue);
    if (currentPrice === null) {
        return;
    }
    
    // Use the same time calculation logic as trendlines
    let currentTime: number;
    const timeScale = this._model().timeScale() as any;
    
    try {
        const baseIndex = timeScale._internal_baseIndex();
        const baseCoord = timeScale._internal_indexToCoordinate(baseIndex);
        
        if (baseCoord !== null && currentX > baseCoord) {
            // Beyond data range - extrapolate
            const baseTime = timeScale._internal_indexToTimeScalePoint(baseIndex)?.originalTime;
            const prevIndex = baseIndex - 1;
            const prevTime = timeScale._internal_indexToTimeScalePoint(prevIndex)?.originalTime;
            const prevCoord = timeScale._internal_indexToCoordinate(prevIndex);
            
            if (baseTime !== undefined && prevTime !== undefined && prevCoord !== null) {
                const timeInterval = (baseTime as number) - (prevTime as number);
                const coordInterval = baseCoord - prevCoord;
                
                if (coordInterval !== 0) {
                    const timePerPixel = timeInterval / coordInterval;
                    const pixelsBeyondBase = currentX - baseCoord;
                    currentTime = (baseTime as number) + (pixelsBeyondBase * timePerPixel);
                } else {
                    currentTime = (baseTime as number);
                }
            } else {
                currentTime = Date.now() / 1000;
            }
        } else {
            // Within data range - use normal conversion
            const index = timeScale._internal_coordinateToIndex(currentX);
            if (index !== null) {
                const timePoint = timeScale._internal_indexToTimeScalePoint(index)?.originalTime;
                currentTime = timePoint !== undefined ? (timePoint as number) : Date.now() / 1000;
            } else {
                currentTime = Date.now() / 1000;
            }
        }
    } catch (error) {
        console.error('Error calculating time for fibonacci preview:', error);
        currentTime = Date.now() / 1000;
    }
    
    // Set the preview data in the chart
    this._chart.setFibonacciPreviewEnd({
        x: currentX,
        y: currentY,
        time: currentTime,
        price: currentPrice
    });
    
    // Trigger a light update to redraw the preview
    this._model().lightUpdate();
}


private _updateTrendlinePreview(currentX: number, currentY: number): void {
    const model = this._model();
    const startPoint = model.getTrendlineStartPoint();
    if (!startPoint) {
        return;
    }
    
    // Store the preview end point for rendering
    const priceScale = this._state?.defaultPriceScale();
    const firstValue = priceScale?.firstValue();
    if (!priceScale || firstValue === null || firstValue === undefined) {
        return;
    }

    const currentPrice = (priceScale as any)._internal_coordinateToPrice(currentY as Coordinate, firstValue);
    if (currentPrice === null) {
        return;
    }
    
    let currentTime: number;
    
    // Use a unified approach for time calculation that works both inside and outside data range
    const timeScale = this._model().timeScale() as any;
    
    // Try to get the time using coordinate conversion first
    try {
        // Get visible range to determine if we need extrapolation
        const visibleRange = timeScale.visibleStrictRange();
        const baseIndex = timeScale._internal_baseIndex();
        const baseCoord = timeScale._internal_indexToCoordinate(baseIndex);
        
        if (visibleRange && baseCoord !== null && currentX > baseCoord) {
            // Beyond data range - use extrapolation
            const baseTime = timeScale._internal_indexToTimeScalePoint(baseIndex)?.originalTime;
            const prevIndex = baseIndex - 1;
            const prevTime = timeScale._internal_indexToTimeScalePoint(prevIndex)?.originalTime;
            const prevCoord = timeScale._internal_indexToCoordinate(prevIndex);
            
            if (baseTime !== undefined && prevTime !== undefined && prevCoord !== null) {
                const timeInterval = (baseTime as number) - (prevTime as number);
                const coordInterval = baseCoord - prevCoord;
                
                if (coordInterval !== 0) {
                    const timePerPixel = timeInterval / coordInterval;
                    const pixelsBeyondBase = currentX - baseCoord;
                    currentTime = (baseTime as number) + (pixelsBeyondBase * timePerPixel);
                } else {
                    currentTime = (baseTime as number);
                }
            } else {
                currentTime = Date.now() / 1000;
            }
        } else {
            // Within or before data range - use interpolation
            // Get two reference points for interpolation
            let leftIndex: number = -1, rightIndex: number = -1;
            let leftCoord: number = -1, rightCoord: number = -1;
            let leftTime: number, rightTime: number;
            
            if (visibleRange) {
                const leftVisibleIndex = Math.floor(visibleRange.left());
                const rightVisibleIndex = Math.ceil(visibleRange.right());
                
                // Find the two closest data points around currentX
                let foundLeft = false, foundRight = false;
                
                for (let i = leftVisibleIndex; i <= rightVisibleIndex; i++) {
                    const coord = timeScale._internal_indexToCoordinate(i);
                    if (coord !== null) {
                        if (coord <= currentX && (!foundLeft || i > leftIndex)) {
                            leftIndex = i;
                            leftCoord = coord;
                            foundLeft = true;
                        }
                        if (coord >= currentX && (!foundRight || i < rightIndex || rightIndex === -1)) {
                            rightIndex = i;
                            rightCoord = coord;
                            foundRight = true;
                        }
                    }
                }
                
                // If we found both bounds, interpolate
                if (foundLeft && foundRight && leftIndex !== rightIndex && leftIndex !== -1 && rightIndex !== -1) {
                    const leftTimePoint = timeScale._internal_indexToTimeScalePoint(leftIndex)?.originalTime;
                    const rightTimePoint = timeScale._internal_indexToTimeScalePoint(rightIndex)?.originalTime;
                    
                    if (leftTimePoint !== undefined && rightTimePoint !== undefined) {
                        leftTime = leftTimePoint as number;
                        rightTime = rightTimePoint as number;
                        
                        // Linear interpolation
                        const coordRatio = (currentX - leftCoord) / (rightCoord - leftCoord);
                        currentTime = leftTime + (rightTime - leftTime) * coordRatio;
                    } else {
                        // Fallback to closest point
                        const closestIndex = Math.abs(currentX - leftCoord) < Math.abs(currentX - rightCoord) ? leftIndex : rightIndex;
                        const closestTime = timeScale._internal_indexToTimeScalePoint(closestIndex)?.originalTime;
                        currentTime = closestTime !== undefined ? (closestTime as number) : Date.now() / 1000;
                    }
                } else if (foundLeft && leftIndex !== -1) {
                    // Only left bound found, use it
                    const leftTimePoint = timeScale._internal_indexToTimeScalePoint(leftIndex)?.originalTime;
                    currentTime = leftTimePoint !== undefined ? (leftTimePoint as number) : Date.now() / 1000;
                } else if (foundRight && rightIndex !== -1) {
                    // Only right bound found, use it
                    const rightTimePoint = timeScale._internal_indexToTimeScalePoint(rightIndex)?.originalTime;
                    currentTime = rightTimePoint !== undefined ? (rightTimePoint as number) : Date.now() / 1000;
                } else {
                    // No bounds found, fallback
                    currentTime = Date.now() / 1000;
                }
            } else {
                // No visible range, fallback
                currentTime = Date.now() / 1000;
            }
        }
    } catch (error) {
        console.error('Error calculating time for preview:', error);
        currentTime = Date.now() / 1000;
    }
    
    // Set the preview data in the model
    model.setTrendlinePreviewEnd({
        x: currentX,
        y: currentY,
        time: currentTime,
        price: currentPrice
    });
    
    // Trigger a light update to redraw the preview
    this._model().lightUpdate();
}

	public mouseClickEvent(event: MouseEventHandlerMouseEvent): void {
		if (this._state === null) {
			return;
		}
		this._onMouseEvent();
		this._fireClickedDelegate(event);
	}

	public mouseDoubleClickEvent(event: MouseEventHandlerMouseEvent | MouseEventHandlerTouchEvent): void {
		if (this._state === null) {
			return;
		}
		this._fireMouseClickDelegate(this._dblClicked, event);
	}

	public doubleTapEvent(event: MouseEventHandlerTouchEvent): void {
		this.mouseDoubleClickEvent(event);
	}

	public pressedMouseMoveEvent(event: MouseEventHandlerMouseEvent): void {
    this._onMouseEvent();
    
    // Handle trendline dragging
    if (this._trendlineSelection.dragState?.isDragging) {
        this._handleTrendlineDrag(event);
        return;
    }
    
    this._pressedMouseTouchMoveEvent(event);
    this._setCrosshairPosition(event.localX, event.localY, event);
}

	public mouseUpEvent(event: MouseEventHandlerMouseEvent): void {
    if (this._state === null) {
        return;
    }
    this._onMouseEvent();

    // Handle end of trendline dragging
    if (this._fibonacciSelection.dragState?.isDragging) {
    this._fibonacciSelection.dragState.isDragging = false;
    this._topCanvasBinding.canvasElement.style.cursor = 'default';
    // Keep the selection but stop dragging
    this._fibonacciSelection.dragState = null;
    return;
}

    this._longTap = false;
    this._endScroll(event);
}

	public tapEvent(event: MouseEventHandlerTouchEvent): void {
		if (this._state === null) {
			return;
		}
		this._fireClickedDelegate(event);
	}

	public longTapEvent(event: MouseEventHandlerTouchEvent): void {
		this._longTap = true;

		if (this._startTrackPoint === null) {
			const point: Point = { x: event.localX, y: event.localY };
			this._startTrackingMode(point, point, event);
		}
	}

	public mouseLeaveEvent(event: MouseEventHandlerMouseEvent): void {
    if (this._state === null) {
        return;
    }
    this._onMouseEvent();

    // Reset cursor when leaving
    this._topCanvasBinding.canvasElement.style.cursor = 'default';

    this._state.model().setHoveredSource(null);
    this._clearCrosshairPosition();
}

	public clicked(): ISubscription<TimePointIndex | null, Point, TouchMouseEventData> {
		return this._clicked;
	}

	public dblClicked(): ISubscription<TimePointIndex | null, Point, TouchMouseEventData> {
		return this._dblClicked;
	}

	public pinchStartEvent(): void {
		this._prevPinchScale = 1;
		this._model().stopTimeScaleAnimation();
	}

	public pinchEvent(middlePoint: Position, scale: number): void {
		if (!this._chart.options()['handleScale'].pinch) {
			return;
		}

		const zoomScale = (scale - this._prevPinchScale) * 5;
		this._prevPinchScale = scale;

		this._model().zoomTime(middlePoint.x as Coordinate, zoomScale);
	}

	public touchStartEvent(event: MouseEventHandlerTouchEvent): void {
		this._longTap = false;
		this._exitTrackingModeOnNextTry = this._startTrackPoint !== null;

		this._mouseTouchDownEvent();

		const crosshair = this._model().crosshairSource();
		if (this._startTrackPoint !== null && crosshair.visible()) {
			this._initCrosshairPosition = { x: crosshair.appliedX(), y: crosshair.appliedY() };
			this._startTrackPoint = { x: event.localX, y: event.localY };
		}
	}

	public touchMoveEvent(event: MouseEventHandlerTouchEvent): void {
		if (this._state === null) {
			return;
		}

		const x = event.localX;
		const y = event.localY;
		if (this._startTrackPoint !== null) {
			// tracking mode: move crosshair
			this._exitTrackingModeOnNextTry = false;
			const origPoint = ensureNotNull(this._initCrosshairPosition);
			const newX = origPoint.x + (x - this._startTrackPoint.x) as Coordinate;
			const newY = origPoint.y + (y - this._startTrackPoint.y) as Coordinate;
			this._setCrosshairPosition(newX, newY, event);
			return;
		}

		this._pressedMouseTouchMoveEvent(event);
	}

	public touchEndEvent(event: MouseEventHandlerTouchEvent): void {
		if (this.chart().options().trackingMode.exitMode === TrackingModeExitMode.OnTouchEnd) {
			this._exitTrackingModeOnNextTry = true;
		}
		this._tryExitTrackingMode();
		this._endScroll(event);
	}

	public hitTest(x: Coordinate, y: Coordinate): HitTestResult | null {
		const state = this._state;
		if (state === null) {
			return null;
		}

		return hitTestPane(state, x, y);
	}

	public setPriceAxisSize(width: number, position: PriceAxisWidgetSide): void {
		const priceAxisWidget = position === 'left' ? this._leftPriceAxisWidget : this._rightPriceAxisWidget;
		ensureNotNull(priceAxisWidget).setSize(size({ width, height: this._size.height }));
	}

	public getSize(): Size {
		return this._size;
	}

	public setSize(newSize: Size): void {
		if (equalSizes(this._size, newSize)) {
			return;
		}

		this._size = newSize;
		this._isSettingSize = true;
		this._canvasBinding.resizeCanvasElement(newSize);
		this._topCanvasBinding.resizeCanvasElement(newSize);
		this._isSettingSize = false;
		this._paneCell.style.width = newSize.width + 'px';
		this._paneCell.style.height = newSize.height + 'px';
	}

	public recalculatePriceScales(): void {
		const pane = ensureNotNull(this._state);
		pane.recalculatePriceScale(pane.leftPriceScale());
		pane.recalculatePriceScale(pane.rightPriceScale());

		for (const source of pane.dataSources()) {
			if (pane.isOverlay(source)) {
				const priceScale = source.priceScale();
				if (priceScale !== null) {
					pane.recalculatePriceScale(priceScale);
				}

				// for overlay drawings price scale is owner's price scale
				// however owner's price scale could not contain ds
				source.updateAllViews();
			}
		}
		for (const primitive of pane.primitives()) {
			primitive.updateAllViews();
		}
	}

	public getBitmapSize(): Size {
		return this._canvasBinding.bitmapSize;
	}

	public drawBitmap(ctx: CanvasRenderingContext2D, x: number, y: number): void {
		const bitmapSize = this.getBitmapSize();
		if (bitmapSize.width > 0 && bitmapSize.height > 0) {
			ctx.drawImage(this._canvasBinding.canvasElement, x, y);
		}
	}

	public paint(type: InvalidationLevel): void {
		if (type === InvalidationLevel.None) {
			return;
		}

		if (this._state === null) {
			return;
		}

		if (type > InvalidationLevel.Cursor) {
			this.recalculatePriceScales();
		}

		if (this._leftPriceAxisWidget !== null) {
			this._leftPriceAxisWidget.paint(type);
		}
		if (this._rightPriceAxisWidget !== null) {
			this._rightPriceAxisWidget.paint(type);
		}

		const canvasOptions: CanvasRenderingContext2DSettings = {
			colorSpace: this._chart.options().layout.colorSpace,
		};

		if (type !== InvalidationLevel.Cursor) {
			this._canvasBinding.applySuggestedBitmapSize();
			const target = tryCreateCanvasRenderingTarget2D(this._canvasBinding, canvasOptions);
			if (target !== null) {
				target.useBitmapCoordinateSpace((scope: BitmapCoordinatesRenderingScope) => {
					this._drawBackground(scope);
				});
				if (this._state) {
					this._drawSources(target, sourceBottomPaneViews);
					this._drawGrid(target);
					this._drawSources(target, sourcePaneViews);
					this._drawSources(target, sourceLabelPaneViews);
				}
				// Draw trendlines
				this._drawTrendlines(target);
				// Draw trendline preview
				this._drawTrendlinePreview(target);
				// Draw fibonacci retracements
				this._drawFibonacciRetracements(target);
                this._drawFibonacciPreview(target);
			}
		}

		this._topCanvasBinding.applySuggestedBitmapSize();
		const topTarget = tryCreateCanvasRenderingTarget2D(this._topCanvasBinding, canvasOptions);
		if (topTarget !== null) {
			topTarget.useBitmapCoordinateSpace(({ context: ctx, bitmapSize }: BitmapCoordinatesRenderingScope) => {
				ctx.clearRect(0, 0, bitmapSize.width, bitmapSize.height);
			});
			this._drawCrosshair(topTarget);
this._drawSources(topTarget, sourceTopPaneViews);
this._drawSources(topTarget, sourceLabelPaneViews);
// Add this new line:
this._drawTrendlineSelectionIndicators(topTarget);
this._drawFibonacciSelectionIndicators(topTarget);
		}
	}

    private _drawFibonacciPreview(target: CanvasRenderingTarget2D): void {
    const isDrawing = this._chart.isDrawingFibonacci();
    const startPoint = this._chart.getFibonacciStartPoint();
    const previewEnd = this._chart.getFibonacciPreviewEnd();
    
    // Only draw preview if we're in fibonacci drawing mode and have both start and preview end points
    if (!isDrawing || !startPoint || !previewEnd) {
        return;
    }
    
    console.log('Drawing fibonacci preview from:', startPoint, 'to:', previewEnd);

    target.useBitmapCoordinateSpace((scope) => {
        const ctx = scope.context;
        
        try {
            // Calculate fibonacci levels
            const priceRange = Math.abs(previewEnd.price - startPoint.price);
            const isUptrend = previewEnd.price > startPoint.price;
            const baseLevelPrice = isUptrend ? previewEnd.price : startPoint.price;
            const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
            
            // Get X range for drawing
            const startX = Math.min(startPoint.x, previewEnd.x) * scope.horizontalPixelRatio;
            const endX = Math.max(startPoint.x, previewEnd.x) * scope.horizontalPixelRatio;
            
            ctx.save();
            ctx.strokeStyle = '#2196F3'; // Blue color for preview
            ctx.lineWidth = 1;
            ctx.globalAlpha = 0.6; // Make it semi-transparent
            ctx.setLineDash([3, 3]); // Dashed line for preview
            ctx.font = `${12 * scope.horizontalPixelRatio}px Arial`;
            ctx.fillStyle = '#2196F3';
            
            // Draw each fibonacci level
            levels.forEach((level) => {
                const retracement = priceRange * level;
                const levelPrice = isUptrend ? baseLevelPrice - retracement : baseLevelPrice + retracement;
                
                // Convert price to screen coordinate
                const priceScale = this._state?.defaultPriceScale();
                const firstValue = priceScale?.firstValue();
                if (priceScale && firstValue !== null) {
                    const priceY = (priceScale as any)._internal_priceToCoordinate(levelPrice, firstValue);
                    
                    if (priceY !== null) {
                        const y = priceY * scope.verticalPixelRatio;
                        
                        // Draw horizontal line
                        ctx.beginPath();
                        ctx.moveTo(startX, y);
                        ctx.lineTo(endX, y);
                        ctx.stroke();
                        
                        // Draw level label
                        const percentage = `${(level * 100).toFixed(1)}%`;
                        const labelText = `${percentage} (${levelPrice.toFixed(4)})`;
ctx.fillText(labelText, endX + 5 * scope.horizontalPixelRatio, y + 4 * scope.verticalPixelRatio);
                    }
                }
            });
            
            ctx.restore();
            
        } catch (error) {
            console.error('Error drawing fibonacci preview:', error);
        }
    });
}

private _drawTrendlinePreview(target: CanvasRenderingTarget2D): void {
    const model = this._model();
    const isDrawing = model.isDrawingTrendline();
    const startPoint = model.getTrendlineStartPoint();
    const previewEnd = model.getTrendlinePreviewEnd();
    
    
    // Only draw preview if we're in trendline drawing mode and have both start and preview end points
    if (!isDrawing || !startPoint || !previewEnd) {
        return;
    }
    
    //console.log('Actually drawing preview line from:', startPoint, 'to:', previewEnd);

    target.useBitmapCoordinateSpace((scope) => {
        const ctx = scope.context;
        
        try {
            // Use stored coordinates directly
            const x1 = startPoint.x * scope.horizontalPixelRatio;
            const y1 = startPoint.y * scope.verticalPixelRatio;
            const x2 = previewEnd.x * scope.horizontalPixelRatio;
            const y2 = previewEnd.y * scope.verticalPixelRatio;
            
            ctx.save();
            ctx.strokeStyle = '#2196F3'; // Blue color for preview
            ctx.lineWidth = 1;
            ctx.globalAlpha = 0.6; // Make it semi-transparent
            ctx.setLineDash([5, 5]); // Dashed line for preview
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            ctx.restore();
            
            //console.log('Drew preview line from', x1, y1, 'to', x2, y2);
            
        } catch (error) {
            console.error('Error drawing trendline preview:', error);
        }
    });
}

	public leftPriceAxisWidget(): PriceAxisWidget | null {
		return this._leftPriceAxisWidget;
	}

	public rightPriceAxisWidget(): PriceAxisWidget | null {
		return this._rightPriceAxisWidget;
	}

	public drawAdditionalSources(target: CanvasRenderingTarget2D, paneViewsGetter: ViewsGetter<IDataSourcePaneViews>): void {
		this._drawSources(target, paneViewsGetter);
	}

	private _onStateDestroyed(): void {
		if (this._state !== null) {
			this._state.onDestroyed().unsubscribeAll(this);
		}

		this._state = null;
	}

	private _fireClickedDelegate(event: MouseEventHandlerEventBase): void {
		this._fireMouseClickDelegate(this._clicked, event);
	}

	private _fireMouseClickDelegate(delegate: Delegate<TimePointIndex | null, Point, TouchMouseEventData>, event: MouseEventHandlerEventBase): void {
		const x = event.localX;
		const y = event.localY;
		if (delegate.hasListeners()) {
			delegate.fire(this._model().timeScale().coordinateToIndex(x), { x, y }, event);
		}
	}

	private _drawBackground({ context: ctx, bitmapSize }: BitmapCoordinatesRenderingScope): void {
		const { width, height } = bitmapSize;
		const model = this._model();
		const topColor = model.backgroundTopColor();
		const bottomColor = model.backgroundBottomColor();

		if (topColor === bottomColor) {
			clearRect(ctx, 0, 0, width, height, bottomColor);
		} else {
			clearRectWithGradient(ctx, 0, 0, width, height, topColor, bottomColor);
		}
	}

	private _drawGrid(target: CanvasRenderingTarget2D): void {
		const state = ensureNotNull(this._state);
		const paneView = state.grid().paneView();
		const renderer = paneView.renderer(state);

		if (renderer !== null) {
			renderer.draw(target, false);
		}
	}

	private _drawCrosshair(target: CanvasRenderingTarget2D): void {
		this._drawSourceImpl(target, sourcePaneViews, drawForeground, this._model().crosshairSource());
	}

	private _drawSources(target: CanvasRenderingTarget2D, paneViewsGetter: ViewsGetter<IDataSourcePaneViews>): void {
		const state = ensureNotNull(this._state);
		const sources = state.orderedSources();

		const panePrimitives = state.primitives();
		for (const panePrimitive of panePrimitives) {
			this._drawSourceImpl(target, paneViewsGetter, drawBackground, panePrimitive);
		}
		for (const source of sources) {
			this._drawSourceImpl(target, paneViewsGetter, drawBackground, source);
		}

		for (const panePrimitive of panePrimitives) {
			this._drawSourceImpl(target, paneViewsGetter, drawForeground, panePrimitive);
		}
		for (const source of sources) {
			this._drawSourceImpl(target, paneViewsGetter, drawForeground, source);
		}
	}

	private _drawSourceImpl(
		target: CanvasRenderingTarget2D,
		paneViewsGetter: ViewsGetter<IDataSourcePaneViews>,
		drawFn: DrawFunction,
		source: IDataSourcePaneViews
	): void {
		const state = ensureNotNull(this._state);
		const hoveredSource = state.model().hoveredSource();
		const isHovered = hoveredSource !== null && hoveredSource.source === source;
		const objecId = hoveredSource !== null && isHovered && hoveredSource.object !== undefined
			? hoveredSource.object.hitTestData
			: undefined;

		const drawRendererFn = (renderer: IPaneRenderer) => drawFn(renderer, target, isHovered, objecId);
		drawSourceViews(paneViewsGetter, drawRendererFn, source, state);
	}

	private _recreatePriceAxisWidgets(): void {
		if (this._state === null) {
			return;
		}
		const chart = this._chart;
		const leftAxisVisible = this._state.leftPriceScale().options().visible;
		const rightAxisVisible = this._state.rightPriceScale().options().visible;
		if (!leftAxisVisible && this._leftPriceAxisWidget !== null) {
			this._leftAxisCell.removeChild(this._leftPriceAxisWidget.getElement());
			this._leftPriceAxisWidget.destroy();
			this._leftPriceAxisWidget = null;
		}
		if (!rightAxisVisible && this._rightPriceAxisWidget !== null) {
			this._rightAxisCell.removeChild(this._rightPriceAxisWidget.getElement());
			this._rightPriceAxisWidget.destroy();
			this._rightPriceAxisWidget = null;
		}
		const rendererOptionsProvider = chart.model().rendererOptionsProvider();
		if (leftAxisVisible && this._leftPriceAxisWidget === null) {
			this._leftPriceAxisWidget = new PriceAxisWidget(this, chart.options(), rendererOptionsProvider, 'left');
			this._leftAxisCell.appendChild(this._leftPriceAxisWidget.getElement());
		}
		if (rightAxisVisible && this._rightPriceAxisWidget === null) {
			this._rightPriceAxisWidget = new PriceAxisWidget(this, chart.options(), rendererOptionsProvider, 'right');
			this._rightAxisCell.appendChild(this._rightPriceAxisWidget.getElement());
		}
	}

	private _preventScroll(event: TouchMouseEvent): boolean {
		return event.isTouch && this._longTap || this._startTrackPoint !== null;
	}

	private _correctXCoord(x: Coordinate): Coordinate {
		return Math.max(0, Math.min(x, this._size.width - 1)) as Coordinate;
	}

	private _correctYCoord(y: Coordinate): Coordinate {
		return Math.max(0, Math.min(y, this._size.height - 1)) as Coordinate;
	}

	private _setCrosshairPosition(x: Coordinate, y: Coordinate, event: MouseEventHandlerEventBase): void {
    const model = this._model();
    const isDrawing = model.isDrawingTrendline();
    
    //console.log('_setCrosshairPosition called with:', x, y, 'isDrawing:', isDrawing);
    
    if (isDrawing) {
        //console.log('=== IN TRENDLINE DRAWING MODE ===');
        //console.log('About to call _setCrosshairPosition with:', x, y);
        
        // During trendline drawing, show only the dot with completely free movement
        const priceScale = ensureNotNull(this._state).defaultPriceScale();
        const firstValue = priceScale.firstValue();
        if (firstValue !== null) {
            const price = priceScale.coordinateToPrice(y, firstValue);
            
            //console.log('Calculated price from coordinate:', price);
            
            // Directly manipulate crosshair for free movement
            const crosshair = this._model().crosshairSource();
            
            // Force crosshair to be visible with dot only
            crosshair._visible = true;
            crosshair._pane = ensureNotNull(this._state);
            crosshair._price = price;
            crosshair._x = x;
            crosshair._y = y;
            
            // Set a dummy index that doesn't affect positioning
            const timeScale = this._model().timeScale();
            const visibleRange = timeScale.visibleStrictRange();
            if (visibleRange !== null) {
                crosshair._index = Math.floor((visibleRange.left() + visibleRange.right()) / 2) as TimePointIndex;
            } else {
                crosshair._index = 0 as TimePointIndex;
            }
            
            // Force the crosshair to drawing mode - check if method exists first
            if (typeof crosshair.setDrawingMode === 'function') {
                crosshair._showCenterDot = true;
            } else {
                // Fallback: directly set the drawing mode properties
                crosshair._showCenterDot = true;
            }
            
            // Update all crosshair views to reflect the new position
            crosshair.updateAllViews();
            
            // Trigger a cursor update to redraw
            this._model().cursorUpdate();
            
            //console.log('Set crosshair dot position freely:', x, y, 'price:', price);
        }
        return;
    }
    
    // Normal crosshair positioning (with magnet/snapping)
    this._model().setAndSaveCurrentPosition(this._correctXCoord(x), this._correctYCoord(y), event, ensureNotNull(this._state));
}

	private _clearCrosshairPosition(): void {
		this._model().clearCurrentPosition();
	}

	private _tryExitTrackingMode(): void {
		if (this._exitTrackingModeOnNextTry) {
			this._startTrackPoint = null;
			this._clearCrosshairPosition();
		}
	}

	private _startTrackingMode(startTrackPoint: Point, crossHairPosition: Point, event: MouseEventHandlerEventBase): void {
		this._startTrackPoint = startTrackPoint;
		this._exitTrackingModeOnNextTry = false;
		this._setCrosshairPosition(crossHairPosition.x, crossHairPosition.y, event);
		const crosshair = this._model().crosshairSource();
		this._initCrosshairPosition = { x: crosshair.appliedX(), y: crosshair.appliedY() };
	}

	private _model(): IChartModelBase {
		return this._chart.model();
	}

	private _endScroll(event: TouchMouseEvent): void {
		if (!this._isScrolling) {
			return;
		}

		const model = this._model();
		const state = this.state();

		model.endScrollPrice(state, state.defaultPriceScale());

		this._startScrollingPos = null;
		this._isScrolling = false;
		model.endScrollTime();

		if (this._scrollXAnimation !== null) {
			const startAnimationTime = performance.now();
			const timeScale = model.timeScale();

			this._scrollXAnimation.start(timeScale.rightOffset() as Coordinate, startAnimationTime);

			if (!this._scrollXAnimation.finished(startAnimationTime)) {
				model.setTimeScaleAnimation(this._scrollXAnimation);
			}
		}
	}

	private _onMouseEvent(): void {
		this._startTrackPoint = null;
	}

	private _mouseTouchDownEvent(): void {
		if (!this._state) {
			return;
		}

		this._model().stopTimeScaleAnimation();

		if (document.activeElement !== document.body && document.activeElement !== document.documentElement) {
			// If any focusable element except the page itself is focused, remove the focus
			(ensureNotNull(document.activeElement) as HTMLElement).blur();
		} else {
			// Clear selection
			const selection = document.getSelection();
			if (selection !== null) {
				selection.removeAllRanges();
			}
		}

		const priceScale = this._state.defaultPriceScale();

		if (priceScale.isEmpty() || this._model().timeScale().isEmpty()) {
			return;
		}
	}

	// eslint-disable-next-line complexity
	private _pressedMouseTouchMoveEvent(event: TouchMouseEvent): void {
		if (this._state === null) {
			return;
		}

		const model = this._model();
		const timeScale = model.timeScale();

		if (timeScale.isEmpty()) {
			return;
		}

		const chartOptions = this._chart.options();
		const scrollOptions = chartOptions['handleScroll'];
		const kineticScrollOptions = chartOptions.kineticScroll;
		if (
			(!scrollOptions.pressedMouseMove || event.isTouch) &&
			(!scrollOptions.horzTouchDrag && !scrollOptions.vertTouchDrag || !event.isTouch)
		) {
			return;
		}

		const priceScale = this._state.defaultPriceScale();

		const now = performance.now();

		if (this._startScrollingPos === null && !this._preventScroll(event)) {
			this._startScrollingPos = {
				x: event.clientX,
				y: event.clientY,
				timestamp: now,
				localX: event.localX,
				localY: event.localY,
			};
		}

		if (
			this._startScrollingPos !== null &&
			!this._isScrolling &&
			(this._startScrollingPos.x !== event.clientX || this._startScrollingPos.y !== event.clientY)
		) {
			if (event.isTouch && kineticScrollOptions.touch || !event.isTouch && kineticScrollOptions.mouse) {
				const barSpacing = timeScale.barSpacing();
				this._scrollXAnimation = new KineticAnimation(
					KineticScrollConstants.MinScrollSpeed / barSpacing,
					KineticScrollConstants.MaxScrollSpeed / barSpacing,
					KineticScrollConstants.DumpingCoeff,
					KineticScrollConstants.ScrollMinMove / barSpacing
				);
				this._scrollXAnimation.addPosition(timeScale.rightOffset() as Coordinate, this._startScrollingPos.timestamp);
			} else {
				this._scrollXAnimation = null;
			}

			if (!priceScale.isEmpty()) {
				model.startScrollPrice(this._state, priceScale, event.localY);
			}

			model.startScrollTime(event.localX);
			this._isScrolling = true;
		}

		if (this._isScrolling) {
			// this allows scrolling not default price scales
			if (!priceScale.isEmpty()) {
				model.scrollPriceTo(this._state, priceScale, event.localY);
			}

			model.scrollTimeTo(event.localX);
			if (this._scrollXAnimation !== null) {
				this._scrollXAnimation.addPosition(timeScale.rightOffset() as Coordinate, now);
			}
		}
	}

	private readonly _canvasSuggestedBitmapSizeChangedHandler = () => {
		if (this._isSettingSize || this._state === null) {
			return;
		}

		this._model().lightUpdate();
	};

	private readonly _topCanvasSuggestedBitmapSizeChangedHandler = () => {
		if (this._isSettingSize || this._state === null) {
			return;
		}

		this._model().lightUpdate();
	};

	private _drawTrendlines(target: CanvasRenderingTarget2D): void {
    if (this._state === null || this._trendlines.size === 0) {
        return;
    }

    const timeScale = this._model().timeScale() as any;
    const priceScale = this._state.defaultPriceScale() as any;
    const firstValue = priceScale._internal_firstValue();
    
    if (firstValue === null) {
        return;
    }

    this._trendlines.forEach((trendline, id) => {
        target.useBitmapCoordinateSpace((scope) => {
            const ctx = scope.context;
            const options = trendline.options();
            const data = trendline.data();
            
            try {
                // Try to convert both points using enhanced coordinate conversion
                const coords1 = this._timeAndPriceToCoordinates(data.point1.time as number, data.point1.value, timeScale, priceScale, firstValue);
                const coords2 = this._timeAndPriceToCoordinates(data.point2.time as number, data.point2.value, timeScale, priceScale, firstValue);
                
                if (coords1 === null || coords2 === null) {
                    return;
                }
                
                const { x: x1, y: y1 } = coords1;
                const { x: x2, y: y2 } = coords2;
                
                ctx.save();

// Use different styling if this trendline is selected
if (id === this._trendlineSelection.selectedTrendlineId) {
    ctx.strokeStyle = '#2196F3'; // Blue for selected
    ctx.lineWidth = options.lineWidth + 1; // Slightly thicker
} else {
    ctx.strokeStyle = options.color;
    ctx.lineWidth = options.lineWidth;
}

ctx.beginPath();
ctx.moveTo(x1, y1);
ctx.lineTo(x2, y2);
ctx.stroke();
ctx.restore();
                
                //console.log('Drew trendline from', x1, y1, 'to', x2, y2, 'times:', data.point1.time, data.point2.time);
                
            } catch (error) {
                console.error('Error drawing trendline:', error);
            }
        });
    });
}

private _drawFibonacciRetracements(target: CanvasRenderingTarget2D): void {
    if (this._state === null || this._fibonacciRetracements.size === 0) {
        return;
    }

    const timeScale = this._model().timeScale() as any;
    const priceScale = this._state.defaultPriceScale() as any;
    const firstValue = priceScale._internal_firstValue();
    
    if (firstValue === null) {
        return;
    }

    this._fibonacciRetracements.forEach((fibonacci) => {
        target.useBitmapCoordinateSpace((scope) => {
            const ctx = scope.context;
            const options = fibonacci.options();
            const data = fibonacci.data();
            
            try {
                // Access the internal properties correctly
                const point1Time = (data as any)._internal_point1._internal_time;
                const point1Value = (data as any)._internal_point1._internal_value;
                const point2Time = (data as any)._internal_point2._internal_time;
                const point2Value = (data as any)._internal_point2._internal_value;
                
                console.log('Using times:', point1Time, point2Time);
                console.log('Using values:', point1Value, point2Value);
                
                // Use the same coordinate conversion as trendlines
                const coords1 = this._timeAndPriceToCoordinates(point1Time, point1Value, timeScale, priceScale, firstValue);
                const coords2 = this._timeAndPriceToCoordinates(point2Time, point2Value, timeScale, priceScale, firstValue);
                
                if (coords1 === null || coords2 === null) {
                    console.log('Could not convert coordinates for fibonacci retracement');
                    return;
                }
                
                // Get the X range for drawing
                const startX = Math.min(coords1.x, coords2.x);
                const endX = Math.max(coords1.x, coords2.x);
                
                // Calculate fibonacci levels manually since the model might not have access to internal data
                const priceRange = Math.abs(point2Value - point1Value);
                const isUptrend = point2Value > point1Value;
                const baseLevelPrice = isUptrend ? point2Value : point1Value;
                const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
                
                ctx.save();
                ctx.strokeStyle = options.color;
                ctx.lineWidth = options.lineWidth;
                ctx.setLineDash([]);
                
                // Draw each fibonacci level as a horizontal line
                levels.forEach((level) => {
                    const retracement = priceRange * level;
                    const levelPrice = isUptrend ? baseLevelPrice - retracement : baseLevelPrice + retracement;
                    const priceY = priceScale._internal_priceToCoordinate(levelPrice, firstValue);
                    
                    if (priceY !== null) {
                        // Draw horizontal line
                        ctx.beginPath();
                        ctx.moveTo(startX, priceY);
                        ctx.lineTo(endX, priceY);
                        ctx.stroke();
                        
                        // Draw label if enabled
                        if (options.showLabels) {
    ctx.fillStyle = options.color;
    ctx.font = '12px Arial';
    ctx.textAlign = 'left';
    const percentage = `${(level * 100).toFixed(1)}%`;
    const labelText = `${percentage} (${levelPrice.toFixed(4)})`;
    ctx.fillText(labelText, endX + 5, priceY + 4);
}
                    }
                });
                
                ctx.restore();
                
                console.log('Drew fibonacci retracement with', levels.length, 'levels from', startX, 'to', endX);
                
            } catch (error) {
                console.error('Error drawing fibonacci retracement:', error);
                //console.error('Error details:', error.stack);
            }
        });
    });
}

private _timeAndPriceToCoordinates(
    targetTime: number, 
    targetPrice: number, 
    timeScale: any, 
    priceScale: any, 
    firstValue: any
): { x: number; y: number } | null {
    
    // Check if this time is beyond our data range by comparing to base time
    const baseIndex = timeScale._internal_baseIndex();
    const baseTime = timeScale._internal_indexToTimeScalePoint(baseIndex)?.originalTime;
    
    if (baseTime !== undefined && targetTime > (baseTime as number)) {
        // This is definitely an extrapolated time - force manual calculation
        console.log('Forcing extrapolation for time beyond data:', targetTime, 'vs base:', baseTime);
        return this._forceExtrapolateCoordinate(targetTime, targetPrice, timeScale, priceScale, firstValue);
    }
    
    // Try normal coordinate conversion for times within data range
    const index = timeScale._internal_timeToIndex(targetTime, true);
    
    if (index !== null) {
        // Normal case: time exists in data
        const x = timeScale._internal_indexToCoordinate(index);
        const y = priceScale._internal_priceToCoordinate(targetPrice, firstValue);
        
        if (x !== null && y !== null) {
            console.log('Using normal coordinate conversion for time:', targetTime);
            return { x, y };
        }
    }
    
    // Fallback to extrapolation
    console.log('Falling back to extrapolation for time:', targetTime);
    return this._forceExtrapolateCoordinate(targetTime, targetPrice, timeScale, priceScale, firstValue);
}

private _forceExtrapolateCoordinate(
    targetTime: number, 
    targetPrice: number, 
    timeScale: any, 
    priceScale: any, 
    firstValue: any
): { x: number; y: number } | null {
    
    // Get reference points from actual data
    const baseIndex = timeScale._internal_baseIndex();
    const prevIndex = baseIndex - 1;
    
    const baseTime = timeScale._internal_indexToTimeScalePoint(baseIndex)?.originalTime;
    const baseCoord = timeScale._internal_indexToCoordinate(baseIndex);
    const prevTime = timeScale._internal_indexToTimeScalePoint(prevIndex)?.originalTime;
    const prevCoord = timeScale._internal_indexToCoordinate(prevIndex);
    
    if (baseTime !== undefined && baseCoord !== null && 
        prevTime !== undefined && prevCoord !== null) {
        
        // Calculate time to coordinate conversion using the same logic as chart-widget
        const timeInterval = (baseTime as number) - (prevTime as number);
        const coordInterval = baseCoord - prevCoord;
        
        if (coordInterval !== 0) {
            const timePerPixel = timeInterval / coordInterval;
            const timeBeyondBase = targetTime - (baseTime as number);
            const pixelsBeyondBase = timeBeyondBase / timePerPixel;
            const x = baseCoord + pixelsBeyondBase;
            
            // Price coordinate should always work
            const y = priceScale._internal_priceToCoordinate(targetPrice, firstValue);
            
            if (y !== null) {
                console.log('Extrapolated coordinates successfully:', {
                    targetTime,
                    baseTime,
                    baseCoord,
                    timeInterval,
                    coordInterval,
                    timePerPixel,
                    timeBeyondBase,
                    pixelsBeyondBase,
                    x,
                    y
                });
                
                return { x, y };
            }
        }
    }
    
    console.log('Could not extrapolate coordinates');
    return null;
}

}
