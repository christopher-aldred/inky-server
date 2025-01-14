import { Handler } from "@netlify/functions";
import sharp from "sharp";
import axios from "axios";
import path from "path";
import fs from "fs/promises";

interface WeatherData {
  list: Array<{
    dt_txt: string;
    main: {
      temp: number;
      humidity: number;
    };
    weather: Array<{
      main: string;
      description: string;
    }>;
    wind: {
      speed: number;
    };
  }>;
}

interface CurrentWeather {
  main: {
    temp: number;
    humidity: number;
  };
  wind: {
    speed: number;
  };
  coord: {
    lat: number;
    lon: number;
  };
  weather: Array<{
    main: string;
    description: string;
  }>;
}

interface UVData {
  value: number;
}

const OPENWEATHER_API_KEY = "693c1f1df284ff1be69d05f2b09d015c";

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

function getTemperatureColor(temp: number): string {
  if (temp <= 0) return "#4287f5";
  if (temp <= 10) return "#2ecc71";
  if (temp <= 20) return "#f39c12";
  return "#e74c3c";
}

function generateTemperatureGraph(next24Hours: WeatherData["list"]): string {
  const graphMargin = { top: 230, right: 40, bottom: 40, left: 40 };
  const graphWidth = 800 - graphMargin.left - graphMargin.right;
  const graphHeight = 200;

  const temps = next24Hours.map((d) => d.main.temp);
  const minTemp = Math.floor(Math.min(...temps));
  const maxTemp = Math.ceil(Math.max(...temps));
  const tempRange = maxTemp - minTemp;

  // Generate points for the smooth curve
  const points = next24Hours.map((data, index) => {
    const x = graphMargin.left + index * (graphWidth / 7);
    const y =
      graphMargin.top +
      graphHeight * 0.75 * (1 - (data.main.temp - minTemp) / tempRange);
    return { x, y };
  });

  // Generate smooth curve using cubic bezier curves
  let pathD = `M ${points[0].x},${points[0].y}`;

  for (let i = 0; i < points.length - 1; i++) {
    const current = points[i];
    const next = points[i + 1];

    // Calculate control points
    const controlPoint1X = current.x + (next.x - current.x) / 3;
    const controlPoint1Y = current.y;
    const controlPoint2X = current.x + (2 * (next.x - current.x)) / 3;
    const controlPoint2Y = next.y;

    pathD += ` C ${controlPoint1X},${controlPoint1Y} ${controlPoint2X},${controlPoint2Y} ${next.x},${next.y}`;
  }

  return `
    <line x1="${graphMargin.left - 20}" y1="${graphMargin.top + graphHeight}" 
          x2="${800 - graphMargin.right + 20}" y2="${
    graphMargin.top + graphHeight
  }" 
          stroke="black" stroke-width="2"/>
    
    <path
      d="${pathD}"
      stroke="${getTemperatureColor(temps[0])}"
      stroke-width="8"
      stroke-linecap="round"
      stroke-linejoin="round"
      fill="none"
    />
    
    ${next24Hours
      .map((data, index) => {
        const x = graphMargin.left + index * (graphWidth / 7);
        const y =
          graphMargin.top +
          graphHeight * 0.75 * (1 - (data.main.temp - minTemp) / tempRange);
        const time = new Date(data.dt_txt).toLocaleTimeString("en-UK", {
          hour: "2-digit",
        });
        return `
        <text x="${x}" y="${graphMargin.top + graphHeight + 30}" 
              font-family="Mania" font-size="24" text-anchor="middle">
          ${time}
        </text>
        <text x="${x}" y="${y - 20}" 
              font-family="Mania" font-size="24" text-anchor="middle">
          ${Math.round(data.main.temp)}°C
        </text>
      `;
      })
      .join("")}
  `;
}

async function loadAndResizeIcon(
  iconName: string,
  width: number,
  height: number
) {
  const iconPath = path.join(__dirname, "..", "..", "icons", `${iconName}.png`);
  return await sharp(iconPath)
    .resize(width, height, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toBuffer();
}

const handler: Handler = async (event, context) => {
  try {
    const location = event.queryStringParameters?.location || "Sheffield,UK";

    // Get current weather to get coordinates
    const currentResponse = await axios.get<CurrentWeather>(
      `https://api.openweathermap.org/data/2.5/weather?q=${location}&appid=${OPENWEATHER_API_KEY}&units=metric`
    );

    const { lat, lon } = currentResponse.data.coord;

    // Get forecast and UV data
    const [forecastResponse, uvResponse] = await Promise.all([
      axios.get<WeatherData>(
        `https://api.openweathermap.org/data/2.5/forecast?q=${location}&appid=${OPENWEATHER_API_KEY}&units=metric`
      ),
      axios.get<UVData>(
        `http://api.openweathermap.org/data/2.5/uvi?appid=${OPENWEATHER_API_KEY}&lat=${lat}&lon=${lon}`
      ),
    ]);

    const next24Hours = forecastResponse.data.list.slice(0, 8);
    const currentWeather = currentResponse.data;
    const uvIndex = uvResponse.data.value;

    // Create base SVG
    const svg = `
      <svg width="800" height="480" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <style>
            @font-face {
              font-family: 'Mania';
              src: url('data:font/truetype;base64,${Buffer.from(
                await fs.readFile(
                  path.join(__dirname, "..", "..", "fonts", "mania.ttf")
                )
              ).toString("base64")}');
            }
          </style>
        </defs>
        <rect width="800" height="480" fill="white"/>
        
        <!-- Current Weather Title -->
        <text x="20" y="50" font-family="Mania" font-size="42" fill="black">
          Current Weather in ${location.split(",")[0]}
        </text>

        <!-- Current Temperature -->
        <text x="135" y="145" font-family="Mania" font-size="42" fill="black">
          ${Math.round(currentWeather.main.temp)}°C
        </text>

        <!-- Weather Details -->
        <text x="230" y="114" font-family="Mania" font-size="32" fill="black">
          Wind Speed: ${Math.round(currentWeather.wind.speed * 3.6)} km/h
        </text>
        <text x="230" y="150" font-family="Mania" font-size="32" fill="black">
          Humidity: ${currentWeather.main.humidity}%
        </text>
        <text x="230" y="186" font-family="Mania" font-size="32" fill="black">
          UV Index: ${uvIndex.toFixed(1)}
        </text>

        <!-- Temperature Graph -->
        ${generateTemperatureGraph(next24Hours)}
      </svg>
    `;

    // Convert SVG to base image
    const baseImage = await sharp(Buffer.from(svg)).png().toBuffer();

    // Prepare composite operations
    const compositeOperations = [];

    // Add current weather icon
    const currentIconName = getWeatherIcon(currentWeather.weather[0].main);
    const currentIcon = await loadAndResizeIcon(currentIconName, 110, 110);
    compositeOperations.push({
      input: currentIcon,
      top: 80,
      left: 20,
    });

    // Add forecast weather icons
    for (let i = 0; i < next24Hours.length; i++) {
      const data = next24Hours[i];
      const iconName = getWeatherIcon(data.weather[0].main);
      const icon = await loadAndResizeIcon(iconName, 40, 40);
      const left = Math.round(40 + i * (720 / 7) - 20);

      compositeOperations.push({
        input: icon,
        top: 380,
        left,
      });
    }

    // Create final image with all icons
    const finalImage = await sharp(baseImage)
      .composite(compositeOperations)
      .jpeg()
      .toBuffer();

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=300",
      },
      body: finalImage.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to generate weather image",
        details: (error as Error).message,
        stack: (error as Error).stack,
      }),
    };
  }
};

export { handler };
