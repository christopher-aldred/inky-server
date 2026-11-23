/** One hour of forecast. All times are real Unix seconds (UTC). */
export interface HourlyEntry {
	/** Start of the hour. */
	dt: number;
	temp: number;
	/** Icon family, e.g. "clear", "clouds", "rain" (see WEATHER_CODE_MAP). */
	weatherMain: string;
	/** Precipitation in mm for this hour (rain + showers + snow water). */
	precipitation: number;
	/** Chance of precipitation this hour, 0-100. */
	precipitationProbability: number;
	/** Relative humidity, 0-100. */
	humidity: number;
}

/** Conditions right now. */
export interface CurrentWeather {
	time: number;
	temp: number;
	feelsLike: number;
	humidity: number;
	/** km/h (Open-Meteo's default unit, no conversion needed). */
	windSpeed: number;
	/** km/h */
	windGust: number;
	/** Degrees the wind is coming FROM, 0 = north. */
	windDirection: number;
	weatherMain: string;
	description: string;
}

/** Sun times and peak UV for one local day. */
export interface SunDay {
	sunrise: number;
	sunset: number;
	uvMax: number;
}

/** Everything the weather screen needs. */
export interface DetailedWeather {
	current: CurrentWeather;
	/** Hourly forecast from local midnight today, 48 hours. */
	hourly: HourlyEntry[];
	/** One entry per local day from today. */
	days: SunDay[];
	/** Total precipitation (mm) over the next 24 hours. */
	precipitation: number;
	/** IANA timezone of the location, e.g. "Europe/London". */
	timezone: string;
	/** Degrees north, for twilight length. London's if missing. */
	latitude?: number;
}

/** Simplified daily forecast for the calendar screens' weather strip. */
export interface WeatherForecast {
	date: Date;
	temp: number;
	weather: string;
	sunrise?: number;
	sunset?: number;
}

export interface GeocodingResult {
	latitude: number;
	longitude: number;
	timezone?: string;
	name?: string;
	country?: string;
}
