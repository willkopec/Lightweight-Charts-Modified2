// src/indicators/indicator-manager.ts

import { RSIIndicator, PriceData } from './rsi';
import { Series } from '../model/series';
import { SeriesType } from '../model/series-options';
import { Pane } from '../model/pane';

export interface IndicatorPane {
    id: string;
    type: 'RSI' | 'MACD' | 'STOCH'; // Add more as needed
    pane: Pane;
    indicator: RSIIndicator; // Will need to make this generic later
    series: Series<'Line'>; // RSI uses line series
    height: number;
}

export interface IndicatorManagerCallbacks {
    onIndicatorAdded: (indicatorPane: IndicatorPane) => void;
    onIndicatorRemoved: (indicatorId: string) => void;
    onIndicatorUpdated: (indicatorId: string) => void;
}

export class IndicatorManager {
    private _indicators: Map<string, IndicatorPane> = new Map();
    private _callbacks: IndicatorManagerCallbacks;
    private _nextId: number = 1;

    public constructor(callbacks: IndicatorManagerCallbacks) {
        this._callbacks = callbacks;
    }

    public addRSI(
        mainSeriesData: readonly PriceData[], 
        createPaneCallback: () => Pane,
        createSeriesCallback: (pane: Pane, type: 'Line') => Series<'Line'>
    ): string {
        const id = `RSI_${this._nextId++}`;
        
        console.log('Creating RSI with data points:', mainSeriesData.length);
        
        // Create RSI indicator
        const rsi = new RSIIndicator();
        
        // Calculate initial RSI values
        const rsiData = rsi.calculate(mainSeriesData);
        console.log('RSI calculated, data points:', rsiData.length);
        
        // Create new pane for the indicator
        const pane = createPaneCallback();
        
        // Create line series for RSI
        const series = createSeriesCallback(pane, 'Line');
        
        // Configure series for RSI
        series.applyOptions({
            color: rsi.options().color,
            priceFormat: {
                type: 'custom',
                formatter: (price: number) => rsi.formatValue(price),
                minMove: 0.01,
            },
            title: 'RSI(14)',
            visible: rsi.options().visible,
            priceScaleId: 'rsi',
        });

        // Convert RSI data to series format - match the exact internal structure
        const seriesData = rsiData.map((point, index) => {
            return {
                _internal_index: index,
                _internal_time: point.time,
                _internal_value: [point.value, point.value, point.value, point.value], // OHLC with same RSI value
                _internal_originalTime: point.time,
            };
        });
        
        // Debug: Let's see what we're creating now
        console.log('RSI series data sample (new structure):', seriesData.slice(0, 2));
        console.log('RSI data structure check (new):', {
            length: seriesData.length,
            firstItem: seriesData[0],
            valueStructure: seriesData[0]?._internal_value,
            valueType: typeof seriesData[0]?._internal_value,
            valueLength: Array.isArray(seriesData[0]?._internal_value) ? seriesData[0]._internal_value.length : 'not array'
        });
        
        console.log('Setting RSI series data:', seriesData.length, 'points');
        
        if (seriesData.length > 0) {
            (series.setData as any)(seriesData, {
                lastBarUpdatedOrNewBarsAddedToTheRight: true,
                historicalUpdate: false
            });
            
            // Debug: Check if the data was actually set
            console.log('After setting data, checking series state:');
            const bars = (series as any).bars ? (series as any).bars() : null;
            if (bars) {
                console.log('Series bars exist:', bars.isEmpty ? !bars.isEmpty() : 'unknown');
                console.log('Series data count:', bars.indices ? bars.indices().length : 'unknown');
                if (bars.indices && bars.indices().length > 0) {
                    const firstBar = bars.valueAt(bars.indices()[0]);
                    console.log('First bar in series after setting:', firstBar);
                }
            } else {
                console.log('No bars found in series after setting data');
            }
        }

        // Create indicator pane object
        const indicatorPane: IndicatorPane = {
            id,
            type: 'RSI',
            pane,
            indicator: rsi,
            series,
            height: 100, // Default height for RSI pane
        };

        // Store the indicator
        this._indicators.set(id, indicatorPane);

        // Notify callback
        this._callbacks.onIndicatorAdded(indicatorPane);

        return id;
    }

    public removeIndicator(id: string): boolean {
        const indicatorPane = this._indicators.get(id);
        if (!indicatorPane) {
            return false;
        }

        // Clean up the indicator
        this._indicators.delete(id);

        // Notify callback
        this._callbacks.onIndicatorRemoved(id);

        return true;
    }

    public updateIndicator(id: string, newData: readonly PriceData[]): void {
        const indicatorPane = this._indicators.get(id);
        if (!indicatorPane) {
            return;
        }

        if (indicatorPane.type === 'RSI') {
            // Recalculate RSI
            const rsiData = indicatorPane.indicator.calculate(newData);
            
            // Convert RSI data to series format - need proper plot row structure
            const seriesData = rsiData.map((point, index) => {
                return {
                    index: index as any, // TimePointIndex
                    time: point.time as any, // TimeScalePoint
                    value: [point.value], // Line series expects array with single value [close]
                    originalTime: point.time,
                };
            });
            
            if (seriesData.length > 0) {
                (indicatorPane.series.setData as any)(seriesData, {
                    lastBarUpdatedOrNewBarsAddedToTheRight: true,
                    historicalUpdate: false
                });
            }

            // Notify callback
            this._callbacks.onIndicatorUpdated(id);
        }
    }

    public getIndicator(id: string): IndicatorPane | undefined {
        return this._indicators.get(id);
    }

    public getAllIndicators(): IndicatorPane[] {
        return Array.from(this._indicators.values());
    }

    public getIndicatorsByType(type: 'RSI' | 'MACD' | 'STOCH'): IndicatorPane[] {
        return Array.from(this._indicators.values()).filter(indicator => indicator.type === type);
    }

    public hasIndicators(): boolean {
        return this._indicators.size > 0;
    }

    public clear(): void {
        this._indicators.clear();
    }

    // Helper method to convert series data to price data format - IMPROVED VERSION
    public static seriesToPriceData(series: Series<SeriesType>): PriceData[] {
        console.log('Converting series to price data...');
        
        try {
            // Get the series bars data
            const bars = series.bars();
            const indices = bars.indices();
            
            console.log('Found', indices.length, 'data points in series');
            
            // Debug: Let's see what the actual data structure looks like
            if (indices.length > 0) {
                const firstBar = bars.valueAt(indices[0]);
                console.log('First bar structure:', firstBar);
                if (firstBar && firstBar.value) {
                    console.log('First bar value structure:', firstBar.value);
                    console.log('First bar value type:', typeof firstBar.value);
                    console.log('First bar value length:', Array.isArray(firstBar.value) ? firstBar.value.length : 'not array');
                }
            }
            
            const priceData: PriceData[] = [];
            
            for (const index of indices) {
                const bar = bars.valueAt(index);
                if (bar) {
                    // Extract time - handle different time formats
                    let timestamp: number;
                    const timePoint = bar.time;
                    
                    if (typeof timePoint === 'number') {
                        timestamp = timePoint;
                    } else if (typeof timePoint === 'string') {
                        // Parse string time to timestamp
                        const date = new Date(timePoint);
                        timestamp = date.getTime() / 1000; // Convert to seconds
                    } else if (timePoint && typeof timePoint === 'object') {
                        // Handle business day format like { year: 2023, month: 12, day: 15 }
                        if ('year' in timePoint && 'month' in timePoint && 'day' in timePoint) {
                            const businessDay = timePoint as any;
                            const date = new Date(businessDay.year, businessDay.month - 1, businessDay.day);
                            timestamp = date.getTime() / 1000;
                        } else {
                            timestamp = Date.now() / 1000;
                        }
                    } else {
                        timestamp = Date.now() / 1000;
                    }
                    
                    // Extract close price - handle different series types
                    let closePrice: number;
                    const values = bar.value;
                    
                    if (Array.isArray(values)) {
                        // For OHLC data, close is typically the last value
                        if (values.length >= 4) {
                            closePrice = values[3]; // Close price
                        } else if (values.length > 0) {
                            closePrice = values[0]; // Single value (like Line series)
                        } else {
                            closePrice = 0; // Default fallback
                        }
                    } else {
                        // Single value
                        closePrice = values as number;
                    }
                    
                    if (typeof closePrice === 'number' && !isNaN(closePrice)) {
                        priceData.push({
                            time: timestamp,
                            close: closePrice
                        });
                    }
                }
            }
            
            // Sort by time to ensure proper order
            priceData.sort((a, b) => a.time - b.time);
            
            console.log('Converted to', priceData.length, 'price data points');
            console.log('Sample data:', priceData.slice(0, 3));
            
            return priceData;
            
        } catch (error) {
            console.error('Error converting series to price data:', error);
            return [];
        }
    }
}