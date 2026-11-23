/**
 * Time helpers for the weather display.
 *
 * Open-Meteo's SDK returns every timestamp (hourly, daily, current, sunrise,
 * sunset) as a real Unix time in seconds (UTC). Converting those to local
 * wall-clock values must go through the location's IANA timezone, never
 * through the server's own timezone (Vercel runs in UTC) and never by adding a
 * single fixed `utcOffsetSeconds`, which is wrong on the far side of a
 * GMT/BST change.
 *
 * This file has no runtime imports so it can be unit tested with plain Node.
 */

export const DEFAULT_TIMEZONE = "Europe/London";

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(
	timeZone: string,
	options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
	const key = `${timeZone}|${JSON.stringify(options)}`;
	let formatter = formatterCache.get(key);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat("en-GB", { timeZone, ...options });
		formatterCache.set(key, formatter);
	}
	return formatter;
}

/** Two-digit local hour ("00".."23") for a Unix time in seconds. */
export function formatLocalHour(unixSeconds: number, timeZone: string): string {
	const parts = getFormatter(timeZone, {
		hour: "2-digit",
		hourCycle: "h23",
	}).formatToParts(new Date(unixSeconds * 1000));
	const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
	return hour.padStart(2, "0");
}

/** Local calendar date ("YYYY-MM-DD") for a Unix time in seconds. */
export function localDateKey(unixSeconds: number, timeZone: string): string {
	const parts = getFormatter(timeZone, {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(new Date(unixSeconds * 1000));
	const get = (type: string) => parts.find((p) => p.type === type)?.value;
	return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Index of the hourly slot that contains `nowSeconds`: the last entry whose
 * start time is at or before now. Falls back to 0 if now is before the data.
 */
export function findCurrentHourIndex(
	entries: ReadonlyArray<{ dt: number }>,
	nowSeconds: number,
): number {
	let index = -1;
	for (let i = 0; i < entries.length; i++) {
		if (entries[i].dt <= nowSeconds) index = i;
		else break;
	}
	return Math.max(0, index);
}

/**
 * Points for the temperature graph: starting at the hour that contains now,
 * take every `stepHours`-th hourly entry until `pointCount` points are picked.
 * Hourly data is evenly spaced in real time, so points are too, including
 * across a GMT/BST change (labels then read e.g. 00, 01, 01 or 00, 02, 03).
 */
export function selectGraphHours<T extends { dt: number }>(
	entries: ReadonlyArray<T>,
	nowSeconds: number,
	pointCount = 8,
	stepHours = 3,
): T[] {
	const start = findCurrentHourIndex(entries, nowSeconds);
	const picked: T[] = [];
	for (
		let i = start;
		i < entries.length && picked.length < pointCount;
		i += stepHours
	) {
		picked.push(entries[i]);
	}
	return picked;
}

/**
 * Pick the sunrise/sunset pair for the local day containing `unixSeconds`.
 * Days are matched by local calendar date, so 23- and 25-hour days are fine.
 */
export function findSunTimesForDay(
	days: ReadonlyArray<{ sunrise?: number; sunset?: number }>,
	unixSeconds: number,
	timeZone: string,
): { sunrise?: number; sunset?: number } | undefined {
	const key = localDateKey(unixSeconds, timeZone);
	return days.find(
		(day) =>
			day.sunrise !== undefined && localDateKey(day.sunrise, timeZone) === key,
	);
}

/** Sum of `amount` over entries whose slot starts in [from, from + hours). */
export function sumOverWindow<T extends { dt: number }>(
	entries: ReadonlyArray<T>,
	fromSeconds: number,
	hours: number,
	amount: (entry: T) => number,
): number {
	const end = fromSeconds + hours * 3600;
	return entries.reduce(
		(total, entry) =>
			entry.dt >= fromSeconds && entry.dt < end ? total + amount(entry) : total,
		0,
	);
}

/** Local "HH:MM" (24h) for a Unix time in seconds. */
export function formatLocalTime(unixSeconds: number, timeZone: string): string {
	return getFormatter(timeZone, {
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).format(new Date(unixSeconds * 1000));
}

/** Local short weekday ("Mon".."Sun") for a Unix time in seconds. */
export function formatLocalWeekday(
	unixSeconds: number,
	timeZone: string,
): string {
	return getFormatter(timeZone, { weekday: "short" }).format(
		new Date(unixSeconds * 1000),
	);
}
