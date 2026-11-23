import type { CalendarData } from "./cal.types";
import type { ProcessedEvent } from "./calendar-processing.types";

export type { ProcessedEvent };

/**
 * Format a date string to a short format (e.g., "Mon 1")
 */
export function formatDate(dateStr: string): string {
	// "YYYY-MM-DD" parses as UTC midnight, so format it in UTC too. Formatting
	// in the server's zone would show the previous day anywhere west of UTC.
	const date = new Date(dateStr);
	return date.toLocaleDateString("en-GB", {
		weekday: "short",
		day: "numeric",
		timeZone: "UTC",
	});
}

/**
 * Remove emojis and special characters from text
 * Also normalizes whitespace and removes variation selectors
 */
export function removeEmojis(text: string): string {
	if (typeof text !== "string") {
		return "";
	}

	return text
		.replace(
			/[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F191}-\u{1F251}\u{1F004}-\u{1F0CF}\u{1F170}-\u{1F171}\u{1F17E}-\u{1F17F}\u{1F18E}\u{3030}\u{2B50}\u{2B55}\u{2934}-\u{2935}\u{2B05}-\u{2B07}\u{2B1B}-\u{2B1C}\u{3297}\u{3299}\u{303D}\u{00A9}\u{00AE}\u{2122}\u{23F3}\u{24C2}\u{23E9}-\u{23EF}\u{25B6}\u{23F8}-\u{23FA}]/gu,
			"",
		)
		.replace(/[\uFE00-\uFE0F\u{1F3FB}-\u{1F3FF}]/gu, "")
		.replace(/[\u2018\u2019]/g, "'")
		.replace(/[\u201C\u201D]/g, '"')
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Process calendar data into a flat array of events
 * Sorts events by date, then by all-day status, then by time
 */
export function processCalendarData(
	calendarData: CalendarData,
): ProcessedEvent[] {
	const events: ProcessedEvent[] = [];

	Object.entries(calendarData).forEach(([date, timeSlots]) => {
		Object.entries(timeSlots).forEach(([time, eventTitles]) => {
			eventTitles.forEach((title) => {
				events.push({
					date,
					time,
					title: removeEmojis(title),
					isAllDay: time === "all-day" || time === "allday",
				});
			});
		});
	});

	return events.sort((a, b) => {
		const dateCompare = new Date(a.date).getTime() - new Date(b.date).getTime();
		if (dateCompare !== 0) return dateCompare;

		// All-day events first
		if (a.isAllDay && !b.isAllDay) return -1;
		if (!a.isAllDay && b.isAllDay) return 1;
		if (a.isAllDay && b.isAllDay) return 0;

		// Then by time
		return a.time.localeCompare(b.time);
	});
}

/**
 * Group events by date for 2-column layout (calendar-image.ts)
 * Returns only the first 2 days with events
 */
export function groupEventsByDateTwoColumn(
	events: ProcessedEvent[],
): Map<string, ProcessedEvent[]> {
	const groupedEvents = new Map<string, ProcessedEvent[]>();

	events.forEach((event) => {
		const dateKey = formatDate(event.date);
		if (!groupedEvents.has(dateKey)) {
			groupedEvents.set(dateKey, []);
		}
		groupedEvents.get(dateKey)?.push(event);
	});

	// Only take first two days with events
	const filteredEvents = new Map<string, ProcessedEvent[]>();
	Array.from(groupedEvents.entries())
		.filter(([_, dayEvents]) => dayEvents.length > 0)
		.slice(0, 2)
		.forEach(([date, events]) => {
			filteredEvents.set(date, events);
		});

	return filteredEvents;
}

/**
 * Group events by date for 4-column layout (cal-v2.ts)
 * Returns the first 4 upcoming event dates (inclusive of today)
 */
export function groupEventsByDateFourColumn(
	events: ProcessedEvent[],
	/** Today's local date ("YYYY-MM-DD") in the calendar's timezone. */
	todayKey: string,
): Map<string, ProcessedEvent[]> {
	const groupedByDate = new Map<string, ProcessedEvent[]>();

	// Group by the raw YYYY-MM-DD date key for stable ordering
	events.forEach((event) => {
		groupedByDate.set(event.date, [
			...(groupedByDate.get(event.date) ?? []),
			event,
		]);
	});

	// Collect the earliest 4 upcoming event dates (inclusive of today).
	// "YYYY-MM-DD" keys sort correctly as strings, and "today" is the London
	// date, not the server's (UTC) date.
	const desiredDateKeys = Array.from(groupedByDate.keys())
		.filter((dateKey) => dateKey >= todayKey)
		.sort()
		.slice(0, 4);

	const finalEvents = new Map<string, ProcessedEvent[]>();

	desiredDateKeys.forEach((dateKey) => {
		finalEvents.set(formatDate(dateKey), groupedByDate.get(dateKey) ?? []);
	});

	return finalEvents;
}
