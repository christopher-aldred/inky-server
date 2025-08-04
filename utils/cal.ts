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

  const today = new Date();
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
        addEventToCalendarData(calendarData, event);
      });

      expandedEvents.occurrences.forEach((occurrence) => {
        addEventToCalendarData(calendarData, occurrence);
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

function addEventToCalendarData(calendarData: CalendarData, event: any): void {
  const startDate = event.startDate?.toJSDate() || new Date(event.startDate);

  const isAllDay =
    event.isAllDay ||
    (event.item && event.item.isAllDay) ||
    (event.startDate?.isDate && event.endDate?.isDate);

  let dateKey: string;
  let timeKey: string;

  if (isAllDay) {
    const year = startDate.getFullYear();
    const month = String(startDate.getMonth() + 1).padStart(2, "0");
    const day = String(startDate.getDate()).padStart(2, "0");
    dateKey = `${year}-${month}-${day}`;
    timeKey = "allday";
  } else {
    dateKey = startDate.toISOString().split("T")[0];
    timeKey = startDate.toTimeString().slice(0, 5);
  }

  const title = event.summary || event.item?.summary || "Untitled Event";

  if (!calendarData[dateKey]) {
    calendarData[dateKey] = {};
  }

  if (!calendarData[dateKey][timeKey]) {
    calendarData[dateKey][timeKey] = [];
  }

  if (!calendarData[dateKey][timeKey].includes(title)) {
    calendarData[dateKey][timeKey].push(title);
  }
}

/**
 * Helper function for single calendar URL
 */
export async function convertSingleCalendar(
  url: string
): Promise<CalendarData> {
  return convertCalendarsToJSON([url]);
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
