// Define Time type locally to avoid import issues
export type Time = string | number;

export interface TrendlinePoint {
    time: Time;
    value: number;
}

export interface TrendlineData {
    id: string;
    point1: TrendlinePoint;
    point2: TrendlinePoint;
}

export interface TrendlineOptions {
    color: string;
    lineWidth: number;
    lineStyle: 'solid' | 'dashed' | 'dotted';
    extend: 'left' | 'right' | 'both' | 'none';
    visible: boolean;
}

export const defaultTrendlineOptions: TrendlineOptions = {
    color: '#2196F3',
    lineWidth: 1,
    lineStyle: 'solid',
    extend: 'none',
    visible: true,
};