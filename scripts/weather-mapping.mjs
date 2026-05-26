export const weatherConfig = {
  sunriseSunsetLeewayMinutes: 60,
  snowDepthThresholdMeters: 0.02,
};

const rainCodes = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82]);
const heavyRainCodes = new Set([55, 57, 65, 67, 82]);
const snowCodes = new Set([71, 73, 75, 77, 85, 86]);
const heavySnowCodes = new Set([75, 86]);
const fogCodes = new Set([45, 48]);
const synodicMonthDays = 29.530588853;
const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14);

export function deriveScene(point, astronomy, config = weatherConfig) {
  return {
    baseLayer: point.snow_depth >= config.snowDepthThresholdMeters ? "snow" : "default",
    scene: deriveTimeScene(point.time, point.is_day, astronomy, config),
    clouds: deriveClouds(point.cloud_cover),
    rain: deriveRain(point),
    snow: deriveSnow(point),
    wind: deriveWind(point),
    fog: deriveFog(point),
  };
}

export function normaliseWeatherPoint(point, astronomy, config = weatherConfig) {
  return {
    time: point.time,
    source: "open-meteo",
    raw: {
      weather_code: point.weather_code,
      cloud_cover: point.cloud_cover,
      precipitation: point.precipitation,
      rain: point.rain,
      snowfall: point.snowfall,
      snow_depth: point.snow_depth,
      wind_speed_10m: point.wind_speed_10m,
      wind_gusts_10m: point.wind_gusts_10m,
      visibility: point.visibility,
      is_day: point.is_day,
    },
    astronomy: {
      sunrise: astronomy.sunrise,
      sunset: astronomy.sunset,
      moonIllumination: moonIllumination(new Date(point.time)),
    },
    scene: deriveScene(point, astronomy, config),
  };
}

export function moonIllumination(date) {
  const daysSinceKnownNewMoon = (date.getTime() - knownNewMoon) / 86_400_000;
  const phase = positiveModulo(daysSinceKnownNewMoon, synodicMonthDays) / synodicMonthDays;

  return (1 - Math.cos(2 * Math.PI * phase)) / 2;
}

function deriveTimeScene(time, isDay, astronomy, config) {
  if (isWithinLeeway(time, astronomy.sunrise, config.sunriseSunsetLeewayMinutes)) {
    return "sunrise";
  }

  if (isWithinLeeway(time, astronomy.sunset, config.sunriseSunsetLeewayMinutes)) {
    return "sunset";
  }

  if (Number(isDay) === 1) {
    return "day";
  }

  return moonIllumination(new Date(time)) >= 0.5 ? "night-full" : "night-half";
}

function deriveClouds(cloudCover = 0) {
  if (cloudCover <= 20) {
    return "none";
  }

  if (cloudCover <= 65) {
    return "few";
  }

  return "many";
}

function deriveRain(point) {
  const code = Number(point.weather_code);
  const rain = Number(point.rain ?? 0);
  const precipitation = Number(point.precipitation ?? 0);

  if (heavyRainCodes.has(code) || rain >= 4 || precipitation >= 4) {
    return "heavy";
  }

  if (rainCodes.has(code) || rain > 0 || precipitation > 0) {
    return "light";
  }

  return "none";
}

function deriveSnow(point) {
  const code = Number(point.weather_code);
  const snowfall = Number(point.snowfall ?? 0);

  if (heavySnowCodes.has(code) || snowfall >= 1) {
    return "heavy";
  }

  if (snowCodes.has(code) || snowfall > 0) {
    return "light";
  }

  return "none";
}

function deriveWind(point) {
  const windSpeed = Number(point.wind_speed_10m ?? 0);
  const windGusts = Number(point.wind_gusts_10m ?? 0);

  if (windSpeed > 32 || windGusts > 45) {
    return "strong";
  }

  if (windSpeed >= 8 || windGusts >= 12) {
    return "light";
  }

  return "none";
}

function deriveFog(point) {
  return fogCodes.has(Number(point.weather_code)) || Number(point.visibility ?? Infinity) < 1000;
}

function isWithinLeeway(time, target, leewayMinutes) {
  if (!target) {
    return false;
  }

  const timeMs = new Date(time).getTime();
  const targetMs = new Date(target).getTime();
  const leewayMs = leewayMinutes * 60 * 1000;

  return Math.abs(timeMs - targetMs) <= leewayMs;
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}
