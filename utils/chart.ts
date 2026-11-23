/**
 * Smooth a polyline with a Catmull-Rom spline. Each point is a tuple whose
 * first two entries are x and y; any further entries (e.g. temperature) are
 * interpolated along with them, so values follow the curve exactly.
 */
export function getCurvePoints<P extends number[]>(
	points: ReadonlyArray<P>,
	samplesPerSegment = 100,
): P[] {
	const res: P[] = [];
	for (let i = 0; i < points.length - 1; i++) {
		const p0 = points[Math.max(0, i - 1)];
		const p1 = points[i];
		const p2 = points[i + 1];
		const p3 = points[Math.min(points.length - 1, i + 2)];

		for (let s = 0; s <= samplesPerSegment; s++) {
			const t = s / samplesPerSegment;
			const t2 = t * t;
			const t3 = t2 * t;
			res.push(
				p1.map(
					(_, k) =>
						0.5 *
						(2 * p1[k] +
							(-p0[k] + p2[k]) * t +
							(2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 +
							(-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3),
				) as P,
			);
		}
	}
	return res;
}

/** Temperature colour stops (°C → RGB). Colours blend linearly between them. */
const TEMPERATURE_STOPS: ReadonlyArray<[number, [number, number, number]]> = [
	[-2, [0x00, 0x96, 0xff]], // blue: freezing
	[5, [0xaa, 0xff, 0x00]], // yellow-green: cold
	[15, [0xff, 0xa5, 0x00]], // orange: mild
	[24, [0xe7, 0x4c, 0x3c]], // red: hot
];

/** Line colour for a temperature, blended smoothly between the stops. */
export function getTemperatureColor(temp: number): string {
	const stops = TEMPERATURE_STOPS;
	const rgb = (c: readonly number[]) => `rgb(${c.join(",")})`;
	if (temp <= stops[0][0]) return rgb(stops[0][1]);
	for (let i = 0; i < stops.length - 1; i++) {
		const [from, fromColor] = stops[i];
		const [to, toColor] = stops[i + 1];
		if (temp <= to) {
			const f = (temp - from) / (to - from);
			return rgb(fromColor.map((v, k) => Math.round(v + (toColor[k] - v) * f)));
		}
	}
	return rgb(stops[stops.length - 1][1]);
}
