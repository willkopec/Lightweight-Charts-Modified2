export interface RSIData {
    time: number;
    value: number;
}

export interface RSIOptions {
    period: number;
    overboughtLevel: number;
    oversoldLevel: number;
    color: string;
    lineWidth: number;
    visible: boolean;
}

export const defaultRSIOptions: RSIOptions = {
    period: 14,
    overboughtLevel: 70,
    oversoldLevel: 30,
    color: '#FF6B35',
    lineWidth: 1,
    visible: true,
};

export interface PriceData {
    time: number;
    close: number;
}

export class RSIIndicator {
    private _options: RSIOptions;
    private _data: RSIData[] = [];

    public constructor(options?: Partial<RSIOptions>) {
        this._options = { ...defaultRSIOptions, ...options };
    }

    public options(): RSIOptions {
        return this._options;
    }

    public updateOptions(options: Partial<RSIOptions>): void {
        this._options = { ...this._options, ...options };
    }

    public data(): readonly RSIData[] {
        return this._data;
    }

    public calculate(priceData: readonly PriceData[]): RSIData[] {
        if (priceData.length < this._options.period + 1) {
            this._data = [];
            return this._data;
        }

        const rsiValues: RSIData[] = [];
        const period = this._options.period;

        // Calculate price changes
        const priceChanges: number[] = [];
        for (let i = 1; i < priceData.length; i++) {
            priceChanges.push(priceData[i].close - priceData[i - 1].close);
        }

        // Calculate initial averages for the first RSI value
        let avgGain = 0;
        let avgLoss = 0;

        for (let i = 0; i < period; i++) {
            const change = priceChanges[i];
            if (change > 0) {
                avgGain += change;
            } else {
                avgLoss += Math.abs(change);
            }
        }

        avgGain /= period;
        avgLoss /= period;

        // Calculate first RSI value
        let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        let rsi = 100 - (100 / (1 + rs));

        rsiValues.push({
            time: priceData[period].time,
            value: rsi
        });

        // Calculate subsequent RSI values using smoothed averages
        for (let i = period; i < priceChanges.length; i++) {
            const change = priceChanges[i];
            
            if (change > 0) {
                avgGain = ((avgGain * (period - 1)) + change) / period;
                avgLoss = (avgLoss * (period - 1)) / period;
            } else {
                avgGain = (avgGain * (period - 1)) / period;
                avgLoss = ((avgLoss * (period - 1)) + Math.abs(change)) / period;
            }

            rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
            rsi = 100 - (100 / (1 + rs));

            rsiValues.push({
                time: priceData[i + 1].time,
                value: rsi
            });
        }

        this._data = rsiValues;
        return rsiValues;
    }

    public getLastValue(): number | null {
        if (this._data.length === 0) {
            return null;
        }
        return this._data[this._data.length - 1].value;
    }

    public addDataPoint(priceData: readonly PriceData[]): void {
        // Recalculate the entire RSI when new data is added
        // In a more optimized version, we could update incrementally
        this.calculate(priceData);
    }

    public clear(): void {
        this._data = [];
    }

    // Helper method to get overbought/oversold levels for rendering
    public getLevels(): { overbought: number; oversold: number } {
        return {
            overbought: this._options.overboughtLevel,
            oversold: this._options.oversoldLevel
        };
    }

    // Format RSI value for display
    public formatValue(value: number): string {
        return value.toFixed(2);
    }
}