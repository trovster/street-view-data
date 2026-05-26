import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { get } from "node:https";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normaliseWeatherPoint, weatherConfig } from "./weather-mapping.mjs";

const coordinates = {
  latitude: 53.55262,
  longitude: -0.16441,
};
const timezone = "Europe/London";
const pointCount = 192;
const dataDirectory = "data";
const originalsDirectory = "originals";
const openMeteoEndpoint = "https://api.open-meteo.com/v1/forecast";
const minutelyVariables = [
  "weather_code",
  "cloud_cover",
  "precipitation",
  "rain",
  "snowfall",
  "snow_depth",
  "wind_speed_10m",
  "wind_gusts_10m",
  "visibility",
  "is_day",
];

export async function fetchWeatherData({ strict = false } = {}) {
  try {
    const fetchedAt = new Date();
    const latestAllowedTime = latestLocalQuarterHour(fetchedAt);
    const payload = await requestOpenMeteo();
    const points = normalisePayload(payload, latestAllowedTime);
    const originalPath = writeWeatherFiles(points, payload, latestAllowedTime);

    console.log(`Fetched ${points.length} weather points to ${dataDirectory}.`);
    console.log(`Archived original Open-Meteo response to ${originalPath}.`);
  } catch (error) {
    if (strict) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }

    console.warn(`Weather data fetch skipped: ${error.message}`);
  }
}

export function buildOpenMeteoUrl() {
  const url = new URL(openMeteoEndpoint);
  const params = {
    latitude: String(coordinates.latitude),
    longitude: String(coordinates.longitude),
    timezone,
    past_days: "2",
    forecast_days: "1",
    past_minutely_15: String(pointCount),
    forecast_minutely_15: "1",
    minutely_15: minutelyVariables.join(","),
    daily: "sunrise,sunset",
  };

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return url;
}

export function dataFileForTime(time) {
  return `${timeParts(time).timeForFile}.json`;
}

export function dataPathForTime(time) {
  return join(dataDirectory, pointReferenceForTime(time).file);
}

export function originalPathForTime(time) {
  return join(originalsDirectory, pointReferenceForTime(time).file);
}

export function pointReferenceForTime(time) {
  const { year, month, day } = timeParts(time);

  return {
    time,
    file: join(year, month, day, dataFileForTime(time)),
  };
}

function normalisePayload(payload, latestAllowedTime) {
  if (payload.error) {
    throw new Error(payload.reason || "Open-Meteo returned an error response.");
  }

  const minutely = payload.minutely_15;

  if (!minutely?.time?.length) {
    throw new Error("Open-Meteo response did not include 15-minute data.");
  }

  for (const variable of minutelyVariables) {
    if (!Array.isArray(minutely[variable])) {
      throw new Error(`Open-Meteo response is missing minutely_15.${variable}.`);
    }
  }

  const astronomyByDate = dailyAstronomyByDate(payload.daily);
  const rawPoints = minutely.time
    .map((time, index) => rawPointAt(minutely, time, index))
    .filter((point) => point.time <= latestAllowedTime)
    .slice(-pointCount);

  if (rawPoints.length !== pointCount) {
    throw new Error(`Expected ${pointCount} weather points, received ${rawPoints.length}.`);
  }

  return rawPoints.map((point) => {
    const astronomy = astronomyByDate.get(point.time.slice(0, 10));

    if (!astronomy) {
      throw new Error(`Missing sunrise and sunset data for ${point.time.slice(0, 10)}.`);
    }

    return normaliseWeatherPoint(point, astronomy);
  });
}

function rawPointAt(minutely, time, index) {
  return Object.fromEntries([
    ["time", time],
    ...minutelyVariables.map((variable) => [
      variable,
      normaliseNumber(minutely[variable][index], variable),
    ]),
  ]);
}

function normaliseNumber(value, variable) {
  if (value === null && variable === "visibility") {
    return Infinity;
  }

  if (value === null) {
    return 0;
  }

  return Number(value);
}

function dailyAstronomyByDate(daily) {
  if (!daily?.time || !daily.sunrise || !daily.sunset) {
    throw new Error("Open-Meteo response did not include daily sunrise and sunset data.");
  }

  return new Map(
    daily.time.map((date, index) => [
      date,
      {
        sunrise: daily.sunrise[index],
        sunset: daily.sunset[index],
      },
    ]),
  );
}

async function requestOpenMeteo() {
  const response = await getJson(buildOpenMeteoUrl());

  return JSON.parse(response);
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = get(url, (response) => {
      let body = "";

      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Open-Meteo request failed with HTTP ${response.statusCode}.`));
          return;
        }

        resolve(body);
      });
    });

    request.on("error", reject);
    request.setTimeout(20_000, () => {
      request.destroy(new Error("Open-Meteo request timed out."));
    });
  });
}

function writeWeatherFiles(points, payload, archiveTime) {
  const manifestPoints = points.map((point) => {
    const pointReference = pointReferenceForTime(point.time);
    const pointPath = join(dataDirectory, pointReference.file);

    writeJson(pointPath, point);

    return pointReference;
  });
  const originalPath = originalPathForTime(archiveTime);

  writeJson(originalPath, payload);
  writeJson(join(dataDirectory, "index.json"), {
    generatedAt: new Date().toISOString(),
    source: "open-meteo",
    sourceUrl: buildOpenMeteoUrl().toString(),
    originalResponse: originalPath,
    coordinates,
    timezone,
    pointCount,
    latestAllowedTime: archiveTime,
    sunriseSunsetLeewayMinutes: weatherConfig.sunriseSunsetLeewayMinutes,
    snowDepthThresholdMeters: weatherConfig.snowDepthThresholdMeters,
    daily: payload.daily,
    points: manifestPoints,
  });

  assertGeneratedFiles(manifestPoints, originalPath);

  return originalPath;
}

function assertGeneratedFiles(manifestPoints, originalPath) {
  const manifest = JSON.parse(readFileSync(join(dataDirectory, "index.json"), "utf8"));

  if (manifest.points.length !== pointCount) {
    throw new Error(`Manifest has ${manifest.points.length} points instead of ${pointCount}.`);
  }

  const missingFiles = manifestPoints.filter((point) => !existsSync(join(dataDirectory, point.file)));

  if (missingFiles.length > 0) {
    throw new Error(`Manifest references missing point files: ${missingFiles.map((point) => point.file).join(", ")}.`);
  }

  if (!existsSync(originalPath)) {
    throw new Error(`Original Open-Meteo response was not written to ${originalPath}.`);
  }

  for (const directory of [dataDirectory, originalsDirectory]) {
    assertNoFlatJsonFiles(directory);
  }
}

function assertNoFlatJsonFiles(directory) {
  if (!existsSync(directory)) {
    return;
  }

  const flatFiles = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "index.json")
    .map((entry) => join(directory, entry.name));

  if (flatFiles.length > 0) {
    throw new Error(`Expected nested ${directory} JSON files, found ${flatFiles.join(", ")}.`);
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function latestLocalQuarterHour(date = new Date()) {
  const localParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const parts = Object.fromEntries(localParts.map((part) => [part.type, part.value]));
  const minute = Math.floor(Number(parts.minute) / 15) * 15;

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${String(minute).padStart(2, "0")}`;
}

function timeParts(time) {
  const match = time.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);

  if (!match) {
    throw new Error(`Invalid weather time: ${time}.`);
  }

  const [, year, month, day, hour, minute] = match;

  return {
    year,
    month,
    day,
    timeForFile: `${year}-${month}-${day}T${hour}-${minute}`,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await fetchWeatherData({ strict: process.argv.includes("--strict") });
}
