function generateCandle(i, target) {
	const step = (i % 20) / 5000;
	const base = i / 5;
	target.open = base * (1 - step);
	target.high = base * (1 + 2 * step);
	target.low = base * (1 - 2 * step);
	target.close = base * (1 + step);
}

function generateData() {
	const res = [];
	const time = new Date(Date.UTC(2018, 0, 1, 0, 0, 0, 0));
	for (let i = 0; i < 500; ++i) {
		const item = {
			time: time.getTime() / 1000,
		};
		time.setUTCDate(time.getUTCDate() + 1);

		generateCandle(i, item);
		res.push(item);
	}
	return res;
}

let textWatermark;

function runTestCase(container) {
	const chart = (window.chart = LightweightCharts.createChart(container, {
		layout: { attributionLogo: false },
	}));

	const mainSeries = chart.addSeries(LightweightCharts.CandlestickSeries);

	mainSeries.setData(generateData());

	textWatermark = LightweightCharts.createTextWatermark(chart.panes()[0], {
		horzAlign: 'left',
		vertAlign: 'bottom',
		lines: [
			{
				text: 'Watermark Before',
				color: 'rgba(0, 0, 0, 0.5)',
				fontSize: 12,
			},
		],
	});

	return new Promise(resolve => {
		setTimeout(() => {
			textWatermark.applyOptions({
				visible: true,
				horzAlign: 'center',
				vertAlign: 'center',
				lines: [
					{
						text: 'Watermark',
						color: 'rgba(171, 71, 188, 0.5)',
						fontSize: 24,
						fontFamily: 'Roboto',
						fontStyle: 'bold',
					},
				],
			});
			resolve();
		}, 300);
	});
}
