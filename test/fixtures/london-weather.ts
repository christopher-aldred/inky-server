import type { DetailedWeather } from "../../utils/weather.types";

const HOUR = 3600;
const at = (iso: string) => Date.parse(iso) / 1000;

/**
 * A plausible London November forecast: cold clear night dipping below zero,
 * rain in the evening, sunrise 07:38 / sunset 15:57 (GMT, so UTC = local).
 */
export function londonWeather(
	nowIso = "2026-11-23T18:40:00Z",
): DetailedWeather {
	const midnight = at("2026-11-23T00:00:00Z");
	const temps = [
		5, 5, 4, 4, 4, 3, 3, 3, 4, 6, 8, 9, 10, 10, 9, 9, 8, 7, 6, 6, 5, 4, 3, 2, 1,
		0, 0, -1, -1, -1, -1, 0, 2, 5, 8, 10, 12, 13, 13, 12, 11, 10, 9, 8, 8, 7, 7,
		6,
	];
	const rain = [
		0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 5, 5, 10, 10, 20, 30, 40, 60, 80, 90, 80,
		60, 30, 20, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 20, 20, 20, 10,
		10, 5, 5, 5,
	];
	const hourly = temps.map((temp, i) => ({
		dt: midnight + i * HOUR,
		temp,
		weatherMain: rain[i] >= 50 ? "rain" : i % 7 === 0 ? "clouds" : "clear",
		precipitation: rain[i] >= 50 ? 0.4 : 0,
		precipitationProbability: rain[i],
		// Damp at night and in the rain, drier in the afternoon
		humidity: Math.min(98, 92 - 18 * Math.max(0, Math.sin(((i % 24) - 9) / 7 * Math.PI)) + rain[i] / 10),
	}));
	const day = (d: string, uvMax = 1) => ({
		sunrise: at(`${d}T07:38:00Z`),
		sunset: at(`${d}T15:57:00Z`),
		uvMax,
	});
	return {
		current: {
			time: at(nowIso),
			temp: 6,
			feelsLike: 3,
			humidity: 81,
			windSpeed: 14,
			windGust: 63,
			windDirection: 225,
			weatherMain: "clear",
			description: "Clear sky",
		},
		hourly,
		days: [day("2026-11-23"), day("2026-11-24"), day("2026-11-25")],
		precipitation: 1.2,
		timezone: "Europe/London",
	};
}
