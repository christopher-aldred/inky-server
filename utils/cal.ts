import fetch from "node-fetch";
import IcalExpander from "ical-expander";
import type { CalendarData, CalendarSource } from "./cal.types";
import { buildCalendarData } from "./calendar-events";
import { describeFeedUrl, normalizeFeedUrl } from "./feed-url";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_FEED_BYTES = 10 * 1024 * 1024;

/**
 * Converts iCal URLs into a structured JSON object
 * @param sources Array of calendar URLs
 * @returns Promise<CalendarData> Organized calendar data by date and time
 */
export async function convertCalendarsToJSON(
	sources: (string | CalendarSource)[],
): Promise<CalendarData> {
	const urls = sources.map((source) =>
		typeof source === "string" ? source : source.url,
	);

	// Fetch all iCal feeds up front, in parallel with limited concurrency.
	// Downloading feeds one-by-one is serial network I/O that easily blows past
	// the serverless function timeout when there are many feeds.
	const expanders: IcalExpander[] = [];

	await fetchAllInParallel(
		urls,
		6, // concurrency limit to avoid hammering iCloud/Google / rate limits
		async (url) => {
			try {
				const ics = await fetchICalData(url);
				expanders.push(new IcalExpander({ ics, maxIterations: 5000 }));
			} catch (error) {
				// Feed URLs often carry a private token, so only log the host.
				console.warn(
					`Failed to load iCal source ${describeFeedUrl(url)}:`,
					error instanceof Error ? error.message : error,
				);
			}
		},
	);

	return buildCalendarData(expanders);
}

/**
 * Run async tasks with a maximum number executing concurrently.
 */
async function fetchAllInParallel<T>(
	items: T[],
	concurrency: number,
	worker: (item: T) => Promise<void>,
): Promise<void> {
	if (items.length === 0) return;

	let index = 0;
	const queue = Math.min(concurrency, items.length);
	const workers = Array.from({ length: queue }, async () => {
		while (index < items.length) {
			const current = index++;
			await worker(items[current]);
		}
	});

	await Promise.all(workers);
}

async function fetchICalData(rawUrl: string): Promise<string> {
	const url = normalizeFeedUrl(rawUrl);
	const response = await fetch(url, {
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		size: MAX_FEED_BYTES,
	});
	if (!response.ok) {
		throw new Error(
			`Failed to fetch iCal data: ${response.status} ${response.statusText}`,
		);
	}
	return response.text();
}

/**
 * Utility function to format calendar data for display
 */
export function formatCalendarData(calendarData: CalendarData): string {
	let output = "";

	Object.keys(calendarData)
		.sort()
		.forEach((date) => {
			output += `\n${date}:\n`;

			Object.keys(calendarData[date])
				.sort()
				.forEach((time) => {
					const events = calendarData[date][time];
					output += `  ${time}: ${events.join(", ")}\n`;
				});
		});

	return output;
}
