import { TrendlineData, TrendlineOptions, defaultTrendlineOptions } from './trendline-data';

// Simple merge function since the helper might not exist in all versions
function merge<T>(target: T, source: Partial<T>): T {
    return { ...target, ...source };
}

// DeepPartial type definition in case it's not available
type DeepPartial<T> = {
    [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export class Trendline {
    private _data: TrendlineData;
    private _options: TrendlineOptions;

    public constructor(data: TrendlineData, options?: DeepPartial<TrendlineOptions>) {
        this._data = data;
        this._options = merge(defaultTrendlineOptions, options || {}) as TrendlineOptions;
    }

    public id(): string {
        return this._data.id;
    }

    public data(): TrendlineData {
        return this._data;
    }

    public options(): TrendlineOptions {
        return this._options;
    }

    public updateOptions(options: DeepPartial<TrendlineOptions>): void {
        this._options = merge(this._options, options);
    }

    public updateData(data: Partial<TrendlineData>): void {
        this._data = { ...this._data, ...data };
    }

    public calculateExtendedPoints(
    timeScale: any,
    priceScale: any,
    visibleRange: { from: number; to: number }
): { x1: number; y1: number; x2: number; y2: number } | null {
    // Convert time to coordinate using the correct method name
    const coord1 = timeScale.indexToCoordinate(timeScale.timeToIndex(this._data.point1.time, true));
    const coord2 = timeScale.indexToCoordinate(timeScale.timeToIndex(this._data.point2.time, true));

    if (coord1 === null || coord2 === null) {
        return null;
    }

    // Convert price to coordinate using the price scale
    const firstValue = priceScale.firstValue();
    if (firstValue === null) {
        return null;
    }

    const priceCoord1 = priceScale.priceToCoordinate(this._data.point1.value, firstValue);
    const priceCoord2 = priceScale.priceToCoordinate(this._data.point2.value, firstValue);

    if (priceCoord1 === null || priceCoord2 === null) {
        return null;
    }

    return {
        x1: coord1,
        y1: priceCoord1,
        x2: coord2,
        y2: priceCoord2
    };
}

}