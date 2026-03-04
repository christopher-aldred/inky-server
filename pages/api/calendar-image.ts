import { NextApiRequest, NextApiResponse } from "next";
import { createCanvas, registerFont, loadImage } from "canvas";
import path from "path";
import { convertCalendarsToJSON } from "../../utils/cal";
import type { CalendarData } from "../../utils/cal.types";
import {
  getWeatherForecast,
  getWeatherIcon,
  loadWeatherIcons,
  weatherIcons,
} from "../../utils/weather";

// Register Mania font
const fontPath = path.join(process.cwd(), "public", "fonts", "mania.ttf");
registerFont(fontPath, { family: "Mania" });

interface ProcessedEvent {
  date: string;
  time: string;
  title: string;
  isAllDay: boolean;
}

// Helper functions for dates and formatting
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-UK", {
    weekday: "short",
    day: "numeric",
  });
}

function removeEmojis(text: string): string {
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

// Process calendar data into events
function processCalendarData(calendarData: CalendarData): ProcessedEvent[] {
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

  // Sort events by date and time
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

// Group events by date
function groupEventsByDate(
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

// Main handler
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  console.log("Calendar image API request received");

  try {
    const { location, url } = req.query;

    // Parse calendar data from query parameter
    let calendarData: CalendarData = {};

    if (Array.isArray(url)) {
      calendarData = await convertCalendarsToJSON(url);
      console.log(JSON.stringify(calendarData, null, 2));
    } else if (typeof url === "string") {
      calendarData = await convertCalendarsToJSON([url]);
    }
    console.log("Calendar data received:", calendarData);

    // Load weather icons first
    await loadWeatherIcons();

    // Process calendar data and get weather forecast in parallel
    const [processedEvents, weatherForecast] = await Promise.all([
      Promise.resolve(processCalendarData(calendarData)),
      getWeatherForecast(location as string),
    ]);

    console.log("Processed events:", processedEvents.length);

    // Group events by date
    const groupedEvents = groupEventsByDate(processedEvents);

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

    const now = new Date();
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

        // Draw time only for non-all-day events
        if (!event.isAllDay) {
          ctx.font = "32px Mania";
          ctx.fillStyle = "#666666";
          ctx.fillText(event.time, xPosition, yPosition);
        }

        // Draw event title
        ctx.fillStyle = "#000000";
        ctx.font = "32px Mania";

        let title = event.title;

        // Adjust maxWidth based on whether time is displayed
        const maxWidth = event.isAllDay ? columnWidth - 20 : columnWidth - 80;
        if (ctx.measureText(title).width > maxWidth) {
          let truncated = title;
          while (ctx.measureText(truncated + "...").width > maxWidth) {
            truncated = truncated.slice(0, -1);
          }
          title = truncated + "...";
        }

        // Position title based on whether time is displayed
        const titleXPosition = event.isAllDay ? xPosition : xPosition + 80;
        ctx.fillText(title, titleXPosition, yPosition);
        yPosition += 45;
      }

      dayIndex++;
    }

    // Draw "No upcoming events" if there are none
    if (processedEvents.length === 0) {
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
        weatherIconSize,
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
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error("Error:", error);
      res.status(500).json({
        error: "Failed to generate calendar image",
        details: error.message,
      });
    }
  }
}
