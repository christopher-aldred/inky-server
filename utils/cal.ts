import fetch from "node-fetch";
import IcalExpander from "ical-expander";
import * as dav from "dav";

// Types for calendar data
interface CalendarData {
  [date: string]: {
    [time: string]: string[];
  };
}

interface CalendarSource {
  url: string;
  username?: string;
  password?: string;
}

/**
 * Converts calendar URLs into a structured JSON object
 * @param sources Array of calendar URLs or source objects with optional credentials
 * @returns Promise<CalendarData> Organized calendar data by date and time
 */
export async function convertCalendarsToJSON(
  sources: (string | CalendarSource)[]
): Promise<CalendarData> {
  const calendarData: CalendarData = {};

  // Get date range (today to one month from now)
  const today = new Date();
  const oneMonthFromNow = new Date();
  oneMonthFromNow.setMonth(today.getMonth() + 1);

  for (const source of sources) {
    try {
      const sourceObj: CalendarSource =
        typeof source === "string" ? { url: source } : source;
      let icalData: string;

      // Try iCal first, fallback to CalDAV if credentials provided
      if (sourceObj.username && sourceObj.password) {
        try {
          icalData = await fetchCalDAVData(sourceObj);
        } catch (caldavError) {
          console.warn(
            `CalDAV failed for ${sourceObj.url}, trying as iCal:`,
            caldavError
          );
          icalData = await fetchICalData(sourceObj.url);
        }
      } else {
        icalData = await fetchICalData(sourceObj.url);
      }

      // Use ical-expander to parse and expand recurring events
      const icalExpander = new IcalExpander({
        ics: icalData,
        maxIterations: 1000,
      });
      const expandedEvents = icalExpander.between(today, oneMonthFromNow);

      // Process regular events
      expandedEvents.events.forEach((event) => {
        addEventToCalendarData(calendarData, event);
      });

      // Process recurring event occurrences
      expandedEvents.occurrences.forEach((occurrence) => {
        addEventToCalendarData(calendarData, occurrence);
      });
    } catch (error) {
      const url = typeof source === "string" ? source : source.url;
      console.warn(`Failed to process calendar source ${url}:`, error);
    }
  }

  return calendarData;
}

/**
 * Fetches iCal data from a URL
 */
async function fetchICalData(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch iCal data: ${response.status} ${response.statusText}`
    );
  }
  return response.text();
}

/**
 * Fetches calendar data from a CalDAV server
 */
async function fetchCalDAVData(source: CalendarSource): Promise<string> {
  if (!source.username || !source.password) {
    throw new Error("CalDAV requires username and password");
  }

  try {
    // Create DAV account
    const account = await dav.createAccount({
      server: source.url,
      xhr: dav.transport.Basic({
        username: source.username,
        password: source.password,
      }),
      accountType: "caldav",
      loadCollections: false,
    });

    // Find calendars
    const calendars = await dav.listCalendars(account);

    let allICalData = "";

    // Get date range for filtering
    const today = new Date();
    const oneMonthFromNow = new Date();
    oneMonthFromNow.setMonth(today.getMonth() + 1);

    // Fetch events from all calendars
    for (const calendar of calendars) {
      try {
        const calendarObjects = await dav.listCalendarObjects(calendar, {
          xhr: dav.transport.Basic({
            username: source.username,
            password: source.password,
          }),
        });

        // Fetch detailed calendar data
        const detailedObjects = await dav.syncCalendar(calendar, {
          syncMethod: "basic",
          xhr: dav.transport.Basic({
            username: source.username,
            password: source.password,
          }),
        });

        for (const obj of detailedObjects) {
          if (obj.calendarData) {
            allICalData += obj.calendarData + "\n";
          }
        }
      } catch (calError) {
        console.warn(
          `Failed to fetch calendar ${calendar.displayName}:`,
          calError
        );
      }
    }

    return allICalData;
  } catch (error) {
    throw new Error(`CalDAV fetch failed: ${error.message}`);
  }
}

/**
 * Adds an event to the calendar data structure
 */
function addEventToCalendarData(calendarData: CalendarData, event: any): void {
  // Get the start date from the event
  const startDate = event.startDate?.toJSDate() || new Date(event.startDate);

  // Check if this is an all-day event
  const isAllDay =
    event.isAllDay ||
    (event.item && event.item.isAllDay) ||
    (event.startDate &&
      event.endDate &&
      event.startDate.isDate &&
      event.endDate.isDate);

  let dateKey: string;
  let timeKey: string;

  if (isAllDay) {
    // For all-day events, use the local date without timezone conversion
    const year = startDate.getFullYear();
    const month = String(startDate.getMonth() + 1).padStart(2, "0");
    const day = String(startDate.getDate()).padStart(2, "0");
    dateKey = `${year}-${month}-${day}`;
    timeKey = "allday";
  } else {
    // For timed events, format normally
    dateKey = startDate.toISOString().split("T")[0];
    timeKey = startDate.toTimeString().slice(0, 5);
  }

  // Get event title - handle both regular events and occurrences
  const title = event.summary || event.item?.summary || "Untitled Event";

  // Initialize date if it doesn't exist
  if (!calendarData[dateKey]) {
    calendarData[dateKey] = {};
  }

  // Initialize time slot if it doesn't exist
  if (!calendarData[dateKey][timeKey]) {
    calendarData[dateKey][timeKey] = [];
  }

  // Add event to the time slot (avoid duplicates)
  if (!calendarData[dateKey][timeKey].includes(title)) {
    calendarData[dateKey][timeKey].push(title);
  }
}

/**
 * Helper function for single calendar URL
 */
export async function convertSingleCalendar(
  url: string,
  credentials?: { username: string; password: string }
): Promise<CalendarData> {
  const source: CalendarSource = {
    url,
    ...credentials,
  };

  return convertCalendarsToJSON([source]);
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

// Example usage:
/*
// Required dependencies:
// npm install node-fetch ical-expander dav
// npm install -D @types/node-fetch

// For iCal feeds
const icalResult = await convertSingleCalendar(
  'https://calendar.google.com/calendar/ical/example@gmail.com/public/basic.ics',
  'ical'
);

// For CalDAV servers
const caldavResult = await convertSingleCalendar(
  'https://caldav.example.com/calendars/user@example.com/',
  'caldav',
  { username: 'user@example.com', password: 'password' }
);

// Multiple sources
const multipleResult = await convertCalendarsToJSON([
  {
    url: 'https://calendar.google.com/calendar/ical/example@gmail.com/public/basic.ics',
    type: 'ical'
  },
  {
    url: 'https://caldav.icloud.com/published/2/...',
    type: 'ical'
  },
  {
    url: 'https://caldav.example.com/calendars/user@example.com/',
    type: 'caldav',
    username: 'user@example.com',
    password: 'password'
  }
]);

// Format for display
console.log(formatCalendarData(multipleResult));
*/
