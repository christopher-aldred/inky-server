import path from "node:path";
import {
	type Canvas,
	createCanvas,
	type Image,
	loadImage,
} from "@napi-rs/canvas";
import axios from "axios";
import { fetchWeatherApi } from "openmeteo";
import type {
	CurrentWeather,
	DetailedWeather,
	GeocodingResult,
	HourlyEntry,
	SunDay,
	WeatherForecast,
} from "./weather.types";
import {
	DEFAULT_TIMEZONE,
	findCurrentHourIndex,
	sumOverWindow,
} from "./weather-time";

export type {
	CurrentWeather,
	DetailedWeather,
	GeocodingResult,
	HourlyEntry,
	SunDay,
	WeatherForecast,
};

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

export const BASE_ICON_TYPES = [
	"clear",
	"cloudy",
	"fog",
	"rain",
	"snow",
	"thunderstorm",
];

export const NIGHT_ICON_TYPES = [...BASE_ICON_TYPES, "moon"];

export type IconImage = Image | Canvas;
export const weatherIcons: Record<string, IconImage> = {};

/**
 * Paint enclosed transparent areas of an icon (e.g. inside the cloud outline)
 * white, so backgrounds like the night shading don't show through.
 * Transparency reachable from the image border is outside; the rest is inside.
 */
export function fillEnclosedAreas(image: Image): IconImage {
	const { width, height } = image;
	const canvas = createCanvas(width, height);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(image, 0, 0);
	const pixels = ctx.getImageData(0, 0, width, height);
	const data = pixels.data;
	const isClear = (i: number) => data[i * 4 + 3] < 128;

	const outside = new Uint8Array(width * height);
	const stack: number[] = [];
	for (let x = 0; x < width; x++) stack.push(x, (height - 1) * width + x);
	for (let y = 0; y < height; y++) stack.push(y * width, y * width + width - 1);
	while (stack.length) {
		const i = stack.pop() as number;
		if (outside[i] || !isClear(i)) continue;
		outside[i] = 1;
		const x = i % width;
		if (x > 0) stack.push(i - 1);
		if (x < width - 1) stack.push(i + 1);
		if (i >= width) stack.push(i - width);
		if (i < width * (height - 1)) stack.push(i + width);
	}

	for (let i = 0; i < width * height; i++) {
		if (!outside[i] && isClear(i)) data.fill(255, i * 4, i * 4 + 4);
	}
	ctx.putImageData(pixels, 0, 0);
	return canvas;
}

async function loadIcon(type: string): Promise<void> {
	if (weatherIcons[type]) return;
	const image = await loadImage(
		path.join(process.cwd(), "public", "icons", `${type}.png`),
	);
	weatherIcons[type] = fillEnclosedAreas(image);
}

export async function loadWeatherIcons(iconTypes = BASE_ICON_TYPES) {
	await Promise.all(iconTypes.map((type) => loadIcon(type)));
	return weatherIcons;
}

// ---------------------------------------------------------------------------
// Weather codes
// ---------------------------------------------------------------------------

const WEATHER_CODE_MAP: Record<number, { main: string; description: string }> =
	{
		0: { main: "clear", description: "Clear sky" },
		1: { main: "clouds", description: "Mainly clear" },
		2: { main: "clouds", description: "Partly cloudy" },
		3: { main: "clouds", description: "Overcast" },
		45: { main: "fog", description: "Fog" },
		48: { main: "fog", description: "Depositing rime fog" },
		51: { main: "rain", description: "Light drizzle" },
		53: { main: "rain", description: "Moderate drizzle" },
		55: { main: "rain", description: "Dense drizzle" },
		56: { main: "rain", description: "Light freezing drizzle" },
		57: { main: "rain", description: "Dense freezing drizzle" },
		61: { main: "rain", description: "Slight rain" },
		63: { main: "rain", description: "Moderate rain" },
		65: { main: "rain", description: "Heavy rain" },
		66: { main: "rain", description: "Light freezing rain" },
		67: { main: "rain", description: "Heavy freezing rain" },
		71: { main: "snow", description: "Slight snow fall" },
		73: { main: "snow", description: "Moderate snow fall" },
		75: { main: "snow", description: "Heavy snow fall" },
		77: { main: "snow", description: "Snow grains" },
		80: { main: "rain", description: "Slight rain showers" },
		81: { main: "rain", description: "Moderate rain showers" },
		82: { main: "rain", description: "Violent rain showers" },
		85: { main: "snow", description: "Slight snow showers" },
		86: { main: "snow", description: "Heavy snow showers" },
		95: { main: "thunderstorm", description: "Thunderstorm" },
		96: { main: "thunderstorm", description: "Thunderstorm with slight hail" },
		99: { main: "thunderstorm", description: "Thunderstorm with heavy hail" },
	};

export function mapWeatherCodeToMain(code?: number): string {
	if (typeof code !== "number") return "clear";
	return WEATHER_CODE_MAP[code]?.main ?? "clear";
}

export function mapWeatherCodeToDescription(code?: number): string {
	if (typeof code !== "number") return "Clear sky";
	return WEATHER_CODE_MAP[code]?.description ?? "Clear sky";
}

export function isNighttime(
	timestamp: number,
	sunrise?: number,
	sunset?: number,
): boolean {
	// Only use API sunrise/sunset values - no fallback
	if (sunrise && sunset) {
		return timestamp < sunrise || timestamp > sunset;
	}
	// If sunrise/sunset not available, default to daytime (don't show moon icon)
	return false;
}

export function getWeatherIcon(
	weatherMain: string,
	options?: {
		timestamp?: number;
		sunrise?: number;
		sunset?: number;
		includeNight?: boolean;
	},
): string {
	const main = weatherMain?.toLowerCase?.() ?? "clear";

	// Show moon icon for clear weather at night (only if we have valid sunrise/sunset from API)
	const isNight =
		options?.timestamp && options?.sunrise && options?.sunset
			? isNighttime(options.timestamp, options.sunrise, options.sunset)
			: false;

	if (options?.includeNight && main === "clear" && isNight) {
		return "moon";
	}

	switch (main) {
		case "clear":
			return "clear";
		case "clouds":
			return "cloudy";
		case "mist":
		case "fog":
			return "fog";
		case "rain":
		case "drizzle":
			return "rain";
		case "snow":
			return "snow";
		case "thunderstorm":
			return "thunderstorm";
		default:
			return "clear";
	}
}

// ---------------------------------------------------------------------------
// Open-Meteo
// ---------------------------------------------------------------------------

function normalizeCountryCode(input?: string): string | undefined {
	if (!input) return undefined;
	const code = input.trim().toUpperCase();
	switch (code) {
		case "UK":
		case "GBR":
			return "GB";
		default:
			return code;
	}
}

export async function geocodeLocation(
	location: string = "Sheffield,UK",
): Promise<GeocodingResult> {
	const [rawName, rawCountry] = location.split(",").map((s) => s.trim());
	const queryName = rawName || location;
	const normalizedCountry = normalizeCountryCode(rawCountry);

	const response = await axios.get(
		"https://geocoding-api.open-meteo.com/v1/search",
		{
			params: {
				name: queryName,
				count: 5,
				language: "en",
				format: "json",
			},
		},
	);

	// biome-ignore lint/suspicious/noExplicitAny: Im lazy
	const results: any[] = response.data?.results ?? [];

	// Prefer country match if provided
	const preferred = normalizedCountry
		? results.find(
				(r) =>
					normalizeCountryCode(r.country_code) === normalizedCountry ||
					r.country?.trim?.().toLowerCase?.() === rawCountry?.toLowerCase?.(),
			)
		: undefined;

	const result = preferred || results[0];

	if (!result) {
		throw new Error(`No coordinates found for location: ${location}`);
	}

	return {
		latitude: result.latitude,
		longitude: result.longitude,
		timezone: result.timezone,
		name: result.name,
		country: result.country,
	};
}

type ForecastResponse = Awaited<ReturnType<typeof fetchWeatherApi>>[number];
type VariablesBlock = NonNullable<ReturnType<ForecastResponse["daily"]>>;

/** Geocode `location` and fetch an Open-Meteo forecast for it. */
async function fetchForecast(
	location: string,
	params: Record<string, unknown>,
): Promise<{ response: ForecastResponse; timezone: string }> {
	const geo = await geocodeLocation(location);
	const [response] = await fetchWeatherApi(
		"https://api.open-meteo.com/v1/forecast",
		{
			latitude: geo.latitude,
			longitude: geo.longitude,
			timezone: geo.timezone || "auto",
			forecast_days: 5,
			...params,
		},
	);
	if (!response)
		throw new Error("No weather response received from Open-Meteo");
	return {
		response,
		timezone: geo.timezone || response.timezone() || DEFAULT_TIMEZONE,
	};
}

/**
 * Read Open-Meteo variables by name instead of by position. `names` must be
 * the same list, in the same order, that was requested.
 */
function reader<const N extends readonly string[]>(
	block: VariablesBlock | null | undefined,
	names: N,
) {
	const variable = (name: N[number]) => block?.variables(names.indexOf(name));
	return {
		/** A single value (the `current` block). */
		value: (name: N[number]) => Number(variable(name)?.value() ?? 0),
		/** A float series (hourly/daily). */
		series: (name: N[number]) =>
			Array.from(variable(name)?.valuesArray() ?? [], Number),
		/** An Int64 series, used for sunrise/sunset. */
		int64Series: (name: N[number]) => {
			const v = variable(name);
			return v
				? Array.from({ length: v.valuesInt64Length() }, (_, i) =>
						Number(v.valuesInt64(i)),
					)
				: [];
		},
	};
}

/** Daily forecast for the calendar screens' weather strip. */
export async function getWeatherForecast(
	location = "London,UK",
): Promise<WeatherForecast[]> {
	const DAILY = [
		"temperature_2m_max",
		"temperature_2m_min",
		"weather_code",
		"sunrise",
		"sunset",
	] as const;
	const { response } = await fetchForecast(location, { daily: DAILY });
	const daily = response.daily();
	if (!daily) return [];

	const d = reader(daily, DAILY);
	const tempMax = d.series("temperature_2m_max");
	const tempMin = d.series("temperature_2m_min");
	const codes = d.series("weather_code");
	const sunrise = d.int64Series("sunrise");
	const sunset = d.int64Series("sunset");

	const start = Number(daily.time());
	const interval = daily.interval() || 86400;
	const utcOffsetSeconds = response.utcOffsetSeconds();
	const length = Math.min(5, tempMax.length, tempMin.length, codes.length);

	return Array.from({ length }, (_, i) => ({
		date: new Date((start + i * interval + utcOffsetSeconds) * 1000),
		temp: Math.round((tempMax[i] + tempMin[i]) / 2),
		weather: mapWeatherCodeToMain(codes[i]),
		sunrise: sunrise[i],
		sunset: sunset[i],
	}));
}

/** Current conditions, 48h hourly forecast and sun times for the weather screen. */
export async function getWeatherDetails(
	location = "London,UK",
): Promise<DetailedWeather> {
	const CURRENT = [
		"temperature_2m",
		"relative_humidity_2m",
		"apparent_temperature",
		"weather_code",
		"wind_speed_10m",
		"wind_gusts_10m",
		"wind_direction_10m",
	] as const;
	const HOURLY = [
		"temperature_2m",
		"precipitation",
		"precipitation_probability",
		"weather_code",
		"relative_humidity_2m",
	] as const;
	const DAILY = ["sunrise", "sunset", "uv_index_max"] as const;

	const { response, timezone } = await fetchForecast(location, {
		current: CURRENT,
		hourly: HOURLY,
		daily: DAILY,
	});

	const c = reader(response.current(), CURRENT);
	const currentBlock = response.current();
	const weatherCode = c.value("weather_code");
	const current: CurrentWeather = {
		time: Number(currentBlock?.time() ?? Math.floor(Date.now() / 1000)),
		temp: c.value("temperature_2m"),
		feelsLike: c.value("apparent_temperature"),
		humidity: c.value("relative_humidity_2m"),
		windSpeed: c.value("wind_speed_10m"),
		windGust: c.value("wind_gusts_10m"),
		windDirection: c.value("wind_direction_10m"),
		weatherMain: mapWeatherCodeToMain(weatherCode),
		description: mapWeatherCodeToDescription(weatherCode),
	};

	const d = reader(response.daily(), DAILY);
	const sunrises = d.int64Series("sunrise");
	const sunsets = d.int64Series("sunset");
	const uvMax = d.series("uv_index_max");
	const days: SunDay[] = sunrises.map((sunrise, i) => ({
		sunrise,
		sunset: sunsets[i],
		uvMax: uvMax[i] ?? 0,
	}));

	// Hourly data starts at local midnight today. Keep 48 slots so the graph
	// always has a full window ahead, even late in the evening.
	const hourlyBlock = response.hourly();
	const h = reader(hourlyBlock, HOURLY);
	const temps = h.series("temperature_2m");
	const precip = h.series("precipitation");
	const precipProb = h.series("precipitation_probability");
	const codes = h.series("weather_code");
	const humidity = h.series("relative_humidity_2m");
	const start = Number(hourlyBlock?.time() ?? 0);
	const interval = hourlyBlock?.interval() || 3600;
	const hourly: HourlyEntry[] = temps.slice(0, 48).map((temp, i) => ({
		dt: start + i * interval,
		temp,
		weatherMain: mapWeatherCodeToMain(codes[i]),
		precipitation: precip[i] ?? 0,
		precipitationProbability: precipProb[i] ?? 0,
		humidity: humidity[i] ?? 0,
	}));

	// Total precipitation over the next 24 hours from the current hour.
	const currentSlot = hourly[findCurrentHourIndex(hourly, current.time)];
	const precipitation = currentSlot
		? sumOverWindow(hourly, currentSlot.dt, 24, (e) => e.precipitation)
		: 0;

	return { current, hourly, days, precipitation, timezone };
}
