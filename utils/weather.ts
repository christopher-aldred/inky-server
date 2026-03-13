import path from "path";
import axios from "axios";
import { loadImage } from "canvas";

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

export interface WeatherForecast {
	date: Date;
	temp: number;
	weather: string;
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

interface GeocodingResult {
	latitude: number;
	longitude: number;
	timezone?: string;
	name?: string;
	country?: string;
}

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

	const response = await axios.get("https://api.open-meteo.com/v1/forecast", {
		params: {
			latitude,
			longitude,
			daily: "temperature_2m_max,temperature_2m_min,weather_code",
			timezone: timezone || "auto",
			forecast_days: 5,
		},
	});

	const daily = response.data?.daily;

	if (!daily) return [];

	return daily.time.slice(0, 5).map((time: string, index: number) => {
		const tempMax = daily.temperature_2m_max?.[index];
		const tempMin = daily.temperature_2m_min?.[index];
		const weatherCode = (daily.weather_code?.[index] ??
			daily.weathercode?.[index]) as number | undefined;

		const avgTemp =
			typeof tempMax === "number" && typeof tempMin === "number"
				? (tempMax + tempMin) / 2
				: typeof tempMax === "number"
					? tempMax
					: tempMin;

		return {
			date: new Date(time),
			temp: Math.round(avgTemp ?? 0),
			weather: mapWeatherCodeToMain(weatherCode),
		};
	});
}

function isNighttime(
	timestamp: number,
	sunrise: number,
	sunset: number,
): boolean {
	const now = new Date(timestamp * 1000);
	const currentTime = now.getUTCHours() * 3600 + now.getUTCMinutes() * 60;

	const sunriseTime = new Date(sunrise * 1000);
	const sunriseSeconds =
		sunriseTime.getUTCHours() * 3600 + sunriseTime.getUTCMinutes() * 60;

	const sunsetTime = new Date(sunset * 1000);
	const sunsetSeconds =
		sunsetTime.getUTCHours() * 3600 + sunsetTime.getUTCMinutes() * 60;

	return currentTime > sunsetSeconds || currentTime < sunriseSeconds;
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

	if (
		options?.includeNight &&
		options.timestamp &&
		options.sunrise &&
		options.sunset &&
		main === "clear" &&
		isNighttime(options.timestamp, options.sunrise, options.sunset)
	) {
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
