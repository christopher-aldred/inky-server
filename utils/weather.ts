import path from "path";
import axios from "axios";
import { loadImage } from "canvas";

export const BASE_ICON_TYPES = [
  "clear",
  "cloudy",
  "fog",
  "rain",
  "snow",
  "thunderstorm",
];

export const NIGHT_ICON_TYPES = [...BASE_ICON_TYPES, "moon"];

export const weatherIcons: Record<string, any> = {};

async function loadIcon(type: string): Promise<void> {
  if (weatherIcons[type]) return;

  weatherIcons[type] = await loadImage(
    path.join(process.cwd(), "public", "icons", `${type}.png`),
  );
}

export async function loadWeatherIcons(iconTypes = BASE_ICON_TYPES) {
  await Promise.all(iconTypes.map((type) => loadIcon(type)));
  return weatherIcons;
}

export interface WeatherForecast {
  date: Date;
  temp: number;
  weather: string;
}

const OPENWEATHER_API_KEY =
  process.env.OPENWEATHER_API_KEY || "693c1f1df284ff1be69d05f2b09d015c";

export async function getWeatherForecast(
  location: string = "Sheffield,UK",
): Promise<WeatherForecast[]> {
  const response = await axios.get(
    `https://api.openweathermap.org/data/2.5/forecast?q=${location}&appid=${OPENWEATHER_API_KEY}&units=metric`,
  );

  const dailyForecasts: WeatherForecast[] = [];
  const processedDates = new Set<string>();

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

function isNighttime(timestamp: number, sunrise: number, sunset: number): boolean {
  const now = new Date(timestamp * 1000);
  const currentTime = now.getUTCHours() * 3600 + now.getUTCMinutes() * 60;

  const sunriseTime = new Date(sunrise * 1000);
  const sunriseSeconds =
    sunriseTime.getUTCHours() * 3600 + sunriseTime.getUTCMinutes() * 60;

  const sunsetTime = new Date(sunset * 1000);
  const sunsetSeconds =
    sunsetTime.getUTCHours() * 3600 + sunsetTime.getUTCMinutes() * 60;

  return currentTime > sunsetSeconds || currentTime < sunriseSeconds;
}

export function getWeatherIcon(
  weatherMain: string,
  options?: {
    timestamp?: number;
    sunrise?: number;
    sunset?: number;
    includeNight?: boolean;
  },
): string {
  const main = weatherMain?.toLowerCase?.() ?? "clear";

  if (
    options?.includeNight &&
    options.timestamp &&
    options.sunrise &&
    options.sunset &&
    main === "clear" &&
    isNighttime(options.timestamp, options.sunrise, options.sunset)
  ) {
    return "moon";
  }

  switch (main) {
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
