import { IDestroyable } from '../helpers/idestroyable';

export interface ToolbarCallbacks {
    onTrendlineToolToggle: (active: boolean) => void;
    onFibonacciToolToggle: (active: boolean) => void;
}

export class ToolbarWidget implements IDestroyable {
    private _element: HTMLDivElement;
    private _callbacks: ToolbarCallbacks;
    private _trendlineButton: HTMLButtonElement | null = null;
    private _fibonacciButton: HTMLButtonElement | null = null;
    private _isTrendlineActive: boolean = false;
    private _isFibonacciActive: boolean = false;

    public constructor(callbacks: ToolbarCallbacks) {
        this._callbacks = callbacks;
        this._element = document.createElement('div');
        this._element.classList.add('tv-lightweight-charts-toolbar');
        
        // Toolbar styling
        this._element.style.position = 'absolute';
        this._element.style.top = '8px';
        this._element.style.left = '8px';
        this._element.style.zIndex = '10';
        this._element.style.backgroundColor = '#131722';
        this._element.style.borderRadius = '4px';
        this._element.style.padding = '4px';
        this._element.style.display = 'flex';
        this._element.style.gap = '4px';
        this._element.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.3)';

        this._createTrendlineButton();
        this._createFibonacciButton();
    }

    public getElement(): HTMLDivElement {
        return this._element;
    }

    public destroy(): void {
        if (this._element.parentElement !== null) {
            this._element.parentElement.removeChild(this._element);
        }
    }

    public deactivateTrendlineTool(): void {
        this._isTrendlineActive = false;
        this._updateTrendlineButtonState();
    }

    public deactivateFibonacciTool(): void {
        this._isFibonacciActive = false;
        this._updateFibonacciButtonState();
    }

    private _createTrendlineButton(): void {
        const button = document.createElement('button');
        this._trendlineButton = button;
        
        button.style.width = '32px';
        button.style.height = '32px';
        button.style.border = 'none';
        button.style.backgroundColor = 'transparent';
        button.style.borderRadius = '4px';
        button.style.cursor = 'pointer';
        button.style.display = 'flex';
        button.style.alignItems = 'center';
        button.style.justifyContent = 'center';
        button.style.color = '#B2B5BE';
        button.title = 'Trendline';

        // Simple trendline icon (diagonal line)
        button.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <line x1="2" y1="14" x2="14" y2="2" stroke="currentColor" stroke-width="2"/>
            </svg>
        `;

        // Click handler
        button.addEventListener('click', () => {
            // Deactivate fibonacci tool if active
            if (this._isFibonacciActive) {
                this._isFibonacciActive = false;
                this._updateFibonacciButtonState();
                this._callbacks.onFibonacciToolToggle(false);
            }
            
            this._isTrendlineActive = !this._isTrendlineActive;
            this._updateTrendlineButtonState();
            this._callbacks.onTrendlineToolToggle(this._isTrendlineActive);
        });

        // Hover effect
        button.addEventListener('mouseenter', () => {
            if (!this._isTrendlineActive) {
                button.style.backgroundColor = '#2A2E39';
            }
        });
        
        button.addEventListener('mouseleave', () => {
            this._updateTrendlineButtonState();
        });

        this._element.appendChild(button);
    }

    private _createFibonacciButton(): void {
        const button = document.createElement('button');
        this._fibonacciButton = button;
        
        button.style.width = '32px';
        button.style.height = '32px';
        button.style.border = 'none';
        button.style.backgroundColor = 'transparent';
        button.style.borderRadius = '4px';
        button.style.cursor = 'pointer';
        button.style.display = 'flex';
        button.style.alignItems = 'center';
        button.style.justifyContent = 'center';
        button.style.color = '#B2B5BE';
        button.title = 'Fibonacci Retracement';

        // Fibonacci icon (horizontal lines with golden ratio symbol)
        button.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <line x1="2" y1="3" x2="14" y2="3" stroke="currentColor" stroke-width="1"/>
                <line x1="2" y1="6" x2="14" y2="6" stroke="currentColor" stroke-width="1"/>
                <line x1="2" y1="9" x2="14" y2="9" stroke="currentColor" stroke-width="1"/>
                <line x1="2" y1="13" x2="14" y2="13" stroke="currentColor" stroke-width="1"/>
                <text x="8" y="8" font-size="6" text-anchor="middle" fill="currentColor">φ</text>
            </svg>
        `;

        // Click handler
        button.addEventListener('click', () => {
            // Deactivate trendline tool if active
            if (this._isTrendlineActive) {
                this._isTrendlineActive = false;
                this._updateTrendlineButtonState();
                this._callbacks.onTrendlineToolToggle(false);
            }
            
            this._isFibonacciActive = !this._isFibonacciActive;
            this._updateFibonacciButtonState();
            this._callbacks.onFibonacciToolToggle(this._isFibonacciActive);
        });

        // Hover effect
        button.addEventListener('mouseenter', () => {
            if (!this._isFibonacciActive) {
                button.style.backgroundColor = '#2A2E39';
            }
        });
        
        button.addEventListener('mouseleave', () => {
            this._updateFibonacciButtonState();
        });

        this._element.appendChild(button);
    }

    private _updateTrendlineButtonState(): void {
        if (!this._trendlineButton) return;
        
        if (this._isTrendlineActive) {
            this._trendlineButton.style.backgroundColor = '#2962FF';
            this._trendlineButton.style.color = '#FFFFFF';
        } else {
            this._trendlineButton.style.backgroundColor = 'transparent';
            this._trendlineButton.style.color = '#B2B5BE';
        }
    }

    private _updateFibonacciButtonState(): void {
        if (!this._fibonacciButton) return;
        
        if (this._isFibonacciActive) {
            this._fibonacciButton.style.backgroundColor = '#2962FF';
            this._fibonacciButton.style.color = '#FFFFFF';
        } else {
            this._fibonacciButton.style.backgroundColor = 'transparent';
            this._fibonacciButton.style.color = '#B2B5BE';
        }
    }
}