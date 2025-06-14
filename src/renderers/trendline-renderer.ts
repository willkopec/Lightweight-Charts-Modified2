import { MediaCoordinatesRenderingScope } from 'fancy-canvas';

export interface TrendlineRendererData {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color: string;
    lineWidth: number;
    lineStyle: 'solid' | 'dashed' | 'dotted';
    visible: boolean;
}

export class TrendlineRenderer {
    public draw(renderingScope: MediaCoordinatesRenderingScope, data: TrendlineRendererData): void {
        if (!data.visible) {
            return;
        }

        const ctx = renderingScope.context;
        
        ctx.save();
        
        ctx.strokeStyle = data.color;
        ctx.lineWidth = data.lineWidth;
        
        // Set line style
        switch (data.lineStyle) {
            case 'dashed':
                ctx.setLineDash([5, 5]);
                break;
            case 'dotted':
                ctx.setLineDash([2, 2]);
                break;
            default:
                ctx.setLineDash([]);
        }

        ctx.beginPath();
        ctx.moveTo(data.x1, data.y1);
        ctx.lineTo(data.x2, data.y2);
        ctx.stroke();
        
        ctx.restore();
    }
}