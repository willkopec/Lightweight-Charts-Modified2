export interface FibonacciPoint {
    time: number;
    value: number;
}

export interface FibonacciData {
    id: string;
    point1: FibonacciPoint;
    point2: FibonacciPoint;
}

export interface FibonacciOptions {
    color: string;
    lineWidth: number;
    lineStyle: 'solid' | 'dashed' | 'dotted';
    showLabels: boolean;
    extendLines: boolean;
    levels: number[]; // Fibonacci levels (0, 0.236, 0.382, 0.5, 0.618, 0.786, 1)
}

export const defaultFibonacciOptions: FibonacciOptions = {
    color: '#2196F3',
    lineWidth: 1,
    lineStyle: 'solid',
    showLabels: true,
    extendLines: false,
    levels: [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0]
};

export class FibonacciRetracement {
    private _data: FibonacciData;
    private _options: FibonacciOptions;

    public constructor(data: FibonacciData, options?: Partial<FibonacciOptions>) {
        this._data = data;
        this._options = { ...defaultFibonacciOptions, ...options };
    }

    public data(): FibonacciData {
        return this._data;
    }

    public options(): FibonacciOptions {
        return this._options;
    }

    public setData(data: FibonacciData): void {
        this._data = data;
    }

    public applyOptions(options: Partial<FibonacciOptions>): void {
        this._options = { ...this._options, ...options };
    }

    public updatePoints(point1?: FibonacciPoint, point2?: FibonacciPoint): void {
        if (point1) {
            this._data.point1 = point1;
        }
        if (point2) {
            this._data.point2 = point2;
        }
    }

    // Calculate the price levels based on the two points
    public calculateLevels(): Array<{ level: number; price: number; percentage: string }> {
        const { point1, point2 } = this._data;
        const priceRange = Math.abs(point2.value - point1.value);
        const isUptrend = point2.value > point1.value;
        const baseLevelPrice = isUptrend ? point2.value : point1.value;
        
        return this._options.levels.map(level => {
            const retracement = priceRange * level;
            const price = isUptrend ? baseLevelPrice - retracement : baseLevelPrice + retracement;
            const percentage = `${(level * 100).toFixed(1)}%`;
            
            return {
                level,
                price,
                percentage
            };
        });
    }

    // Get the time range for the fibonacci retracement
    public getTimeRange(): { startTime: number; endTime: number } {
        const { point1, point2 } = this._data;
        return {
            startTime: Math.min(point1.time, point2.time),
            endTime: Math.max(point1.time, point2.time)
        };
    }

    // Check if a given time is within the fibonacci range (for drawing)
    public isTimeInRange(time: number): boolean {
        const { startTime, endTime } = this.getTimeRange();
        return this._options.extendLines || (time >= startTime && time <= endTime);
    }
}