import { IChartWidgetBase } from '../gui/chart-widget';

import { ensureNotNull } from '../helpers/assertions';
import { DeepPartial } from '../helpers/strict-type-checks';

import { isDefaultPriceScale } from '../model/default-price-scale';
import { PriceRangeImpl } from '../model/price-range-impl';
import { PriceScale, PriceScaleOptions } from '../model/price-scale';
import { IRange } from '../model/time-data';

import { IPriceScaleApi } from './iprice-scale-api';

export class PriceScaleApi implements IPriceScaleApi {
	private _chartWidget: IChartWidgetBase;
	private readonly _priceScaleId: string;
	private readonly _paneIndex: number;

	public constructor(chartWidget: IChartWidgetBase, priceScaleId: string, paneIndex?: number) {
		this._chartWidget = chartWidget;
		this._priceScaleId = priceScaleId;
		this._paneIndex = paneIndex ?? 0;
	}

	public applyOptions(options: DeepPartial<PriceScaleOptions>): void {
		this._chartWidget.model().applyPriceScaleOptions(this._priceScaleId, options, this._paneIndex);
	}

	public options(): Readonly<PriceScaleOptions> {
		return this._priceScale().options();
	}

	public width(): number {
		if (!isDefaultPriceScale(this._priceScaleId)) {
			return 0;
		}

		return this._chartWidget.getPriceAxisWidth(this._priceScaleId);
	}

	public setVisibleRange(range: IRange<number>): void {
		this.setAutoScale(false);
		this._priceScale().setCustomPriceRange(new PriceRangeImpl(range.from, range.to));
	}

	public getVisibleRange(): IRange<number> | null {
		const range = this._priceScale().priceRange();
		return range === null ? null : {
			from: range.minValue(),
			to: range.maxValue(),
		};
	}

	public setAutoScale(on: boolean): void {
		this.applyOptions({ autoScale: on });
	}

	private _priceScale(): PriceScale {
		return ensureNotNull(this._chartWidget.model().findPriceScale(this._priceScaleId, this._paneIndex)).priceScale;
	}
}
