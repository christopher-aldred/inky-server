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

function removeEmojis(text: string): string {
  return text
    .replace(
      /[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F191}-\u{1F251}\u{1F004}-\u{1F0CF}\u{1F170}-\u{1F171}\u{1F17E}-\u{1F17F}\u{1F18E}\u{3030}\u{2B50}\u{2B55}\u{2934}-\u{2935}\u{2B05}-\u{2B07}\u{2B1B}-\u{2B1C}\u{3297}\u{3299}\u{303D}\u{00A9}\u{00AE}\u{2122}\u{23F3}\u{24C2}\u{23E9}-\u{23EF}\u{25B6}\u{23F8}-\u{23FA}]/gu,
      ""
    )
    .replace(/[\uFE00-\uFE0F\u{1F3FB}-\u{1F3FF}]/gu, "") // Remove variation selectors and skin tones
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

function expandRecurringEvents(
  events: any[],
  startDate: Date,
  endDate: Date
): any[] {
  const expandedEvents: any[] = [];

  events.forEach((event) => {
    if (!event.start || !event.type || event.type !== "VEVENT") return;

    // Handle non-recurring events
    if (!event.rrule) {
      if (event.start >= startDate && event.start <= endDate) {
        expandedEvents.push(event);
      }
      return;
    }

    // Handle recurring events
    const dates = event.rrule.between(startDate, endDate);
    dates.forEach((date) => {
      expandedEvents.push({
        ...event,
        start: date,
        end: new Date(
          date.getTime() + (event.end.getTime() - event.start.getTime())
        ),
      });
    });
  });

  return expandedEvents;
}

// Calendar data fetching
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
  const response = await axios.get(url);
  const events = await ical.async.parseICS(response.data);
  return Object.values(events);
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
  try {
    const { url, type, username, password, location } = req.query;

    if (!url) {
      throw new Error("No calendar URL provided");
    }

    // Load weather icons first
    await loadWeatherIcons();

    // Fetch both calendar events and weather forecast in parallel
    const [allEvents, weatherForecast] = await Promise.all([
      type === "caldav"
        ? getCalDavEvents(url as string, username as string, password as string)
        : getIcalEvents(url as string),
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

        // Draw time
        ctx.font = "32px Mania";
        ctx.fillStyle = "#666666";
        ctx.fillText(formatTime(event.start), xPosition, yPosition);

        // Draw event title
        ctx.fillStyle = "#000000";
        ctx.font = "32px Mania";

        let title = removeEmojis(event.summary || "Untitled Event");
        const maxWidth = columnWidth - 90;
        if (ctx.measureText(title).width > maxWidth) {
          let truncated = title;
          while (ctx.measureText(truncated + "...").width > maxWidth) {
            truncated = truncated.slice(0, -1);
          }
          title = truncated + "...";
        }

        ctx.fillText(title, xPosition + 90, yPosition);
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
