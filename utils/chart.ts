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

/**
 * Line colour for a temperature: one solid colour per band, no blending
 * (Chris preferred the original banded look).
 */
export function getTemperatureColor(temp: number): string {
	if (temp <= 0) return "#0096FF"; // blue: freezing
	if (temp <= 10) return "#AAFF00"; // yellow-green: cold
	if (temp <= 20) return "#FFA500"; // orange: mild
	return "#E74C3C"; // red: hot
}
