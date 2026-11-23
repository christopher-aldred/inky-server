/**
 * Turns fetched weather (plus any alerts) into exactly what the weather screen
 * shows: strings, icon names and times. No drawing happens here, so all the
 * decisions (which row says what, where nights fall, which labels show) can
 * be unit tested without a canvas.
 */
import type { AuroraAlert } from "../aurora";
import { formatKp } from "../aurora";
import { getWeatherIcon } from "../weather";
import type { DetailedWeather, HourlyEntry, SunDay } from "../weather.types";
import {
	findCurrentHourIndex,
	findSunTimesForDay,
	formatLocalHour,
	formatLocalTime,
	formatLocalWeekday,
	localDateKey,
	selectGraphHours,
} from "../weather-time";
import { formatWarningMessage, type WeatherWarning } from "../weather-warnings";
import type { AlertBannerStyle } from "./alert-banner";
import { GRAPH } from "./layout";

/** Gusts above this (km/h) are shown in red. */
export const GUST_WARNING_KMH = 60;
/** Rain chance at or above this (%) is shown in red. */
export const RAIN_CHANCE_WARNING = 50;
/** UV replaces the sunset row by day once it reaches this. */
export const UV_SHOW_FROM = 3;

export interface DetailRow {
	label: string;
	value: string;
	/** Value drawn in red. */
	highlight?: boolean;
}

export interface Banner {
	message: string;
	style: AlertBannerStyle;
}

export interface GraphPoint {
	time: number;
	temp: number;
	icon: string;
	hourLabel: string;
	rainChance: number;
	/** Relative humidity at this hour, 0-100. */
	humidity: number;
}

export interface ScreenModel {
	title: string;
	currentTemp: string;
	bigIcon: string;
	banner: Banner | null;
	details: { left: DetailRow[]; right: DetailRow[] };
	graph: {
		points: GraphPoint[];
		/** Forecast just outside the window, so the line runs to both edges. */
		before: { time: number; temp: number; humidity: number } | null;
		after: { time: number; temp: number; humidity: number } | null;
		/** [start, end] Unix-second ranges of darkness (sunset to sunrise). */
		nights: Array<[number, number]>;
		/** Real twilight length (hours) for each night, so the fade into the
		 * night is longer in summer and shorter in winter. */
		twilightHours: number[];
		/** Local midnights inside the window, labelled with the new day. */
		midnights: Array<{ time: number; label: string }>;
		highIndex: number;
		lowIndex: number;
		/** The current time, for the "now" marker. */
		now: number;
	};
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** 8-point compass direction the wind is coming from. */
export function compassDirection(degrees: number): string {
	const index = Math.round((((degrees % 360) + 360) % 360) / 45) % 8;
	return COMPASS[index];
}

const formatTemp = (t: number) => `${Math.round(t)}°C`;

/** Amber/red Met Office warning beats an aurora alert. */
export function pickBanner(
	warning: WeatherWarning | null,
	aurora: AuroraAlert | null,
): Banner | null {
	if (warning) {
		return {
			message: formatWarningMessage(warning),
			style: warning.level === "red" ? "solid" : "outline",
		};
	}
	if (aurora) {
		const kp = aurora.kp !== null ? ` ${formatKp(aurora.kp)}` : "";
		return { message: `${aurora.message}${kp}`, style: "solid" };
	}
	return null;
}

/**
 * Third row on the right: UV by day when it matters, otherwise the next
 * sunrise or sunset.
 */
export function sunOrUvRow(
	now: number,
	days: ReadonlyArray<SunDay>,
	timeZone: string,
): DetailRow {
	const todayIndex = days.findIndex(
		(d) => localDateKey(d.sunrise, timeZone) === localDateKey(now, timeZone),
	);
	const today = days[todayIndex];
	if (!today) return { label: "UV Index ", value: "-" };

	const isDay = now >= today.sunrise && now < today.sunset;
	if (isDay && today.uvMax >= UV_SHOW_FROM) {
		return { label: "UV Index ", value: today.uvMax.toFixed(1) };
	}
	if (now < today.sunrise) {
		return {
			label: "Sunrise ",
			value: formatLocalTime(today.sunrise, timeZone),
		};
	}
	if (now < today.sunset) {
		return {
			label: "Sunset ",
			value: formatLocalTime(today.sunset, timeZone),
		};
	}
	const tomorrow = days[todayIndex + 1];
	return {
		label: "Sunrise ",
		value: tomorrow ? formatLocalTime(tomorrow.sunrise, timeZone) : "-",
	};
}

const LONDON_LATITUDE = 51.5;
const RAD = Math.PI / 180;
/** Sun altitude at sunset/sunrise as Open-Meteo defines them (refraction). */
const SUNSET_ALTITUDE = -0.833;
/** End of astronomical twilight: properly dark. */
const DARK_ALTITUDE = -18;

/**
 * Hours from sunset until it's properly dark (sun 18° down) on the day of
 * `time`, at `latitude`. Around midsummer in the UK the sun never gets that
 * low, so this extrapolates from how deep it does get by solar midnight:
 * longer than half the night, so the darkest part stays lighter.
 */
export function twilightHours(time: number, latitude: number): number {
	const yearStart = Date.UTC(new Date(time * 1000).getUTCFullYear(), 0, 1);
	const doy = (time * 1000 - yearStart) / 86_400_000;
	const dec = -23.44 * RAD * Math.cos((2 * Math.PI * (doy + 10)) / 365);
	const lat = latitude * RAD;
	/** Hour angle (hours from solar noon) when the sun is at `altitude`. */
	const hourAngle = (altitude: number) => {
		const c =
			(Math.sin(altitude * RAD) - Math.sin(lat) * Math.sin(dec)) /
			(Math.cos(lat) * Math.cos(dec));
		return c < -1 ? null : Math.acos(Math.min(1, c)) / RAD / 15;
	};
	const sunset = hourAngle(SUNSET_ALTITUDE) ?? 12;
	const dark = hourAngle(DARK_ALTITUDE);
	if (dark !== null) return dark - sunset;
	// Never properly dark: deepest is at solar midnight
	const deepest = 90 - Math.abs(latitude + dec / RAD);
	return (
		((12 - sunset) * (SUNSET_ALTITUDE - DARK_ALTITUDE)) /
		Math.max(0.1, deepest + SUNSET_ALTITUDE)
	);
}

/** Dark periods: before the first sunrise, and each sunset to next sunrise. */
export function nightRanges(
	days: ReadonlyArray<SunDay>,
): Array<[number, number]> {
	if (days.length === 0) return [];
	const nights: Array<[number, number]> = [[-Infinity, days[0].sunrise]];
	days.forEach((day, i) => {
		nights.push([day.sunset, days[i + 1]?.sunrise ?? Infinity]);
	});
	return nights;
}

/** Hourly slots where the local date changes, between `from` and `to`. */
export function localMidnights(
	hourly: ReadonlyArray<HourlyEntry>,
	from: number,
	to: number,
	timeZone: string,
): Array<{ time: number; label: string }> {
	const result: Array<{ time: number; label: string }> = [];
	for (let i = 1; i < hourly.length; i++) {
		const { dt } = hourly[i];
		if (dt <= from || dt >= to) continue;
		if (
			localDateKey(dt, timeZone) !== localDateKey(hourly[i - 1].dt, timeZone)
		) {
			result.push({ time: dt, label: formatLocalWeekday(dt, timeZone) });
		}
	}
	return result;
}

/** Icon for a time, using that local day's sunrise/sunset for night. */
/** Wet weather, worst first: one of these anywhere in a block shows. */
const WET_WEATHER = ["thunderstorm", "snow", "rain"];

/**
 * Sums up the hours a graph column stands for (the hour before to the hour
 * after its label), so weather between columns isn't missed: the highest
 * rain chance, and the worst wet weather if any hour has it, otherwise the
 * labelled hour's own weather.
 */
export function summariseBlock(
	hourly: ReadonlyArray<HourlyEntry>,
	index: number,
): { weatherMain: string; rainChance: number } {
	const block = hourly.slice(Math.max(0, index - 1), index + 2);
	const own = hourly[index];
	const rainChance = Math.max(
		0,
		...block.map((e) => e.precipitationProbability),
	);
	const wet = WET_WEATHER.find((w) => block.some((e) => e.weatherMain === w));
	return {
		weatherMain: wet ?? own?.weatherMain ?? "clear",
		rainChance: Math.round(rainChance),
	};
}

function iconAt(
	weatherMain: string,
	time: number,
	days: ReadonlyArray<SunDay>,
	timeZone: string,
): string {
	const sun = findSunTimesForDay(days, time, timeZone);
	return getWeatherIcon(weatherMain, {
		timestamp: time,
		sunrise: sun?.sunrise,
		sunset: sun?.sunset,
		includeNight: true,
	});
}

export function buildScreenModel(
	weather: DetailedWeather,
	options: {
		location: string;
		now: number;
		warning?: WeatherWarning | null;
		aurora?: AuroraAlert | null;
	},
): ScreenModel {
	const { current, hourly, days, timezone } = weather;
	const { now } = options;

	const titleTime = new Intl.DateTimeFormat("en-GB", {
		timeZone: timezone,
		weekday: "short",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).format(new Date(now * 1000));

	const windSpeed = Math.round(current.windSpeed);
	const windGust = Math.round(current.windGust);

	// Graph points every few hours, starting a little in the past so the
	// recent trend shows. Hourly data starts at local midnight, so very early
	// in the day the graph starts at midnight instead.
	const startIndex = Math.max(
		0,
		findCurrentHourIndex(hourly, now) - GRAPH.pastHours,
	);
	const picked = selectGraphHours(
		hourly,
		hourly[startIndex]?.dt ?? now,
		GRAPH.pointCount,
		GRAPH.stepHours,
	);
	const points: GraphPoint[] = picked.map((entry) => {
		const block = summariseBlock(hourly, hourly.indexOf(entry));
		return {
			time: entry.dt,
			temp: entry.temp,
			icon: iconAt(block.weatherMain, entry.dt, days, timezone),
			hourLabel: formatLocalHour(entry.dt, timezone),
			rainChance: block.rainChance,
			humidity: entry.humidity,
		};
	});

	const endIndex = startIndex + (picked.length - 1) * GRAPH.stepHours;
	const edge = (index: number) => {
		const entry = hourly[Math.max(0, Math.min(hourly.length - 1, index))];
		return entry
			? { time: entry.dt, temp: entry.temp, humidity: entry.humidity }
			: null;
	};
	const before = startIndex > 0 ? edge(startIndex - GRAPH.stepHours) : null;
	const after =
		endIndex < hourly.length - 1 ? edge(endIndex + GRAPH.stepHours) : null;

	const temps = points.map((p) => p.temp);
	const windowStart = points[0]?.time ?? now;
	const windowEnd = points[points.length - 1]?.time ?? now;

	return {
		title: `Weather ${options.location.split(",")[0]}, ${titleTime}`,
		currentTemp: formatTemp(current.temp),
		bigIcon: iconAt(current.weatherMain, current.time, days, timezone),
		banner: pickBanner(options.warning ?? null, options.aurora ?? null),
		details: {
			left: [
				{
					label: "Wind ",
					value: `${windSpeed} km/h ${compassDirection(current.windDirection)}`,
				},
				{
					label: "Gusts ",
					value: `${windGust} km/h`,
					highlight: windGust > GUST_WARNING_KMH,
				},
				{ label: "Feels Like ", value: formatTemp(current.feelsLike) },
			],
			right: [
				{ label: "Rain ", value: `${weather.precipitation.toFixed(1)} mm` },
				{ label: "Humidity ", value: `${Math.round(current.humidity)}%` },
				sunOrUvRow(now, days, timezone),
			],
		},
		graph: {
			points,
			before,
			after,
			nights: nightRanges(days),
			twilightHours: nightRanges(days).map(([start, end]) =>
				twilightHours(
					Number.isFinite(start) ? start : end,
					weather.latitude ?? LONDON_LATITUDE,
				),
			),
			midnights: localMidnights(
				hourly,
				before?.time ?? windowStart,
				after?.time ?? windowEnd,
				timezone,
			),
			highIndex: temps.indexOf(Math.max(...temps)),
			lowIndex: temps.indexOf(Math.min(...temps)),
			now,
		},
	};
}
