import { BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import { BitmapCoordinatesPaneRenderer } from './bitmap-coordinates-pane-renderer';
import { drawHorizontalLine, drawVerticalLine, LineStyle, LineWidth, setLineStyle } from './draw-line';

export interface CrosshairLineStyle {
	lineStyle: LineStyle;
	lineWidth: LineWidth;
	color: string;
	visible: boolean;
}

export interface CrosshairRendererData {
	vertLine: CrosshairLineStyle;
	horzLine: CrosshairLineStyle;
	x: number;
	y: number;
	showCenterDot?: boolean;
	centerDotColor?: string;
	centerDotRadius?: number;
}

export class CrosshairRenderer extends BitmapCoordinatesPaneRenderer {
	private readonly _data: CrosshairRendererData | null;

	public constructor(data: CrosshairRendererData | null) {
		super();
		this._data = data;
	}

	protected override _drawImpl({ context: ctx, bitmapSize, horizontalPixelRatio, verticalPixelRatio }: BitmapCoordinatesRenderingScope): void {
		//console.log('CrosshairRenderer: Drawing with data:', this._data);
		
		if (this._data === null) {
			//console.log('CrosshairRenderer: No data provided');
			return;
		}

		const vertLinesVisible = this._data.vertLine.visible;
		const horzLinesVisible = this._data.horzLine.visible;
		const showCenterDot = this._data.showCenterDot;

		// Check if coordinates are valid (not NaN and not invalid)
		const hasValidCoordinates = !isNaN(this._data.x) && !isNaN(this._data.y) && 
			isFinite(this._data.x) && isFinite(this._data.y);
		
		//console.log('CrosshairRenderer: hasValidCoordinates =', hasValidCoordinates);
		//console.log('CrosshairRenderer: x =', this._data.x, 'y =', this._data.y);

		// In drawing mode, we ONLY show the dot, regardless of line visibility
		if (showCenterDot) {
			//console.log('CrosshairRenderer: DRAWING DOT ONLY MODE');
			
			// For drawing mode, we need to show the dot even if coordinates seem invalid
			// because we're setting them manually during trendline drawing
			if (!hasValidCoordinates) {
				//console.log('CrosshairRenderer: Invalid coordinates in dot mode, but will try to draw anyway');
				//console.log('CrosshairRenderer: x =', this._data.x, 'y =', this._data.y);
				
				// Check if we at least have some numeric values we can work with
				if (typeof this._data.x !== 'number' || typeof this._data.y !== 'number') {
					//console.log('CrosshairRenderer: Coordinates are not numbers, returning');
					return;
				}
			}

			// Calculate dot position - use the coordinates as-is in drawing mode
			const x = Math.round(this._data.x * horizontalPixelRatio);
			const y = Math.round(this._data.y * verticalPixelRatio);
			
			//console.log('CrosshairRenderer: Drawing dot at bitmap coordinates:', x, y);

			// Draw center dot
			const dotRadius = (this._data.centerDotRadius || 3) * Math.min(horizontalPixelRatio, verticalPixelRatio);
			const dotColor = this._data.centerDotColor || '#2196F3';
			
			ctx.fillStyle = dotColor;
			ctx.beginPath();
			ctx.arc(x, y, dotRadius, 0, 2 * Math.PI);
			ctx.fill();
			
			//console.log('CrosshairRenderer: Drew dot with radius', dotRadius, 'at', x, y);
			return; // Only show dot in drawing mode, no lines
		}

		// Normal crosshair mode - show lines if visible and coordinates are valid
		//console.log('CrosshairRenderer: NORMAL CROSSHAIR MODE');
		
		if (!vertLinesVisible && !horzLinesVisible) {
			//console.log('CrosshairRenderer: No lines visible, returning');
			return;
		}

		if (!hasValidCoordinates) {
			//console.log('CrosshairRenderer: Invalid coordinates for line drawing, returning');
			return;
		}

		const x = Math.round(this._data.x * horizontalPixelRatio);
		const y = Math.round(this._data.y * verticalPixelRatio);

		//console.log('CrosshairRenderer: Drawing lines at', x, y);

		ctx.lineCap = 'butt';

		if (vertLinesVisible && x >= 0) {
			//console.log('CrosshairRenderer: Drawing vertical line');
			ctx.lineWidth = Math.floor(this._data.vertLine.lineWidth * horizontalPixelRatio);
			ctx.strokeStyle = this._data.vertLine.color;
			ctx.fillStyle = this._data.vertLine.color;
			setLineStyle(ctx, this._data.vertLine.lineStyle);
			drawVerticalLine(ctx, x, 0, bitmapSize.height);
		}

		if (horzLinesVisible && y >= 0) {
			//console.log('CrosshairRenderer: Drawing horizontal line');
			ctx.lineWidth = Math.floor(this._data.horzLine.lineWidth * verticalPixelRatio);
			ctx.strokeStyle = this._data.horzLine.color;
			ctx.fillStyle = this._data.horzLine.color;
			setLineStyle(ctx, this._data.horzLine.lineStyle);
			drawHorizontalLine(ctx, y, 0, bitmapSize.width);
		}
	}
}