/**
 * Turn parsed iCal feeds into per-day calendar data, in the display's own
 * timezone (Europe/London), whatever timezone the server runs in.
 *
 * Vercel runs in UTC. Using the server clock (`getHours()`, `toTimeString()`,
 * `setHours(0)`, …) put every timed event an hour early during BST, put
 * late-evening events on the wrong day and made "today" start at 01:00 BST.
 * Everything here goes through an explicit IANA timezone instead.
 *
 * This file has only package runtime imports so it can be unit tested with
 * plain Node.
 */
import type IcalExpander from "ical-expander";
import type { ICalDateTime, IcalEvent, IcalOccurrence } from "ical-expander";
import type { CalendarData } from "./cal.types";

export const CALENDAR_TIMEZONE = "Europe/London";
export const ALL_DAY = "allday";

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsIn(instantMs: number, timeZone: string) {
	let formatter = formatterCache.get(timeZone);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat("en-GB", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hourCycle: "h23",
		});
		formatterCache.set(timeZone, formatter);
	}
	const parts = formatter.formatToParts(new Date(instantMs));
	const get = (type: string) =>
		Number(parts.find((p) => p.type === type)?.value ?? 0);
	return {
		year: get("year"),
		month: get("month"),
		day: get("day"),
		hour: get("hour"),
		minute: get("minute"),
		second: get("second"),
	};
}

const pad = (n: number) => String(n).padStart(2, "0");

function toKey(year: number, month: number, day: number): string {
	return `${year}-${pad(month)}-${pad(day)}`;
}

/** Local calendar date ("YYYY-MM-DD") of an instant in `timeZone`. */
export function dateKeyIn(instantMs: number, timeZone: string): string {
	const p = partsIn(instantMs, timeZone);
	return toKey(p.year, p.month, p.day);
}

/** Local wall-clock time ("HH:MM") of an instant in `timeZone`. */
export function timeIn(instantMs: number, timeZone: string): string {
	const p = partsIn(instantMs, timeZone);
	return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Add whole days to a "YYYY-MM-DD" key (pure calendar maths, no DST). */
export function addDaysToKey(key: string, days: number): string {
	const [y, m, d] = key.split("-").map(Number);
	const date = new Date(Date.UTC(y, m - 1, d + days));
	return toKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function addMonthsToKey(key: string, months: number): string {
	const [y, m, d] = key.split("-").map(Number);
	const date = new Date(Date.UTC(y, m - 1 + months, d));
	return toKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** The instant at which the wall clock in `timeZone` reads the given time. */
export function wallTimeToInstant(
	fields: {
		year: number;
		month: number;
		day: number;
		hour?: number;
		minute?: number;
		second?: number;
	},
	timeZone: string,
): number {
	const asUtc = Date.UTC(
		fields.year,
		fields.month - 1,
		fields.day,
		fields.hour ?? 0,
		fields.minute ?? 0,
		fields.second ?? 0,
	);
	const offsetAt = (instant: number) => {
		const p = partsIn(instant, timeZone);
		return (
			Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) -
			Math.floor(instant / 1000) * 1000
		);
	};
	const first = asUtc - offsetAt(asUtc);
	const second = asUtc - offsetAt(first);
	return second;
}

/** Midnight at the start of a local day, as an instant. */
export function startOfDayInstant(key: string, timeZone: string): number {
	const [year, month, day] = key.split("-").map(Number);
	return wallTimeToInstant({ year, month, day }, timeZone);
}

type CalendarItem = IcalEvent | IcalOccurrence;

const isOccurrence = (item: CalendarItem): item is IcalOccurrence =>
	(item as IcalOccurrence).item !== undefined;

/**
 * Instant of a timed iCal value. Values with a known TZID or a trailing Z
 * convert correctly through ical.js. "Floating" values (no TZID, or one ical.js
 * doesn't know) are wall-clock times meant for the reader's own zone, so read
 * them in the display timezone, not the server's.
 */
function instantOf(value: ICalDateTime, timeZone: string): number {
	if (value.zone?.tzid === "floating" && value.year !== undefined) {
		return wallTimeToInstant(
			{
				year: value.year,
				month: value.month ?? 1,
				day: value.day ?? 1,
				hour: value.hour,
				minute: value.minute,
				second: value.second,
			},
			timeZone,
		);
	}
	return value.toJSDate().getTime();
}

/** "YYYY-MM-DD" of an all-day (DATE) value, read straight from the value. */
function dateValueKey(value: ICalDateTime): string {
	if (value.year !== undefined) {
		return toKey(value.year, value.month ?? 1, value.day ?? 1);
	}
	const d = value.toJSDate();
	return toKey(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function push(
	calendarData: CalendarData,
	dateKey: string,
	timeKey: string,
	title: string,
) {
	calendarData[dateKey] ??= {};
	calendarData[dateKey][timeKey] ??= [];
	if (!calendarData[dateKey][timeKey].includes(title)) {
		calendarData[dateKey][timeKey].push(title);
	}
}

/**
 * Add one event or occurrence to `calendarData`, on every local day it
 * touches from `todayKey` on. Timed events show their start time on the day
 * they start and count as all-day on the days they carry on into.
 */
export function addItemToCalendarData(
	calendarData: CalendarData,
	item: CalendarItem,
	todayKey: string,
	timeZone: string = CALENDAR_TIMEZONE,
): void {
	const source = isOccurrence(item) ? item.item : item;
	const status = source.component?.getFirstPropertyValue?.("status");
	if (typeof status === "string" && status.toUpperCase() === "CANCELLED") {
		return;
	}

	const title = source.summary?.trim() || "Untitled Event";
	const start = item.startDate;
	const end = item.endDate ?? item.startDate;

	let firstKey: string;
	let lastKey: string;
	let startTime: string | undefined;

	if (start.isDate) {
		firstKey = dateValueKey(start);
		// DTEND of an all-day event is exclusive: a one-day event ends the next day.
		const endKey = end?.isDate ? dateValueKey(end) : firstKey;
		lastKey = endKey > firstKey ? addDaysToKey(endKey, -1) : firstKey;
	} else {
		const startMs = instantOf(start, timeZone);
		const endMs = Math.max(startMs, instantOf(end, timeZone));
		firstKey = dateKeyIn(startMs, timeZone);
		// An event ending exactly at midnight doesn't spill into the next day.
		lastKey = dateKeyIn(Math.max(startMs, endMs - 1), timeZone);
		startTime = timeIn(startMs, timeZone);
	}

	let key = firstKey < todayKey ? todayKey : firstKey;
	// Guard against runaway loops on malformed feeds (years-long events).
	for (let i = 0; key <= lastKey && i < 400; i++) {
		push(
			calendarData,
			key,
			startTime && key === firstKey ? startTime : ALL_DAY,
			title,
		);
		key = addDaysToKey(key, 1);
	}
}

/**
 * Expand every feed from today forward, widening the window in 3-month steps
 * up to 12 months until at least `minDays` days have events.
 */
export function buildCalendarData(
	expanders: IcalExpander[],
	now: Date = new Date(),
	timeZone: string = CALENDAR_TIMEZONE,
	minDays = 4,
): CalendarData {
	const calendarData: CalendarData = {};
	const todayKey = dateKeyIn(now.getTime(), timeZone);
	// A day of slack on each side: ical-expander compares all-day events using
	// the server's clock, and we clip to the local day ourselves anyway.
	const windowStart = new Date(
		startOfDayInstant(addDaysToKey(todayKey, -1), timeZone),
	);

	for (let months = 3; months <= 12; months += 3) {
		const windowEnd = new Date(
			startOfDayInstant(
				addDaysToKey(addMonthsToKey(todayKey, months), 1),
				timeZone,
			),
		);

		for (const expander of expanders) {
			const { events, occurrences } = expander.between(windowStart, windowEnd);
			for (const event of events) {
				addItemToCalendarData(calendarData, event, todayKey, timeZone);
			}
			for (const occurrence of occurrences) {
				addItemToCalendarData(calendarData, occurrence, todayKey, timeZone);
			}
		}

		if (Object.keys(calendarData).length >= minDays) break;
	}

	return calendarData;
}
