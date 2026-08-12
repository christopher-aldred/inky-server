import fetch from "node-fetch";
import IcalExpander, { IcalEvent, IcalOccurrence } from "ical-expander";
import {
  CalendarData,
  CalendarItem,
  CalendarSource,
  isOccurrence,
  toDate,
} from "./cal.types";

/**
 * Converts iCal URLs into a structured JSON object
 * @param sources Array of calendar URLs
 * @returns Promise<CalendarData> Organized calendar data by date and time
 */
export async function convertCalendarsToJSON(
  sources: (string | CalendarSource)[],
): Promise<CalendarData> {
  const calendarData: CalendarData = {};

  const today = new Date(new Date().setUTCHours(0, 0, 0, 0));

  // Fetch once per source, then expand the window in 3-month steps up to 12 months
  // until we surface at least four unique event days (or exhaust the window).
  const sourceObjs: CalendarSource[] = sources.map((source) =>
    typeof source === "string" ? { url: source } : source,
  );

  // Fetch all iCal feeds up front, in parallel with limited concurrency.
  // Downloading feeds one-by-one (the old behaviour) is serial network I/O that
  // easily blows past the serverless function timeout when there are many feeds.
  // Cache parsed expanders so we don't re-parse each feed on every window step.
  const icalExpanderCache = new Map<string, IcalExpander>();

  await fetchAllInParallel(
    sourceObjs.map((sourceObj) => sourceObj.url),
    6, // concurrency limit to avoid hammering iCloud/Google / rate limits
    async (url) => {
      try {
        const ics = await fetchICalData(url);
        icalExpanderCache.set(
          url,
          new IcalExpander({ ics, maxIterations: 5000 }),
        );
      } catch (error) {
        console.warn(`Failed to fetch iCal source ${url}:`, error);
      }
    },
  );

  const processWindow = async (windowEnd: Date) => {
    for (const sourceObj of sourceObjs) {
      const icalExpander = icalExpanderCache.get(sourceObj.url);
      if (!icalExpander) continue; // fetch failed, skip this source

      const expandedEvents = icalExpander.between(today, windowEnd);

      expandedEvents.events.forEach((event: IcalEvent) => {
        addEventToCalendarData(calendarData, event, today);
      });

      expandedEvents.occurrences.forEach((occurrence: IcalOccurrence) => {
        addEventToCalendarData(calendarData, occurrence, today);
      });
    }
  };

  const stepMonths = 3;
  const maxMonths = 12;
  let months = stepMonths;

  while (months <= maxMonths) {
    const windowEnd = new Date(today);
    windowEnd.setMonth(windowEnd.getMonth() + months);

    await processWindow(windowEnd);

    if (Object.keys(calendarData).length >= 4) {
      break;
    }

    months += stepMonths;
  }

  return calendarData;
}

/**
 * Run async tasks with a maximum number executing concurrently.
 * Rejects if any task rejects (promise refusals propagate).
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

async function fetchICalData(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch iCal data: ${response.status} ${response.statusText}`,
    );
  }
  return response.text();
}

function addEventToCalendarData(
  calendarData: CalendarData,
  event: CalendarItem,
  queryStartDate: Date,
): void {
  const source = isOccurrence(event) ? event.item : event;
  const startDateRaw = isOccurrence(event) ? event.startDate : source.startDate;
  const endDateRaw = isOccurrence(event) ? event.endDate : source.endDate;

  const startDate = toDate(startDateRaw);
  let endDate = toDate(endDateRaw);

  const isAllDay =
    source.isAllDay ||
    (isOccurrence(event) && event.item.isAllDay) ||
    Boolean((startDateRaw as any)?.isDate && (endDateRaw as any)?.isDate);

  // Adjust end date for all-day events (exclusive end date)
  if (isAllDay) {
    endDate = new Date(endDate);
    endDate.setDate(endDate.getDate() - 1);
  }

  const title =
    source.summary ??
    (isOccurrence(event) ? event.item.summary : undefined) ??
    "Untitled Event";

  // Truncate the start date to the query start date if the event started before our query range
  const effectiveStartDate = new Date(
    Math.max(startDate.getTime(), queryStartDate.getTime()),
  );

  const currentDate = new Date(effectiveStartDate);

  while (currentDate <= endDate) {
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, "0");
    const day = String(currentDate.getDate()).padStart(2, "0");
    const dateKey = `${year}-${month}-${day}`;

    // For multi-day events, use the time from the original start date only on the first day
    // of the original event. For truncated events (starting mid-way), treat as all-day
    const isOriginalFirstDay = currentDate.getTime() === startDate.getTime();
    const timeKey = isAllDay
      ? "allday"
      : isOriginalFirstDay
        ? startDate.toTimeString().slice(0, 5)
        : "allday";

    if (!calendarData[dateKey]) {
      calendarData[dateKey] = {};
    }

    if (!calendarData[dateKey][timeKey]) {
      calendarData[dateKey][timeKey] = [];
    }

    if (!calendarData[dateKey][timeKey].includes(title)) {
      calendarData[dateKey][timeKey].push(title);
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }
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
