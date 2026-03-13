import type { NextApiRequest, NextApiResponse } from "next";
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

function formatDate(dateStr: string): string {
	const date = new Date(dateStr);
	return date.toLocaleDateString("en-UK", {
		weekday: "short",
		day: "numeric",
	});
}

function removeEmojis(text: string): string {
	if (typeof text !== "string") return "";

	return text
		.replace(
			/[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F191}-\u{1F251}\u{1F004}-\u{1F0CF}\u{1F170}-\u{1F171}\u{1F17E}-\u{1F17F}\u{1F18E}\u{3030}\u{2B50}\u{2B55}\u{2934}-\u{2935}\u{2B05}-\u{2B07}\u{2B1B}-\u{2B1C}\u{3297}\u{3299}\u{303D}\u{00A9}\u{00AE}\u{2122}\u{23F3}\u{24C2}\u{23E9}-\u{23EF}\u{25B6}\u{23F8}-\u{23FA}]/gu,
			"",
		)
		.replace(/[\uFE00-\uFE0F\u{1F3FB}-\u{1F3FF}]/gu, "")
		.replace(/\s+/g, " ")
		.trim();
}

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

	return events.sort((a, b) => {
		const dateCompare = new Date(a.date).getTime() - new Date(b.date).getTime();
		if (dateCompare !== 0) return dateCompare;

		if (a.isAllDay && !b.isAllDay) return -1;
		if (!a.isAllDay && b.isAllDay) return 1;
		if (a.isAllDay && b.isAllDay) return 0;

		return a.time.localeCompare(b.time);
	});
}

function groupEventsByDate(
	events: ProcessedEvent[],
): Map<string, ProcessedEvent[]> {
	const groupedByDate = new Map<string, ProcessedEvent[]>();

	// Group by the raw YYYY-MM-DD date key for stable ordering
	events.forEach((event) => {
		groupedByDate.set(event.date, [
			...(groupedByDate.get(event.date) ?? []),
			event,
		]);
	});

	const today = new Date();
	today.setHours(0, 0, 0, 0);

	// Collect the earliest 4 upcoming event dates (inclusive of today)
	const desiredDateKeys = Array.from(groupedByDate.keys())
		.filter((dateKey) => new Date(dateKey).getTime() >= today.getTime())
		.sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
		.slice(0, 4);

	const finalEvents = new Map<string, ProcessedEvent[]>();

	desiredDateKeys.forEach((dateKey) => {
		finalEvents.set(formatDate(dateKey), groupedByDate.get(dateKey) ?? []);
	});

	return finalEvents;
}

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	try {
		const { location, url } = req.query;

		let calendarData: CalendarData = {};

		if (Array.isArray(url)) {
			calendarData = await convertCalendarsToJSON(url);
		} else if (typeof url === "string") {
			calendarData = await convertCalendarsToJSON([url]);
		}

		await loadWeatherIcons();

		const [processedEvents, weatherForecast] = await Promise.all([
			Promise.resolve(processCalendarData(calendarData)),
			getWeatherForecast(location as string),
		]);

		const groupedEvents = groupEventsByDate(processedEvents);

		const canvasWidth = 1200;
		const canvasHeight = 1600;
		const contentYOffset = canvasHeight / 2; // place existing layout in bottom half

		const canvas = createCanvas(canvasWidth, canvasHeight);
		const ctx = canvas.getContext("2d");

		// Fill full background before scaling
		ctx.fillStyle = "#ffffff";
		ctx.fillRect(0, 0, canvasWidth, canvasHeight);

		// Draw background image on the top half using object-fit: cover behavior
		try {
			const photoNumber = Math.floor(Math.random() * 16) + 1;
			const bgImage = await loadImage(
				path.join(process.cwd(), "public", "photos", `${photoNumber}.jpeg`),
			);

			const targetW = canvasWidth;
			const targetH = contentYOffset;
			const imgAspect = bgImage.width / bgImage.height;
			const targetAspect = targetW / targetH;

			let drawW = targetW;
			let drawH = targetH;
			let offsetX = 0;
			let offsetY = 0;

			if (imgAspect > targetAspect) {
				// image is wider than target; crop width
				drawH = targetH;
				drawW = drawH * imgAspect;
				offsetX = -(drawW - targetW) / 2;
			} else {
				// image is taller than target; crop height
				drawW = targetW;
				drawH = drawW / imgAspect;
				offsetY = -(drawH - targetH) / 2;
			}

			// Clip to top half to prevent bleed into calendar area
			ctx.save();
			ctx.beginPath();
			ctx.rect(0, 0, targetW, targetH);
			ctx.clip();
			ctx.drawImage(bgImage, offsetX, offsetY, drawW, drawH);
			ctx.restore();
		} catch (e) {
			// If the image is missing, fall back to white background without throwing
			console.warn("photo background not found or failed to load", e);
		}

		// Scale factors to make better use of the bottom half
		const scaleX = canvasWidth / 800; // base width was 800
		const scaleY = canvasHeight / 2 / 480; // base height was 480 for bottom half
		ctx.scale(scaleX, scaleY);

		// All drawing below uses scaled coordinates; adjust offsets accordingly
		const scaledYOffset = contentYOffset / scaleY;

		// Header
		ctx.fillStyle = "#FF0000";
		ctx.font = "42px Mania";
		ctx.fillText("Calendar events", 20, scaledYOffset + 50);

		const now = new Date();
		const dateStr = now.toLocaleDateString("en-UK", {
			day: "numeric",
			month: "short",
			year: "numeric",
		});

		ctx.font = "32px Mania";
		ctx.fillStyle = "#666";
		const dateWidth = ctx.measureText(dateStr).width;
		ctx.fillText(
			dateStr,
			canvasWidth / scaleX - dateWidth - 20,
			scaledYOffset + 50,
		);

		// ---- 4 COLUMN LAYOUT ----
		const totalColumns = 4;
		const horizontalPadding = 20;
		const columnGutter = 10; // extra spacing to avoid overlap/ellipsis clipping
		const dividerPadding = 12; // gap between divider and next column on the right
		const usableWidth =
			canvasWidth / scaleX -
			horizontalPadding * 2 -
			columnGutter * (totalColumns - 1);
		const columnWidth = usableWidth / totalColumns;
		const dividerOffset = -dividerPadding; // shift left to leave right-side gap
		const weatherStripY = scaledYOffset + 395; // keep overall placement
		const lineHeight = 25;
		const maxContentY = weatherStripY - lineHeight - 0; // reduce gap above weather strip

		let dayIndex = 0;

		for (const [date, events] of groupedEvents) {
			if (dayIndex >= totalColumns) break;

			const xPosition =
				horizontalPadding + dayIndex * (columnWidth + columnGutter);
			let yPosition = scaledYOffset + 90; // modestly reduce top padding inside calendar grid

			ctx.fillStyle = "#000";
			ctx.font = "26px Mania";
			ctx.fillText(date, xPosition, yPosition);

			ctx.strokeStyle = "#000";
			ctx.beginPath();
			ctx.moveTo(xPosition, yPosition + 10);
			ctx.lineTo(xPosition + columnWidth - 14, yPosition + 10);
			ctx.stroke();

			yPosition += 40;

			for (const event of events) {
				if (yPosition + lineHeight > maxContentY) break;

				if (!event.isAllDay) {
					ctx.font = "18px Mania";
					ctx.fillStyle = "#666";
					ctx.fillText(event.time, xPosition, yPosition);
				}

				ctx.fillStyle = "#000";
				ctx.font = "18px Mania";

				let title = event.title;
				const maxWidth = event.isAllDay ? columnWidth - 10 : columnWidth - 55;

				while (
					title.length > 0 &&
					ctx.measureText(title + "...").width > maxWidth
				) {
					title = title.slice(0, -1);
				}

				if (title !== event.title) title += "...";

				const titleX = event.isAllDay ? xPosition : xPosition + 50;

				ctx.fillText(title, titleX, yPosition);
				yPosition += lineHeight;
			}

			dayIndex++;
		}

		// Vertical dividers
		ctx.strokeStyle = "#000";
		for (let i = 1; i < totalColumns; i++) {
			const dividerX =
				horizontalPadding + i * (columnWidth + columnGutter) + dividerOffset;
			ctx.beginPath();
			ctx.moveTo(dividerX, scaledYOffset + 70);
			ctx.lineTo(dividerX, maxContentY + 10);
			ctx.stroke();
		}

		// Weather forecast strip at the bottom (matches calendar-image.ts style)
		const weatherItemWidth = 160;
		const weatherIconSize = 40;

		// Bottom border for the main grid above the strip
		ctx.beginPath();
		ctx.moveTo(0, scaledYOffset + 380);
		ctx.lineTo(canvasWidth / scaleX, scaledYOffset + 380);
		ctx.stroke();

		weatherForecast.forEach((forecast, index) => {
			const x = index * weatherItemWidth;

			// Date label
			ctx.font = "24px Mania";
			ctx.fillStyle = "#666666";
			const weatherDateStr = forecast.date.toLocaleDateString("en-UK", {
				weekday: "short",
			});
			ctx.fillText(weatherDateStr, x + 30, weatherStripY + 25);

			// Weather icon
			const weatherIcon = getWeatherIcon(forecast.weather);
			ctx.drawImage(
				weatherIcons[weatherIcon],
				x + 75,
				weatherStripY - 3,
				weatherIconSize,
				weatherIconSize,
			);

			// Temperature label
			ctx.font = "24px Mania";
			ctx.fillStyle = "#000000";
			ctx.fillText(`${forecast.temp}°`, x + 120, weatherStripY + 15);
		});

		// Rotate final output 90deg the other way so final image is 1600x1200 (landscape)
		const rotatedCanvas = createCanvas(canvasHeight, canvasWidth);
		const rctx = rotatedCanvas.getContext("2d");
		rctx.translate(canvasHeight, 0);
		rctx.rotate(Math.PI / 2);
		rctx.drawImage(canvas, 0, 0);

		const buffer = rotatedCanvas.toBuffer("image/jpeg");
		res.setHeader("Content-Type", "image/jpeg");
		res.send(buffer);
	} catch (error: any) {
		res.status(500).json({
			error: "Failed to generate calendar image",
			details: error.message,
		});
	}
}
