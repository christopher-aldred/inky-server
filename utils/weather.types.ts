/**
 * Represents an hourly weather entry with forecast data
 */
export interface HourlyEntry {
	dt: number;
	dt_txt: string;
	main: { temp?: number; humidity?: number };
	weather: Array<{ main: string; description: string }>;
	wind: { speed?: number };
	rain?: { "3h"?: number };
	snow?: { "3h"?: number };
	sun?: { sunrise?: number; sunset?: number };
}

/**
 * Represents current weather conditions
 */
export interface CurrentWeather {
	main: { temp?: number; humidity?: number; feels_like?: number };
	wind: { speed?: number };
	weather: Array<{ main: string; description: string }>;
	sys: { sunrise?: number; sunset?: number };
	time?: number;
}

/**
 * Represents detailed weather information including current and forecast
 */
export interface DetailedWeather {
	current: CurrentWeather;
	next24Hours: HourlyEntry[];
	uvIndex: number;
	precipitation: number;
	timezone?: string;
	utcOffsetSeconds: number;
}

/**
 * Represents a simplified weather forecast for a specific date
 */
export interface WeatherForecast {
	date: Date;
	temp: number;
	weather: string;
	sunrise?: number;
	sunset?: number;
}

/**
 * Represents geocoding result from location lookup
 */
export interface GeocodingResult {
	latitude: number;
	longitude: number;
	timezone?: string;
	name?: string;
	country?: string;
}
