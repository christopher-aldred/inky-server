import path from "path";
import axios from "axios";
import { loadImage } from "@napi-rs/canvas";
import { fetchWeatherApi } from "openmeteo";
import type {
	HourlyEntry,
	CurrentWeather,
	DetailedWeather,
	WeatherForecast,
	GeocodingResult,
} from "./weather.types";
import {
	DEFAULT_TIMEZONE,
	findCurrentHourIndex,
	findSunTimesForDay,
	sumOverWindow,
} from "./weather-time";

export type {
	HourlyEntry,
	CurrentWeather,
	DetailedWeather,
	WeatherForecast,
	GeocodingResult,
};

export const BASE_ICON_TYPES = [
	"clear",
	"cloudy",
	"fog",
	"rain",
	"snow",
	"thunderstorm",
];

export const NIGHT_ICON_TYPES = [...BASE_ICON_TYPES, "moon"];

export const weatherIcons: Record<string, any> = {};

async function loadIcon(type: string): Promise<void> {
	if (weatherIcons[type]) return;

	weatherIcons[type] = await loadImage(
		path.join(process.cwd(), "public", "icons", `${type}.png`),
	);
}

export async function loadWeatherIcons(iconTypes = BASE_ICON_TYPES) {
	await Promise.all(iconTypes.map((type) => loadIcon(type)));
	return weatherIcons;
}

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

	console.log("https://geocoding-api.open-meteo.com/v1/search", {
		params: {
			name: queryName,
			count: 5,
			language: "en",
			format: "json",
		},
	});

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

export function mapWeatherCodeToMain(code?: number): string {
	if (typeof code !== "number") return "clear";
	return WEATHER_CODE_MAP[code]?.main ?? "clear";
}

export function mapWeatherCodeToDescription(code?: number): string {
	if (typeof code !== "number") return "Clear sky";
	return WEATHER_CODE_MAP[code]?.description ?? "Clear sky";
}

export async function getWeatherForecast(
	location: string = "Sheffield,UK",
): Promise<WeatherForecast[]> {
	const { latitude, longitude, timezone } = await geocodeLocation(location);

	const responses = await fetchWeatherApi(
		"https://api.open-meteo.com/v1/forecast",
		{
			latitude,
			longitude,
			timezone: timezone || "auto",
			daily: [
				"temperature_2m_max",
				"temperature_2m_min",
				"weather_code",
				"sunrise",
				"sunset",
			],
			forecast_days: 5,
		},
	);

	const response = responses[0];
	if (!response) return [];

	const daily = response.daily();
	if (!daily) return [];

	const utcOffsetSeconds = response.utcOffsetSeconds();
	const tempMax = daily.variables(0)?.valuesArray?.() ?? [];
	const tempMin = daily.variables(1)?.valuesArray?.() ?? [];
	const weatherCodes = daily.variables(2)?.valuesArray?.() ?? [];

	// Sunrise and sunset are Int64 values, need special handling
	const sunriseVar = daily.variables(3);
	const sunsetVar = daily.variables(4);
	const sunriseArray = sunriseVar
		? [...Array(sunriseVar.valuesInt64Length())].map((_, i) =>
				Number(sunriseVar.valuesInt64(i)),
			)
		: [];
	const sunsetArray = sunsetVar
		? [...Array(sunsetVar.valuesInt64Length())].map((_, i) =>
				Number(sunsetVar.valuesInt64(i)),
			)
		: [];

	const startTime = Number(daily.time() ?? 0);
	const interval = daily.interval?.() ?? 86400;
	const length = Math.min(
		5,
		Math.max(tempMax.length, tempMin.length, weatherCodes.length),
	);

	return Array.from({ length }).map((_, index) => {
		const timestamp = startTime + index * interval + utcOffsetSeconds;
		const tMax = tempMax?.[index];
		const tMin = tempMin?.[index];
		const weatherCode = weatherCodes?.[index] as number | undefined;
		const sunrise = sunriseArray?.[index];
		const sunset = sunsetArray?.[index];

		const avgTemp =
			typeof tMax === "number" && typeof tMin === "number"
				? (tMax + tMin) / 2
				: typeof tMax === "number"
					? tMax
					: tMin;

		return {
			date: new Date(timestamp * 1000),
			temp: Math.round(avgTemp ?? 0),
			weather: mapWeatherCodeToMain(weatherCode),
			sunrise: sunrise !== undefined ? Number(sunrise) : undefined,
			sunset: sunset !== undefined ? Number(sunset) : undefined,
		};
	});
}

function isNighttime(
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

export async function getWeatherDetails(
	location: string = "Sheffield,UK",
): Promise<DetailedWeather> {
	const { latitude, longitude, timezone } = await geocodeLocation(location);

	const responses = await fetchWeatherApi(
		"https://api.open-meteo.com/v1/forecast",
		{
			latitude,
			longitude,
			timezone: timezone || "auto",
			current: [
				"temperature_2m",
				"relative_humidity_2m",
				"apparent_temperature",
				"is_day",
				"precipitation",
				"rain",
				"snowfall",
				"weather_code",
				"wind_speed_10m",
				"uv_index",
			],
			hourly: [
				"temperature_2m",
				"precipitation",
				"rain",
				"snowfall",
				"weather_code",
				"uv_index",
				"wind_speed_10m",
				"relative_humidity_2m",
			],
			daily: ["sunrise", "sunset", "uv_index_max", "weather_code"],
			forecast_days: 5,
		},
	);

	const response = responses[0];
	if (!response) {
		throw new Error("No weather response received from Open-Meteo");
	}

	const utcOffsetSeconds = response.utcOffsetSeconds();
	const resolvedTimezone =
		timezone || response.timezone() || DEFAULT_TIMEZONE;
	const current = response.current();
	const daily = response.daily();
	const hourly = response.hourly();

	// Sunrise and sunset are Int64 values, need special handling
	const sunriseVar = daily?.variables(0);
	const sunsetVar = daily?.variables(1);
	const dailySunrise = sunriseVar
		? [...Array(sunriseVar.valuesInt64Length())].map((_, i) =>
				Number(sunriseVar.valuesInt64(i)),
			)
		: [];
	const dailySunset = sunsetVar
		? [...Array(sunsetVar.valuesInt64Length())].map((_, i) =>
				Number(sunsetVar.valuesInt64(i)),
			)
		: [];
	const dailyUvMax = daily?.variables(2)?.valuesArray?.() ?? [];
	// const dailyWeatherCodes = daily?.variables(3)?.valuesArray?.() ?? [];

	const weatherCodeCurrent = Number(current?.variables(7)?.value() ?? 0);

	const currentWeather: CurrentWeather = {
		main: {
			temp: Number(current?.variables(0)?.value() ?? 0),
			humidity: Number(current?.variables(1)?.value() ?? 0),
			feels_like: Number(current?.variables(2)?.value() ?? 0),
		},
		wind: {
			speed: Number(current?.variables(8)?.value() ?? 0),
		},
		weather: [
			{
				main: mapWeatherCodeToMain(weatherCodeCurrent),
				description: mapWeatherCodeToDescription(weatherCodeCurrent),
			},
		],
		sys: {
			sunrise:
				dailySunrise?.[0] !== undefined ? Number(dailySunrise[0]) : undefined,
			sunset:
				dailySunset?.[0] !== undefined ? Number(dailySunset[0]) : undefined,
		},
		time: current?.time() !== undefined ? Number(current.time()) : undefined,
	};

	const hourlyTimes: number[] = (() => {
		if (!hourly) return [];
		const start = Number(hourly.time());
		const end = Number(hourly.timeEnd());
		const interval = hourly.interval();
		const len = (end - start) / interval;
		return Array.from({ length: len }, (_, i) => start + i * interval);
	})();

	const sunDays = dailySunrise.map((sunrise, i) => ({
		sunrise,
		sunset: dailySunset[i],
	}));

	// Hourly data starts at local midnight today. Keep 48 slots so the graph
	// always has 16 hours ahead, even late in the evening.
	const next24Hours: HourlyEntry[] = hourlyTimes.slice(0, 48).map((t, i) => {
		// `t` is a real Unix time (UTC). Match it to its local day by calendar
		// date, which stays right on 23- and 25-hour DST days.
		const sunDay = findSunTimesForDay(sunDays, t, resolvedTimezone);
		const sunrise = sunDay?.sunrise;
		const sunset = sunDay?.sunset;
		const weatherCode = Number(hourly?.variables(4)?.valuesArray()?.[i] ?? 0);

		return {
			dt: Number(t),
			dt_txt: new Date(t * 1000).toISOString(),
			main: {
				temp: Number(hourly?.variables(0)?.valuesArray()?.[i] ?? 0),
				humidity: Number(hourly?.variables(7)?.valuesArray()?.[i] ?? 0),
			},
			weather: [
				{
					main: mapWeatherCodeToMain(weatherCode),
					description: mapWeatherCodeToDescription(weatherCode),
				},
			],
			wind: { speed: Number(hourly?.variables(6)?.valuesArray()?.[i] ?? 0) },
			precipitation: Number(hourly?.variables(1)?.valuesArray()?.[i] ?? 0),
			rain: { "3h": Number(hourly?.variables(2)?.valuesArray()?.[i] ?? 0) },
			snow: { "3h": Number(hourly?.variables(3)?.valuesArray()?.[i] ?? 0) },
			sun: {
				sunrise: sunrise !== undefined ? Number(sunrise) : undefined,
				sunset: sunset !== undefined ? Number(sunset) : undefined,
			},
		};
	});

	const uvIndex =
		dailyUvMax?.[0] ?? hourly?.variables(5)?.valuesArray?.()?.[0] ?? 0;

	// Total precipitation (rain + showers + snow as water, in mm) over the next
	// 24 hours, starting from the hour that contains now.
	const nowSeconds = currentWeather.time ?? Math.floor(Date.now() / 1000);
	const currentSlot = next24Hours[findCurrentHourIndex(next24Hours, nowSeconds)];
	const precipitation = currentSlot
		? sumOverWindow(next24Hours, currentSlot.dt, 24, (e) => e.precipitation ?? 0)
		: 0;

	return {
		current: currentWeather,
		next24Hours,
		uvIndex: Number(uvIndex ?? 0),
		precipitation,
		timezone: resolvedTimezone,
		utcOffsetSeconds,
	};
}
