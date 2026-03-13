/**
 * Capitalize the first character of a string
 */
export function capitalize(s: string): string {
	return String(s[0]).toUpperCase() + String(s).slice(1);
}

/**
 * Generate smooth curve points using Catmull-Rom spline interpolation
 * @param points Array of [x, y] coordinate pairs
 * @param tension Tension parameter (default 0.3)
 * @returns Array of interpolated curve points
 */
export function getCurvePoints(
	points: Array<[number, number]>,
): Array<[number, number]> {
	const res: Array<[number, number]> = [];

	for (let i = 0; i < points.length - 1; i++) {
		const p0 = i > 0 ? points[i - 1] : points[i];
		const p1 = points[i];
		const p2 = points[i + 1];
		const p3 = i < points.length - 2 ? points[i + 2] : p2;

		for (let t = 0; t <= 1; t += 0.01) {
			const t2 = t * t;
			const t3 = t2 * t;

			const x =
				0.5 *
				(2 * p1[0] +
					(-p0[0] + p2[0]) * t +
					(2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
					(-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);

			const y =
				0.5 *
				(2 * p1[1] +
					(-p0[1] + p2[1]) * t +
					(2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
					(-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);

			res.push([x, y]);
		}
	}
	return res;
}

/**
 * Get color based on temperature value
 * @param temp Temperature in Celsius
 * @returns Hex color string
 */
export function getTemperatureColor(temp: number): string {
	if (temp <= 0) return "#0096FF"; // Blue for freezing
	if (temp <= 10) return "#AAFF00"; // Yellow-green for cold
	if (temp <= 20) return "#FFA500"; // Orange for mild
	return "#e74c3c"; // Red for hot
}
