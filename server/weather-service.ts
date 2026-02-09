const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;
const OPENWEATHER_API_URL = "https://api.openweathermap.org/data/2.5/weather";

export interface WeatherData {
  condition: string;
  description: string;
  temperature: number; // Celsius
  feelsLike: number;
  humidity: number;
  windSpeed: number; // m/s
  isOutdoorFriendly: boolean;
  advice: string;
}

interface OpenWeatherResponse {
  weather: Array<{
    id: number;
    main: string;
    description: string;
  }>;
  main: {
    temp: number;
    feels_like: number;
    humidity: number;
  };
  wind: {
    speed: number;
  };
  name: string;
}

// City coordinates for weather lookup
// Keys must match cityId from city-intelligence.ts (nyc, berlin, tokyo)
const CITY_COORDINATES: Record<string, { lat: number; lon: number }> = {
  // Primary city IDs (used by Routed)
  "nyc": { lat: 40.7128, lon: -74.0060 },
  "tokyo": { lat: 35.6762, lon: 139.6503 },
  "berlin": { lat: 52.5200, lon: 13.4050 },
  // Aliases for flexibility
  "new-york": { lat: 40.7128, lon: -74.0060 },
  "london": { lat: 51.5074, lon: -0.1278 },
  "paris": { lat: 48.8566, lon: 2.3522 },
  "san-francisco": { lat: 37.7749, lon: -122.4194 },
  "los-angeles": { lat: 34.0522, lon: -118.2437 },
  "chicago": { lat: 41.8781, lon: -87.6298 },
  "seattle": { lat: 47.6062, lon: -122.3321 },
  "boston": { lat: 42.3601, lon: -71.0589 },
};

/**
 * Fetch current weather for a city
 */
export async function getWeather(cityId: string): Promise<WeatherData | null> {
  if (!OPENWEATHER_API_KEY) {
    console.warn("[Weather] OPENWEATHER_API_KEY not set, using simulated weather");
    return getSimulatedWeather(cityId);
  }

  const coords = CITY_COORDINATES[cityId];
  if (!coords) {
    console.warn(`[Weather] No coordinates for city: "${cityId}", using simulated weather`);
    return getSimulatedWeather(cityId);
  }

  try {
    const params = new URLSearchParams({
      lat: coords.lat.toString(),
      lon: coords.lon.toString(),
      appid: OPENWEATHER_API_KEY,
      units: "metric",
    });

    const response = await fetch(`${OPENWEATHER_API_URL}?${params.toString()}`);
    const data: OpenWeatherResponse = await response.json();

    if (!data.weather || data.weather.length === 0) {
      console.warn(`[Weather] API returned no weather data for ${cityId}`);
      return getSimulatedWeather(cityId);
    }

    const weather = data.weather[0];
    const condition = mapWeatherCondition(weather.main);
    const isOutdoorFriendly = checkOutdoorFriendly(weather.id, data.main.temp);
    const advice = generateWeatherAdvice(condition, data.main.temp, isOutdoorFriendly);

    const result = {
      condition,
      description: weather.description,
      temperature: Math.round(data.main.temp),
      feelsLike: Math.round(data.main.feels_like),
      humidity: data.main.humidity,
      windSpeed: data.wind.speed,
      isOutdoorFriendly,
      advice,
    };

    console.log(`[Weather] ${cityId}: ${result.temperature}°C, ${result.condition} (real-time from OpenWeather)`);
    return result;
  } catch (error) {
    console.error("[Weather] Failed to fetch weather:", error);
    return getSimulatedWeather(cityId);
  }
}

/**
 * Map OpenWeatherMap condition to simple condition
 */
function mapWeatherCondition(main: string): string {
  switch (main.toLowerCase()) {
    case "clear":
      return "clear";
    case "clouds":
      return "cloudy";
    case "rain":
    case "drizzle":
      return "rain";
    case "thunderstorm":
      return "storm";
    case "snow":
      return "snow";
    case "mist":
    case "fog":
    case "haze":
      return "foggy";
    default:
      return "clear";
  }
}

/**
 * Check if weather is suitable for outdoor activities
 */
function checkOutdoorFriendly(weatherId: number, temp: number): boolean {
  // Weather IDs: https://openweathermap.org/weather-conditions
  // 2xx: Thunderstorm, 3xx: Drizzle, 5xx: Rain, 6xx: Snow
  const badWeather = weatherId >= 200 && weatherId < 700;
  const extremeTemp = temp < 0 || temp > 35;

  return !badWeather && !extremeTemp;
}

/**
 * Generate travel advice based on weather
 */
function generateWeatherAdvice(condition: string, temp: number, isOutdoorFriendly: boolean): string {
  if (condition === "rain" || condition === "storm") {
    return "It's raining - consider covered walking routes or rideshare to stay dry.";
  }
  if (condition === "snow") {
    return "It's snowing - transit may have delays, rideshare recommended for comfort.";
  }
  if (temp > 30) {
    return "It's hot outside - minimize outdoor walking and prefer air-conditioned transport.";
  }
  if (temp < 5) {
    return "It's cold - minimize waiting outdoors and prefer heated transit or rideshare.";
  }
  if (condition === "foggy") {
    return "Visibility is low - allow extra travel time and be cautious.";
  }
  if (isOutdoorFriendly) {
    return "Weather is pleasant for outdoor travel - walking could be enjoyable!";
  }
  return "Weather conditions are moderate.";
}

/**
 * Fallback simulated weather when API is unavailable
 * WARNING: This is FAKE data - only used when API key is missing or request fails
 */
function getSimulatedWeather(cityId: string): WeatherData {
  const hour = new Date().getHours();
  const conditions = ["clear", "cloudy", "rain", "clear", "clear"];
  const randomIndex = (cityId.charCodeAt(0) + hour) % conditions.length;
  const condition = conditions[randomIndex];

  // Simulate temperature based on time of day
  const baseTemp = 18;
  const tempVariation = hour >= 10 && hour <= 16 ? 5 : -3;
  const temperature = baseTemp + tempVariation;

  const isOutdoorFriendly = condition !== "rain" && temperature > 5 && temperature < 30;
  const advice = generateWeatherAdvice(condition, temperature, isOutdoorFriendly);

  console.warn(`[Weather] ⚠️ SIMULATED weather for ${cityId}: ${temperature}°C, ${condition} (NOT REAL DATA)`);

  return {
    condition,
    description: condition,
    temperature,
    feelsLike: temperature - 2,
    humidity: 60,
    windSpeed: 3,
    isOutdoorFriendly,
    advice,
  };
}

/**
 * Get weather by coordinates (for dynamic location lookup)
 */
export async function getWeatherByCoords(lat: number, lon: number): Promise<WeatherData | null> {
  if (!OPENWEATHER_API_KEY) {
    console.warn("OPENWEATHER_API_KEY not set");
    return null;
  }

  try {
    const params = new URLSearchParams({
      lat: lat.toString(),
      lon: lon.toString(),
      appid: OPENWEATHER_API_KEY,
      units: "metric",
    });

    const response = await fetch(`${OPENWEATHER_API_URL}?${params.toString()}`);
    const data: OpenWeatherResponse = await response.json();

    if (!data.weather || data.weather.length === 0) {
      return null;
    }

    const weather = data.weather[0];
    const condition = mapWeatherCondition(weather.main);
    const isOutdoorFriendly = checkOutdoorFriendly(weather.id, data.main.temp);
    const advice = generateWeatherAdvice(condition, data.main.temp, isOutdoorFriendly);

    return {
      condition,
      description: weather.description,
      temperature: Math.round(data.main.temp),
      feelsLike: Math.round(data.main.feels_like),
      humidity: data.main.humidity,
      windSpeed: data.wind.speed,
      isOutdoorFriendly,
      advice,
    };
  } catch (error) {
    console.error("Failed to fetch weather by coords:", error);
    return null;
  }
}
