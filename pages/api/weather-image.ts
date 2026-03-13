import type { NextApiRequest, NextApiResponse } from "next";
import { createCanvas, registerFont } from "canvas";
import path from "node:path";
import { fetchWeatherApi } from "openmeteo";
import {
	geocodeLocation,
	getWeatherIcon,
	loadWeatherIcons,
	NIGHT_ICON_TYPES,
	weatherIcons,
	mapWeatherCodeToDescription,
	mapWeatherCodeToMain,
} from "../../utils/weather";

// Register Mania font
const fontPath = path.join(process.cwd(), "public", "fonts", "mania.ttf");
registerFont(fontPath, { family: "Mania" });

type HourlyEntry = {
	dt: number;
	dt_txt: string;
	main: { temp?: number; humidity?: number };
	weather: Array<{ main: string; description: string }>;
	wind: { speed?: number };
	rain?: { "3h"?: number };
	snow?: { "3h"?: number };
	sun?: { sunrise?: number; sunset?: number };
};

function capitalize(s: string) {
	return String(s[0]).toUpperCase() + String(s).slice(1);
}

function toUnixSeconds(input?: string | number | Date): number {
	if (!input) return Math.floor(Date.now() / 1000);
	const date = typeof input === "string" ? new Date(input) : new Date(input);
	return Math.floor(date.getTime() / 1000);
}

function getCurvePoints(points: Array<[number, number]>, tension = 0.3) {
	const res: Array<[number, number]> = [];

	for (let i = 0; i < points.length - 1; i++) {
		const p0 = i > 0 ? points[i - 1] : points[i];
		const p1 = points[i];
		const p2 = points[i + 1];
		const p3 = i < points.length - 2 ? points[i + 2] : p2;

		for (let t = 0; t <= 1; t += 0.01) {
			const t2 = t * t;
			const t3 = t2 * t;

			const x =
				0.5 *
				(2 * p1[0] +
					(-p0[0] + p2[0]) * t +
					(2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
					(-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);

			const y =
				0.5 *
				(2 * p1[1] +
					(-p0[1] + p2[1]) * t +
					(2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
					(-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);

			res.push([x, y]);
		}
	}
	return res;
}

function getTemperatureColor(temp: number): string {
	if (temp <= 0) return "#0096FF";
	if (temp <= 10) return "#AAFF00";
	if (temp <= 20) return "#FFA500";
	return "#e74c3c";
}

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	try {
		const location = (req.query.location as string) || "London,UK";

		// Load weather icons before proceeding (include moon for night)
		await loadWeatherIcons(NIGHT_ICON_TYPES);

		const { latitude, longitude, timezone } = await geocodeLocation(location);

		const url = "https://api.open-meteo.com/v1/forecast";
		const params = {
			latitude,
			longitude,
			timezone: timezone || "auto",
			current: [
				"temperature_2m",
				"relative_humidity_2m",
				"apparent_temperature",
				"is_day",
				"precipitation",
				"rain",
				"snowfall",
				"weather_code",
				"wind_speed_10m",
				"uv_index",
			],
			hourly: [
				"temperature_2m",
				"precipitation",
				"rain",
				"snowfall",
				"weather_code",
				"uv_index",
				"wind_speed_10m",
				"relative_humidity_2m",
			],
			daily: ["sunrise", "sunset", "uv_index_max", "weather_code"],
			forecast_days: 5,
		};

		const responses = await fetchWeatherApi(url, params);
		const response = responses[0];

		if (!response) {
			throw new Error("No weather response received from Open-Meteo");
		}

		const utcOffsetSeconds = response.utcOffsetSeconds();

		const current = response.current();
		const daily = response.daily();
		const hourly = response.hourly();

		const dailyWeatherCodes = daily?.variables(3)?.valuesArray?.() ?? [];
		const dailySunrise = daily?.variables(0)?.valuesArray?.() ?? [];
		const dailySunset = daily?.variables(1)?.valuesArray?.() ?? [];
		const dailyUvMax = daily?.variables(2)?.valuesArray?.() ?? [];

		const weatherCodeCurrent = Number(current?.variables(7)?.value() ?? 0);
		const currentWeather = {
			main: {
				temp: Number(current?.variables(0)?.value() ?? 0),
				humidity: Number(current?.variables(1)?.value() ?? 0),
				feels_like: Number(current?.variables(2)?.value() ?? 0),
			},
			wind: {
				speed: Number(current?.variables(8)?.value() ?? 0),
			},
			weather: [
				{
					main: mapWeatherCodeToMain(weatherCodeCurrent),
					description: mapWeatherCodeToDescription(weatherCodeCurrent),
				},
			],
			sys: {
				sunrise:
					dailySunrise?.[0] !== undefined ? Number(dailySunrise[0]) : undefined,
				sunset:
					dailySunset?.[0] !== undefined ? Number(dailySunset[0]) : undefined,
			},
			time: current?.time() !== undefined ? Number(current.time()) : undefined,
		};

		const hourlyTimes: number[] = (() => {
			if (!hourly) return [];
			const start = Number(hourly.time());
			const end = Number(hourly.timeEnd());
			const interval = hourly.interval();
			const len = (end - start) / interval;
			return Array.from({ length: len }, (_, i) => start + i * interval);
		})();

		const next24Hours: HourlyEntry[] = hourlyTimes.slice(0, 24).map((t, i) => {
			const date = new Date((t + utcOffsetSeconds) * 1000);
			const dayIdx = daily?.time()
				? Math.floor((t - Number(daily.time())) / 86400)
				: 0;
			const sunrise = dailySunrise?.[dayIdx];
			const sunset = dailySunset?.[dayIdx];
			const weatherCode = Number(hourly?.variables(4)?.valuesArray()?.[i] ?? 0);
			return {
				dt: Number(t),
				dt_txt: date.toISOString(),
				main: {
					temp: Number(hourly?.variables(0)?.valuesArray()?.[i] ?? 0),
					humidity: Number(hourly?.variables(7)?.valuesArray()?.[i] ?? 0),
				},
				weather: [
					{
						main: mapWeatherCodeToMain(weatherCode),
						description: mapWeatherCodeToDescription(weatherCode),
					},
				],
				wind: { speed: Number(hourly?.variables(6)?.valuesArray()?.[i] ?? 0) },
				rain: { "3h": Number(hourly?.variables(2)?.valuesArray()?.[i] ?? 0) },
				snow: { "3h": Number(hourly?.variables(3)?.valuesArray()?.[i] ?? 0) },
				sun: {
					sunrise: sunrise !== undefined ? Number(sunrise) : undefined,
					sunset: sunset !== undefined ? Number(sunset) : undefined,
				},
			};
		});

		const uvIndex =
			dailyUvMax?.[0] ?? hourly?.variables(5)?.valuesArray?.()?.[0] ?? 0;

		// Calculate total precipitation over the next 24 hours
		const precipitation = next24Hours.reduce((total, data) => {
			return total + (data.rain?.["3h"] || 0) + (data.snow?.["3h"] || 0);
		}, 0);

		const canvas = createCanvas(800, 480);
		const ctx = canvas.getContext("2d");

		// Set white background
		ctx.fillStyle = "#ffffff";
		ctx.fillRect(0, 0, 800, 480);

		// Draw current weather information in top half
		ctx.fillStyle = "#FF0000";
		ctx.textBaseline = "top";

		// Current weather title
		ctx.font = "42px Mania";
		const now = new Date();
		const dateTimeFormatter = new Intl.DateTimeFormat("en-UK", {
			timeZone: "Europe/London",
			weekday: "short",
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		});
		const formattedDateTimeStr = dateTimeFormatter.format(now);
		ctx.fillText(
			`Weather ${location.split(",")[0]}, ${formattedDateTimeStr}`,
			20,
			15,
		);

		ctx.fillStyle = "#000000";

		// Current weather details
		ctx.font = "42px Mania";
		const currentTemp = `${Math.round(currentWeather.main.temp ?? 0)}°C`;

		const iconSize = 130;
		const weatherIcon = getWeatherIcon(currentWeather.weather[0].main, {
			timestamp: currentWeather.time
				? Math.floor(currentWeather.time)
				: Math.floor(Date.now() / 1000),
			sunrise: currentWeather.sys.sunrise,
			sunset: currentWeather.sys.sunset,
			includeNight: true,
		});

		// Calculate positions for right alignment
		const tempWidth = ctx.measureText(currentTemp).width;
		const rightMargin = 20; // Space from right edge
		const tempX = canvas.width - rightMargin - tempWidth;
		const iconX = canvas.width - rightMargin - iconSize;

		// Draw temperature and icon
		ctx.fillText(currentTemp, tempX, 15);
		ctx.drawImage(weatherIcons[weatherIcon], iconX, 60, iconSize, iconSize);

		ctx.font = "32px Mania";
		const windSpeedKmh = Math.round((currentWeather.wind.speed ?? 0) * 3.6);

		// Wind Speed
		ctx.fillStyle = "#666666";
		ctx.fillText("Wind Speed: ", 20, 72);
		ctx.fillStyle = windSpeedKmh > 60 ? "#FF0000" : "#000000";
		ctx.fillText(`${windSpeedKmh} km/h`, 190, 72);

		// Humidity
		ctx.fillStyle = "#666666";
		ctx.fillText("Humidity: ", 20, 108);
		ctx.fillStyle = "#000000";
		ctx.fillText(`${Math.round(currentWeather.main.humidity ?? 0)}%`, 150, 108);

		// Feels Like
		ctx.fillStyle = "#666666";
		ctx.fillText("Feels Like: ", 20, 144);
		ctx.fillStyle = "#000000";
		ctx.fillText(
			`${Math.round(currentWeather.main.feels_like ?? 0)}°C`,
			175,
			144,
		);

		// Rain
		ctx.fillStyle = "#666666";
		const rainTextStart =
			20 +
			ctx.measureText("Wind Speed: ").width +
			ctx.measureText(`${windSpeedKmh} km/h`).width +
			40;
		ctx.fillText("Rain: ", rainTextStart, 72);
		ctx.fillStyle = "#000000";
		ctx.fillText(
			`${precipitation.toFixed(1)} mm`,
			rainTextStart + ctx.measureText("Rain: ").width,
			72,
		);

		// UV Index
		ctx.fillStyle = "#666666";
		ctx.fillText("UV Index: ", rainTextStart, 108);
		ctx.fillStyle = "#000000";
		ctx.fillText(
			uvIndex.toFixed(1),
			rainTextStart + ctx.measureText("UV Index: ").width,
			108,
		);

		// Weather Description
		ctx.fillStyle = "#000000";
		ctx.fillText(
			capitalize(currentWeather.weather[0].description),
			rainTextStart,
			144,
		);

		// Draw forecast graph in bottom half
		const graphMargin = { top: 230, right: 40, bottom: 40, left: 40 };
		const graphWidth = canvas.width - graphMargin.left - graphMargin.right;
		const graphHeight = 200;
		const graphBottom = graphHeight + graphMargin.top;

		// Find temperature range
		const temps = next24Hours.map((d) => d.main.temp ?? 0);
		const minTemp = Math.floor(Math.min(...temps));
		const maxTemp = Math.ceil(Math.max(...temps));
		const tempRange = Math.max(1, maxTemp - minTemp);

		// Draw X-axis
		ctx.strokeStyle = "#000000";
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(graphMargin.left - 20, graphBottom);
		ctx.lineTo(canvas.width - graphMargin.right + 20, graphBottom);
		ctx.stroke();

		// Add bottom padding percentage
		const bottomPaddingPercentage = 0.3;

		// Collect points for the curve
		const points: Array<[number, number]> = next24Hours.map(
			(data: HourlyEntry, index: number) => {
				const x = graphMargin.left + index * (graphWidth / 7);
				const tempForPoint = data.main.temp ?? minTemp;
				const y =
					graphMargin.top +
					graphHeight *
						(1 - bottomPaddingPercentage) *
						(1 - (tempForPoint - minTemp) / tempRange);
				return [x, y];
			},
		);

		// Draw smooth curve with color segments
		const curvePoints = getCurvePoints(points);
		for (let i = 0; i < curvePoints.length - 1; i++) {
			const currentPoint = curvePoints[i];
			const nextPoint = curvePoints[i + 1];

			const progress = (currentPoint[1] - graphMargin.top) / graphHeight;
			const temp = maxTemp - progress * tempRange;

			ctx.beginPath();
			ctx.strokeStyle = getTemperatureColor(temp);
			ctx.lineWidth = 8;
			ctx.lineCap = "round";
			ctx.lineJoin = "round";
			ctx.moveTo(currentPoint[0], currentPoint[1]);
			ctx.lineTo(nextPoint[0], nextPoint[1]);
			ctx.stroke();
		}

		// Draw labels and icons for forecast points
		next24Hours.forEach((data: HourlyEntry, index: number) => {
			const x = graphMargin.left + index * (graphWidth / 7);

			const curvePoint = curvePoints.find(
				(point) => Math.abs(point[0] - x) < 1,
			);
			const y = curvePoint ? curvePoint[1] : points[index][1];

			// Time labels
			ctx.fillStyle = "#000000";
			ctx.font = "24px Mania";
			const time = new Date(data.dt * 1000).toLocaleTimeString("en-UK", {
				timeZone: "Europe/London",
				hour: "2-digit",
			});
			ctx.save();
			ctx.translate(x - 10, graphBottom + 10);
			ctx.fillText(time, 0, 0);
			ctx.restore();

			// Temperature labels
			ctx.fillText(`${Math.round(data.main.temp ?? 0)}°C`, x - 15, y - 40);

			// Weather icons for forecast points
			const weatherIcon = getWeatherIcon(data.weather[0].main, {
				timestamp: data.dt,
				sunrise: data.sun?.sunrise ?? currentWeather.sys.sunrise,
				sunset: data.sun?.sunset ?? currentWeather.sys.sunset,
				includeNight: true,
			});
			const smallIconSize = 40;
			ctx.drawImage(
				weatherIcons[weatherIcon],
				x - smallIconSize / 2,
				graphBottom - smallIconSize - 10,
				smallIconSize,
				smallIconSize,
			);
		});

		const buffer = canvas.toBuffer("image/jpeg");
		res.setHeader("Content-Type", "image/jpeg");
		res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
		res.setHeader("Pragma", "no-cache");
		res.setHeader("Expires", "0");
		res.send(buffer);
	} catch (error) {
		console.error("Error:", error);
		res.status(500).json({ error: "Failed to generate weather image" });
	}
}
