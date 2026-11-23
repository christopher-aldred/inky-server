# Inky Server

Generates 800×480 images for an e-ink display: a weather screen (default London, UK) and calendar screens.

## Features

- Dynamic image generation (800x480 JPEG)
- Weather forecast with Met Office and aurora alerts
- Auto-refreshing forecast every 5 minutes
- Serverless deployment on Netlify

## Weather Display Information

### Header

- **Title**: location, day and time (red), with the current temperature on the right.
- **Alert banner** replaces the title row when needed (temperature stays on the right):
  - **Red Met Office warning**: solid red bar, e.g. "RED warning: Wind"
  - **Amber Met Office warning**: white bar with a red border
  - **Aurora**: solid red bar, e.g. "Aurora likely tonight! Kp 7"

  A weather warning wins over an aurora alert; yellow warnings are ignored.

### Current conditions

| Left | Right |
| --- | --- |
| Wind speed (km/h) and compass direction | Rain expected over the next 24h (mm) |
| Gusts (red above 60 km/h) | Humidity |
| Feels like | Next sunrise/sunset, or UV by day when it's 3+ |

The big icon shows current conditions (moon on clear nights).

### Forecast graph

- 8 points, every **3 hours** from the current hour (about 21 hours).
- Temperature line coloured by temperature, blending blue (≤ -2°C) → green (5°C) → orange (15°C) → red (24°C+), running edge to edge.
- Only the **high and low** are labelled, in red.
- **Night shading** (dots) from sunset to sunrise, and a dashed **midnight divider** labelled with the new day.
- Icons, hour labels and **chance of rain** (red at 50%+) for each point.

### Data sources (all free, no API key)

- [Open-Meteo](https://open-meteo.com/) forecast
- [Met Office warnings RSS](https://www.metoffice.gov.uk/weather/guides/rss), London & South East region
- [AuroraWatch UK](https://aurorawatch.lancs.ac.uk/) status and [NOAA SWPC](https://www.swpc.noaa.gov/products/planetary-k-index) Kp forecast

### Code layout

- `pages/api/weather-image.ts`: fetches data and returns the JPEG
- `utils/weather.ts`: Open-Meteo fetching and weather icons
- `utils/weather-screen/model.ts`: decides what the screen shows (pure, unit tested)
- `utils/weather-screen/render.ts`, `graph.ts`, `alert-banner.ts`: drawing
- `utils/weather-screen/layout.ts`: all positions and colours
- `utils/aurora.ts`, `utils/weather-warnings.ts`: alert sources

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
- @napi-rs/canvas for image generation
- Netlify Functions (Next.js API Routes)
- Open-Meteo API (free weather data, no API key required)
