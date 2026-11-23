import type { NextApiRequest, NextApiResponse } from "next";
import { createCanvas } from "@napi-rs/canvas";
import { convertCalendarsToJSON } from "../../utils/cal";
import type { CalendarData } from "../../utils/cal.types";
import {
	getWeatherForecast,
	getWeatherIcon,
	loadWeatherIcons,
	weatherIcons,
} from "../../utils/weather";
import { registerManiaFont } from "../../utils/canvas";
import {
	processCalendarData,
	groupEventsByDateTwoColumn,
} from "../../utils/calendar-processing";
import { CALENDAR_TIMEZONE } from "../../utils/calendar-events";
import { firstQueryValue, queryValues } from "../../utils/query";

// Register Mania font
registerManiaFont();

// Main handler
export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	console.log("Calendar image API request received");

	try {
		const location = firstQueryValue(req.query.location);
		const urls = queryValues(req.query.url);

		// Parse calendar data from query parameter. (Don't log the events
		// themselves: they're private and end up in the hosting logs.)
		const calendarData: CalendarData =
			urls.length > 0 ? await convertCalendarsToJSON(urls) : {};

		// Load weather icons first
		await loadWeatherIcons();

		// Process calendar data and get weather forecast in parallel
		const [processedEvents, weatherForecast] = await Promise.all([
			Promise.resolve(processCalendarData(calendarData)),
			getWeatherForecast(location),
		]);

		console.log("Processed events:", processedEvents.length);

		// Group events by date
		const groupedEvents = groupEventsByDateTwoColumn(processedEvents);

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
		const dateStr = now.toLocaleDateString("en-GB", {
			day: "numeric",
			month: "short",
			year: "numeric",
			timeZone: CALENDAR_TIMEZONE,
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
				// Stop above the border line at y=410 (text is drawn up from its
				// baseline, so a row at 420 would sit on top of the line).
				if (yPosition > 400) break;

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
			// forecast.date is shifted so its UTC date is the local date
			const dateStr = forecast.date.toLocaleDateString("en-GB", {
				weekday: "short",
				timeZone: "UTC",
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
		// Always answer: a non-Error throw used to leave the request hanging.
		console.error("Error:", error);
		res.status(500).json({
			error: "Failed to generate calendar image",
			details: error instanceof Error ? error.message : String(error),
		});
	}
}
