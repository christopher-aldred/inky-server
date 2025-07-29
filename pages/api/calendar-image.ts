import { NextApiRequest, NextApiResponse } from "next";
import { createCanvas, registerFont, loadImage } from "canvas";
import axios from "axios";
import path from "path";
import ical from "node-ical";
import { DAVClient } from "tsdav";

// Register Mania font
const fontPath = path.join(process.cwd(), "public", "fonts", "mania.ttf");
registerFont(fontPath, { family: "Mania" });

// Weather icons setup
const weatherIcons: { [key: string]: any } = {};

// Types for calendar configuration
interface CalendarConfig {
  url: string;
  type: "ical" | "caldav";
  username?: string;
  password?: string;
}

async function loadWeatherIcons() {
  const iconTypes = ["clear", "cloudy", "fog", "rain", "snow", "thunderstorm"];
  for (const type of iconTypes) {
    weatherIcons[type] = await loadImage(
      path.join(process.cwd(), "public", "icons", `${type}.png`)
    );
  }
}

function getWeatherIcon(weatherMain: string): string {
  switch (weatherMain.toLowerCase()) {
    case "clear":
      return "clear";
    case "clouds":
      return "cloudy";
    case "mist":
    case "fog":
      return "fog";
    case "rain":
    case "drizzle":
      return "rain";
    case "snow":
      return "snow";
    case "thunderstorm":
      return "thunderstorm";
    default:
      return "clear";
  }
}

// Helper functions for dates and formatting
function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-UK", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-UK", {
    weekday: "short",
    day: "numeric",
  });
}

function removeEmojis(text: any): string {
  if (typeof text !== "string") {
    return ""; // Handle non-string inputs
  }

  return text
    .replace(
      /[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F191}-\u{1F251}\u{1F004}-\u{1F0CF}\u{1F170}-\u{1F171}\u{1F17E}-\u{1F17F}\u{1F18E}\u{3030}\u{2B50}\u{2B55}\u{2934}-\u{2935}\u{2B05}-\u{2B07}\u{2B1B}-\u{2B1C}\u{3297}\u{3299}\u{303D}\u{00A9}\u{00AE}\u{2122}\u{23F3}\u{24C2}\u{23E9}-\u{23EF}\u{25B6}\u{23F8}-\u{23FA}]/gu,
      ""
    )
    .replace(/[\uFE00-\uFE0F\u{1F3FB}-\u{1F3FF}]/gu, "") // Remove variation selectors and skin tones
    .replace(/[\u2018\u2019]/g, "'") // Convert smart quotes to straight apostrophes
    .replace(/[\u201C\u201D]/g, '"') // Convert smart quotes to straight quotes
    .replace(/\s+/g, " ") // Replace multiple spaces with single space
    .trim();
}

// Calendar event grouping
function groupEventsByDate(events: any[]): Map<string, any[]> {
  const groupedEvents = new Map<string, any[]>();

  events.forEach((event) => {
    const dateKey = formatDate(event.start);
    if (!groupedEvents.has(dateKey)) {
      groupedEvents.set(dateKey, []);
    }
    groupedEvents.get(dateKey)?.push(event);
  });

  // Create a new map with only non-empty days, maintaining chronological order
  const filteredEvents = new Map<string, any[]>();
  Array.from(groupedEvents.entries())
    .filter(([_, dayEvents]) => dayEvents.length > 0)
    .slice(0, 2) // Only take first two days with events
    .forEach(([date, events]) => {
      filteredEvents.set(
        date,
        events.sort((a, b) => a.start.getTime() - b.start.getTime())
      );
    });

  return filteredEvents;
}

// Helper function to check if a date is excluded by exdate
function isDateExcluded(date: Date, exdates: any, isAllDay: boolean): boolean {
  if (!exdates) {
    return false;
  }

  // Convert the date to check into a comparable format
  let dateToCheck: Date;
  if (isAllDay) {
    // For all-day events, normalize to midnight UTC
    dateToCheck = new Date(date);
    dateToCheck.setUTCHours(0, 0, 0, 0);
  } else {
    dateToCheck = new Date(date);
  }

  // The exdate object has date keys directly as properties
  const dateKeys = Object.keys(exdates);

  for (const dateKey of dateKeys) {
    const exdateValue = exdates[dateKey];
    
    let excludedDate: Date;
    
    if (exdateValue && typeof exdateValue === 'object' && 'getTime' in exdateValue) {
      // exdateValue is already a Date object - use it directly without modification
      excludedDate = new Date(exdateValue as Date);
    } else {
      // Try to parse the key as a date string (YYYY-MM-DD format)
      excludedDate = new Date(dateKey + 'T00:00:00.000Z');
    }

    // For all-day events, check if the excluded date + 1 hour equals the date to check
    // This handles the timezone issue where July 28th 23:00 UTC = July 29th 00:00 UTC (in UK timezone)
    if (isAllDay && exdateValue && typeof exdateValue === 'object' && 'getTime' in exdateValue) {
      const excludedDatePlus1Hour = new Date(excludedDate.getTime() + 60 * 60 * 1000); // Add 1 hour
      
      if (dateToCheck.getTime() === excludedDatePlus1Hour.getTime()) {
        return true;
      }
    }

    // Compare the dates directly
    if (dateToCheck.getTime() === excludedDate.getTime()) {
      return true;
    }

    // Also check if they're the same calendar date (for timezone edge cases)
    if (isAllDay &&
        dateToCheck.getUTCFullYear() === excludedDate.getUTCFullYear() &&
        dateToCheck.getUTCMonth() === excludedDate.getUTCMonth() &&
        dateToCheck.getUTCDate() === excludedDate.getUTCDate()) {
      return true;
    }
  }

  return false;
}

function expandRecurringEvents(
  events: any[],
  startDate: Date,
  endDate: Date
): any[] {
  const expandedEvents: any[] = [];

  events.forEach((event) => {
    if (!event.start || !event.type || event.type !== "VEVENT") return;

    // Normalize dates for comparison
    const eventStart = new Date(event.start);
    if (event.datetype === "date") {
      // For full-day events, set time to midnight UTC
      eventStart.setUTCHours(0, 0, 0, 0);
    }

    // Handle non-recurring events
    if (!event.rrule) {
      if (eventStart >= startDate && eventStart <= endDate) {
        expandedEvents.push(event);
      }
      return;
    }

    // Handle recurring events
    const dates = event.rrule.between(startDate, endDate, true); // Add true to be inclusive
    
    dates.forEach((date) => {
      // Check if this date is excluded
      if (event.exdate && isDateExcluded(date, event.exdate, event.datetype === "date")) {
        return; // Skip this occurrence
      }

      const newEvent = { ...event };
      if (event.datetype === "date") {
        // Maintain the full-day event property
        date.setUTCHours(0, 0, 0, 0);
      }
      newEvent.start = date;
      newEvent.end = new Date(
        date.getTime() + (event.end.getTime() - event.start.getTime())
      );
      expandedEvents.push(newEvent);
    });
  });

  return expandedEvents;
}

// Calendar data fetching functions
async function getCalDavEvents(
  serverUrl: string,
  username: string,
  password: string
): Promise<any[]> {
  const client = new DAVClient({
    serverUrl,
    credentials: {
      username,
      password,
    },
    defaultAccountType: "caldav",
  });

  await client.login();
  const calendars = await client.fetchCalendars();

  const now = new Date();
  const twoDaysFromNow = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

  const calendarQuery = `<?xml version="1.0" encoding="utf-8" ?>
    <C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
      <D:prop>
        <D:getetag/>
        <C:calendar-data/>
      </D:prop>
      <C:filter>
        <C:comp-filter name="VCALENDAR">
          <C:comp-filter name="VEVENT">
            <C:time-range 
              start="${now.toISOString()}"
              end="${twoDaysFromNow.toISOString()}"/>
          </C:comp-filter>
        </C:comp-filter>
      </C:filter>
    </C:calendar-query>`;

  const events: any[] = [];
  for (const calendar of calendars) {
    const calendarObjects = await client.calendarQuery({
      url: calendar.url,
      props: ["D:getetag", "C:calendar-data"],
      filters: calendarQuery as any,
    });

    for (const obj of calendarObjects) {
      if ((obj as any).calendarData) {
        const parsedEvents = await ical.async.parseICS(
          (obj as any).calendarData
        );
        events.push(...Object.values(parsedEvents));
      }
    }
  }

  return events;
}

async function getIcalEvents(url: string): Promise<any[]> {
  const response = await axios.get(url, {
    timeout: 10000, // 10 second timeout
    headers: {
      "User-Agent": "Calendar-Display/1.0",
    },
  });
  const events = await ical.async.parseICS(response.data);
  const eventArray = Object.values(events);
  return eventArray;
}

// Enhanced function to fetch events from multiple calendars
async function fetchEventsFromCalendars(
  calendars: CalendarConfig[]
): Promise<any[]> {
  const allEventsPromises = calendars.map(async (calendar, index) => {
    try {
      let events: any[] = [];
      if (calendar.type === "caldav") {
        if (!calendar.username || !calendar.password) {
          console.warn(
            `Skipping CalDAV calendar ${calendar.url} - missing credentials`
          );
          return [];
        }
        events = await getCalDavEvents(
          calendar.url,
          calendar.username,
          calendar.password
        );
      } else {
        events = await getIcalEvents(calendar.url);
      }

      return events;
    } catch (error) {
      console.error(
        `Error fetching calendar ${index + 1} (${calendar.url}):`,
        error
      );
      return []; // Return empty array for failed calendars
    }
  });

  const allEventsArrays = await Promise.all(allEventsPromises);
  const flattenedEvents = allEventsArrays.flat();
  return flattenedEvents;
}

// Parse calendar configurations from query parameters
function parseCalendarConfigs(query: any): CalendarConfig[] {
  const calendars: CalendarConfig[] = [];

  // Handle single calendar (backward compatibility)
  if (query.url && !Array.isArray(query.url)) {
    calendars.push({
      url: query.url as string,
      type: (query.type as "ical" | "caldav") || "ical",
      username: query.username as string,
      password: query.password as string,
    });
    return calendars;
  }

  // Handle multiple calendars
  const urls = Array.isArray(query.url) ? query.url : [query.url];
  const types = Array.isArray(query.type)
    ? query.type
    : query.type
    ? [query.type]
    : [];
  const usernames = Array.isArray(query.username)
    ? query.username
    : query.username
    ? [query.username]
    : [];
  const passwords = Array.isArray(query.password)
    ? query.password
    : query.password
    ? [query.password]
    : [];

  urls.forEach((url, index) => {
    if (url) {
      const config: CalendarConfig = {
        url: url as string,
        type: (types[index] || "ical") as "ical" | "caldav",
        username: usernames[index] as string,
        password: passwords[index] as string,
      };
      calendars.push(config);
    }
  });

  return calendars;
}

// Weather data fetching
async function getWeatherForecast(location: string = "Sheffield,UK") {
  const OPENWEATHER_API_KEY = "693c1f1df284ff1be69d05f2b09d015c";
  const response = await axios.get(
    `https://api.openweathermap.org/data/2.5/forecast?q=${location}&appid=${OPENWEATHER_API_KEY}&units=metric`
  );

  interface WeatherForecast {
    date: Date;
    temp: number;
    weather: string;
  }
  const dailyForecasts: WeatherForecast[] = [];
  const processedDates = new Set();

  for (const item of response.data.list) {
    const date = new Date(item.dt * 1000);
    const dateKey = date.toDateString();

    if (!processedDates.has(dateKey)) {
      processedDates.add(dateKey);
      dailyForecasts.push({
        date,
        temp: Math.round(item.main.temp),
        weather: item.weather[0].main,
      });
    }

    if (dailyForecasts.length >= 5) break;
  }

  return dailyForecasts;
}

// Main handler
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  console.log('Calendar image API request received');
  
  try {
    const { location } = req.query;

    // Parse calendar configurations from query parameters
    const calendarConfigs = parseCalendarConfigs(req.query);

    if (calendarConfigs.length === 0) {
      throw new Error("No calendar URLs provided");
    }

    // Load weather icons first
    await loadWeatherIcons();

    // Fetch both calendar events and weather forecast in parallel
    const [allEvents, weatherForecast] = await Promise.all([
      fetchEventsFromCalendars(calendarConfigs),
      getWeatherForecast(location as string),
    ]);

    // Filter events for next 7 days
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const relevantEvents = expandRecurringEvents(
      allEvents,
      now,
      sevenDaysFromNow
    ).sort((a: any, b: any) => a.start.getTime() - b.start.getTime());

    // Group events by date
    const groupedEvents = groupEventsByDate(relevantEvents);

    // Create canvas
    const canvas = createCanvas(800, 480);
    const ctx = canvas.getContext("2d");

    // Set white background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 800, 480);

    // Draw today's date and time in header
    ctx.fillStyle = "#FF0000";
    ctx.font = "42px Mania";
    const headerText = `Calendar events`;
    ctx.fillText(headerText, 20, 50);

    const dateStr = now.toLocaleDateString("en-UK", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    ctx.font = "36px Mania";
    ctx.fillStyle = "#666666";
    const dateWidth = ctx.measureText(dateStr).width;
    ctx.fillText(dateStr, 800 - dateWidth - 20, 50);

    // Calculate metrics for the two-column layout
    const columnWidth = 380;
    const columnPadding = 10;
    let dayIndex = 0;

    // Draw events in two columns
    for (const [date, events] of groupedEvents) {
      const xPosition = dayIndex === 0 ? 20 : columnWidth + 40;
      let yPosition = 100;

      // Draw date header
      ctx.fillStyle = "#000000";
      ctx.font = "36px Mania";
      ctx.fillText(date, xPosition, yPosition);

      // Draw line under date
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(xPosition - 20, yPosition + 10);
      ctx.lineTo(xPosition + columnWidth - columnPadding + 20, yPosition + 10);
      ctx.stroke();

      yPosition += 50;

      // Draw events for this date
      for (const event of events) {
        if (yPosition > 420) break; // Prevent overflow

        // Check if this is an all-day event
        const isAllDayEvent = event.datetype === "date";

        // Draw time only for non-all-day events
        if (!isAllDayEvent) {
          ctx.font = "32px Mania";
          ctx.fillStyle = "#666666";
          ctx.fillText(formatTime(event.start), xPosition, yPosition);
        }

        // Draw event title
        ctx.fillStyle = "#000000";
        ctx.font = "32px Mania";

        // Ensure summary is retrieved correctly regardless of its format
        let summary = event.summary;
        if (typeof summary === "object" && summary.val) {
          summary = summary.val; // extract the value if summary is an object
        }

        let title = removeEmojis(summary || "Untitled Event");
        // Adjust maxWidth based on whether time is displayed
        const maxWidth = isAllDayEvent ? columnWidth - 20 : columnWidth - 80;
        if (ctx.measureText(title).width > maxWidth) {
          let truncated = title;
          while (ctx.measureText(truncated + "...").width > maxWidth) {
            truncated = truncated.slice(0, -1);
          }
          title = truncated + "...";
        }

        // Position title based on whether time is displayed
        const titleXPosition = isAllDayEvent ? xPosition : xPosition + 80;
        ctx.fillText(title, titleXPosition, yPosition);
        yPosition += 45;
      }

      dayIndex++;
    }

    // Draw "No upcoming events" if there are none
    if (relevantEvents.length === 0) {
      ctx.font = "36px Mania";
      ctx.fillStyle = "#666666";
      ctx.fillText("No upcoming events", 20, 180);
    }

    // Draw vertical divider between columns
    if (groupedEvents.size > 1) {
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(columnWidth + 30, 70);
      ctx.lineTo(columnWidth + 30, 410);
      ctx.stroke();
    }

    // Draw weather forecast strip at the bottom
    const weatherStripY = 430;
    const weatherItemWidth = 160;
    const weatherIconSize = 40;

    weatherForecast.forEach((forecast, index) => {
      const x = index * weatherItemWidth;

      // Draw date
      ctx.font = "24px Mania";
      ctx.fillStyle = "#666666";
      const dateStr = forecast.date.toLocaleDateString("en-UK", {
        weekday: "short",
      });
      ctx.fillText(dateStr, x + 30, weatherStripY + 25);

      // Draw weather icon
      const weatherIcon = getWeatherIcon(forecast.weather);
      ctx.drawImage(
        weatherIcons[weatherIcon],
        x + 75,
        weatherStripY - 3,
        weatherIconSize,
        weatherIconSize
      );

      // Draw temperature
      ctx.font = "24px Mania";
      ctx.fillStyle = "#000000";
      ctx.fillText(`${forecast.temp}°`, x + 120, weatherStripY + 15);
    });

    // Draw bottom border
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 410);
    ctx.lineTo(800, 410);
    ctx.stroke();

    // Output the image
    const buffer = canvas.toBuffer("image/jpeg");
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.send(buffer);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to generate calendar image" });
  }
}
