# Sheffield Weather Forecast Image Generator

A TypeScript application that generates a dynamic weather forecast image for Sheffield, UK. The application uses the Open-Meteo API to fetch weather data and generates an 800x480 JPEG image showing the next 24 hours of weather conditions.

## Features

- Dynamic image generation (800x480 JPEG)
- 24-hour weather forecast for Sheffield
- Auto-refreshing forecast every 5 minutes
- Serverless deployment on Netlify

## Weather Display Information

### Current Weather (Top Section)

All values in the top section represent **current conditions** at the time of the request:

- **Temperature**: Current temperature in Celsius (large display, top right)
- **Wind Speed**: Current wind speed in km/h (displayed in red if exceeds 60 km/h)
- **Humidity**: Current relative humidity percentage
- **Feels Like**: Current apparent temperature in Celsius (accounting for wind chill and humidity)
- **Rain**: Total precipitation expected over the next 24 hours in millimeters
- **UV Index**: Maximum UV index for the current day
- **Weather Description**: Current weather condition (e.g., "Clear sky", "Light rain")
- **Weather Icon**: Visual representation of current conditions (includes moon icon for clear nights)

### Forecast Graph (Bottom Section)

The graph displays an **8-point forecast** covering the next 16 hours:

- **X-axis**: Time labels starting from the current hour in 2-hour increments (e.g., if current time is 14:00, shows 14, 16, 18, 20, 22, 00, 02, 04)
- **Temperature Curve**: Color-coded temperature trend
  - Blue: ≤0°C
  - Yellow-green: 1-10°C
  - Orange: 11-20°C
  - Red: >20°C
- **Temperature Labels**: Forecasted temperature at each 2-hour interval
- **Weather Icons**: Forecasted conditions at each time point (includes day/night variations)

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Start the development server:

```bash
npm run dev
```

3. Visit http://localhost:8888 to view the weather forecast.

## Deployment

This project is configured for deployment on Netlify. To deploy:

1. Create a new site on Netlify
2. Connect your repository
3. The site will automatically build and deploy when changes are pushed to the repository.

**Note:** This application uses the Open-Meteo API which does not require an API key.

## API Endpoint

The weather forecast image is available at:

- Local: http://localhost:8888/api/weather-image
- Production: https://[your-netlify-site].netlify.app/api/weather-image

## Technology Stack

- TypeScript
- Node.js Canvas for image generation
- Netlify Functions (Next.js API Routes)
- Open-Meteo API (free weather data, no API key required)
