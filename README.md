# Sheffield Weather Forecast Image Generator

A TypeScript application that generates a dynamic weather forecast image for Sheffield, UK. The application uses the OpenWeather API to fetch weather data and generates an 800x480 JPEG image showing the next 24 hours of weather conditions.

## Features

- Dynamic image generation (800x480 JPEG)
- 24-hour weather forecast for Sheffield
- Auto-refreshing forecast every 5 minutes
- Serverless deployment on Netlify

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
3. Add the following environment variable in Netlify's dashboard:
   - OPENWEATHER_API_KEY: Your OpenWeather API key

The site will automatically build and deploy when changes are pushed to the repository.

## API Endpoint

The weather forecast image is available at:
- Local: http://localhost:8888/api/weather-image
- Production: https://[your-netlify-site].netlify.app/api/weather-image

## Technology Stack

- TypeScript
- Node.js Canvas for image generation
- Netlify Functions
- OpenWeather API
