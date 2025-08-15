import fetch from "node-fetch";
import IcalExpander from "ical-expander";

// Types for calendar data
interface CalendarData {
  [date: string]: {
    [time: string]: string[];
  };
}

interface CalendarSource {
  url: string;
}

/**
 * Converts iCal URLs into a structured JSON object
 * @param sources Array of calendar URLs
 * @returns Promise<CalendarData> Organized calendar data by date and time
 */
export async function convertCalendarsToJSON(
  sources: (string | CalendarSource)[]
): Promise<CalendarData> {
  const calendarData: CalendarData = {};

  const today = new Date(new Date().setUTCHours(0, 0, 0, 0));
  const oneMonthFromNow = new Date();
  oneMonthFromNow.setMonth(today.getMonth() + 1);

  for (const source of sources) {
    const sourceObj: CalendarSource =
      typeof source === "string" ? { url: source } : source;

    try {
      const icalData = await fetchICalData(sourceObj.url);

      const icalExpander = new IcalExpander({
        ics: icalData,
        maxIterations: 1000,
      });

      const expandedEvents = icalExpander.between(today, oneMonthFromNow);

      expandedEvents.events.forEach((event) => {
        addEventToCalendarData(calendarData, event, today);
      });

      expandedEvents.occurrences.forEach((occurrence) => {
        addEventToCalendarData(calendarData, occurrence, today);
      });
    } catch (error) {
      console.warn(
        `Failed to process calendar source ${sourceObj.url}:`,
        error
      );
    }
  }

  return calendarData;
}

async function fetchICalData(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch iCal data: ${response.status} ${response.statusText}`
    );
  }
  return response.text();
}

function addEventToCalendarData(calendarData: CalendarData, event: any, queryStartDate: Date): void {
  const originalStartDate = event.startDate?.toJSDate() || new Date(event.startDate);
  let endDate = event.endDate?.toJSDate() || new Date(event.endDate);

  const isAllDay =
    event.isAllDay ||
    (event.item && event.item.isAllDay) ||
    (event.startDate?.isDate && event.endDate?.isDate);

  // Adjust end date for all-day events (exclusive end date)
  if (isAllDay) {
    endDate = new Date(endDate);
    endDate.setDate(endDate.getDate() - 1);
  }

  const title = event.summary || event.item?.summary || "Untitled Event";

  // Truncate the start date to the query start date if the event started before our query range
  const effectiveStartDate = new Date(Math.max(originalStartDate.getTime(), queryStartDate.getTime()));
  
  const currentDate = new Date(effectiveStartDate);

  while (currentDate <= endDate) {
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, "0");
    const day = String(currentDate.getDate()).padStart(2, "0");
    const dateKey = `${year}-${month}-${day}`;

    // For multi-day events, use the time from the original start date only on the first day
    // of the original event. For truncated events (starting mid-way), treat as all-day
    const isOriginalFirstDay = currentDate.getTime() === originalStartDate.getTime();
    const timeKey = isAllDay
      ? "allday"
      : isOriginalFirstDay
      ? originalStartDate.toTimeString().slice(0, 5)
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