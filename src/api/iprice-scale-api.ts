import { DeepPartial } from '../helpers/strict-type-checks';

import { PriceScaleOptions } from '../model/price-scale';
import { IRange } from '../model/time-data';
import { Coordinate } from '../model/coordinate';

/** Interface to control chart's price scale */
export interface IPriceScaleApi {

	/**
 * Converts a coordinate (pixel position) to a price value
 * @param coordinate - The pixel coordinate on the price scale
 * @returns The price value at that coordinate
 */
coordinateToPrice(coordinate: Coordinate): number;

/**
 * Converts a price value to a coordinate (pixel position)
 * @param price - The price value
 * @returns The pixel coordinate on the price scale
 */
priceToCoordinate(price: number): Coordinate;
	/**
	 * Applies new options to the price scale
	 *
	 * @param options - Any subset of options.
	 */
	applyOptions(options: DeepPartial<PriceScaleOptions>): void;

	/**
	 * Returns currently applied options of the price scale
	 *
	 * @returns Full set of currently applied options, including defaults
	 */
	options(): Readonly<PriceScaleOptions>;

	/**
	 * Returns a width of the price scale if it's visible or 0 if invisible.
	 */
	width(): number;

	/**
	 * Sets the visible range of the price scale.
	 *
	 * @param range - The visible range to set, with `from` and `to` properties.
	 */
	setVisibleRange(range: IRange<number>): void;

	/**
	 * Returns the visible range of the price scale.
	 *
	 * @returns The visible range of the price scale, or null if the range is not set.
	 */
	getVisibleRange(): IRange<number> | null;

	/**
	 * Sets the auto scale mode of the price scale.
	 *
	 * @param on - If true, enables auto scaling; if false, disables it.
	 */
	setAutoScale(on: boolean): void;
}
