import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  buildOpenMeteoUrl,
  dataFileForTime,
  dataPathForTime,
  originalPathForTime,
  pointReferenceForTime,
} from "./fetch-weather-data.mjs";
import {
  deriveScene,
  moonIllumination,
  normaliseWeatherPoint,
  weatherConfig,
} from "./weather-mapping.mjs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const gitignore = existsSync(".gitignore") ? readFileSync(".gitignore", "utf8") : "";
const fetchScript = readFileSync("scripts/fetch-weather-data.mjs", "utf8");
const workflowPath = ".github/workflows/fetch-weather.yml";
const workflow = existsSync(workflowPath) ? readFileSync(workflowPath, "utf8") : "";
const failures = [];

function assertDeepEqual(actual, expected, message) {
  try {
    assert.deepEqual(actual, expected);
  } catch (error) {
    failures.push(`${message}: ${error.message}`);
  }
}

function assertEqual(actual, expected, message) {
  try {
    assert.equal(actual, expected);
  } catch (error) {
    failures.push(`${message}: ${error.message}`);
  }
}

function assertMatch(actual, expected, message) {
  try {
    assert.match(actual, expected);
  } catch (error) {
    failures.push(`${message}: ${error.message}`);
  }
}

function samplePoint(overrides = {}) {
  return {
    time: "2026-05-26T12:00",
    weather_code: 0,
    cloud_cover: 10,
    precipitation: 0,
    rain: 0,
    snowfall: 0,
    snow_depth: 0,
    wind_speed_10m: 4,
    wind_gusts_10m: 6,
    visibility: 20000,
    is_day: 1,
    ...overrides,
  };
}

function sampleAstronomy(overrides = {}) {
  return {
    sunrise: "2026-05-26T04:45",
    sunset: "2026-05-26T21:14",
    ...overrides,
  };
}

assertEqual(
  dataFileForTime("2026-05-24T16:15"),
  "2026-05-24T16-15.json",
  "Data filenames replace the time colon with a hyphen",
);

assertEqual(
  dataPathForTime("2026-05-24T16:15"),
  "data/2026/05/24/2026-05-24T16-15.json",
  "Transformed data files are stored under data/year/month/day",
);

assertEqual(
  originalPathForTime("2026-05-24T16:15"),
  "originals/2026/05/24/2026-05-24T16-15.json",
  "Original API responses are stored under originals/year/month/day",
);

assertDeepEqual(
  pointReferenceForTime("2026-05-24T16:15"),
  {
    time: "2026-05-24T16:15",
    file: "2026/05/24/2026-05-24T16-15.json",
  },
  "Manifest point references are relative to data/index.json",
);

assertMatch(
  buildOpenMeteoUrl().toString(),
  /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/,
  "Weather fetches use the Open-Meteo forecast endpoint",
);

assertDeepEqual(
  deriveScene(samplePoint(), sampleAstronomy()),
  {
    baseLayer: "default",
    scene: "day",
    clouds: "none",
    rain: "none",
    snow: "none",
    wind: "none",
    fog: false,
  },
  "Clear day maps to a default day scene",
);

assertEqual(
  deriveScene(
    samplePoint({ time: "2026-05-26T03:50", is_day: 0 }),
    sampleAstronomy(),
  ).scene,
  "sunrise",
  "Times within the sunrise leeway map to sunrise",
);

assertEqual(
  deriveScene(
    samplePoint({ time: "2026-05-26T22:10", is_day: 0 }),
    sampleAstronomy(),
  ).scene,
  "sunset",
  "Times within the sunset leeway map to sunset",
);

assertDeepEqual(
  deriveScene(
    samplePoint({
      weather_code: 61,
      cloud_cover: 82,
      precipitation: 0.7,
      rain: 0.7,
      wind_speed_10m: 18,
    }),
    sampleAstronomy(),
  ),
  {
    baseLayer: "default",
    scene: "day",
    clouds: "many",
    rain: "light",
    snow: "none",
    wind: "light",
    fog: false,
  },
  "Rain, clouds, and wind map to visible weather layers",
);

assertDeepEqual(
  deriveScene(
    samplePoint({
      weather_code: 75,
      snowfall: 1.2,
      snow_depth: 0.021,
    }),
    sampleAstronomy(),
  ),
  {
    baseLayer: "snow",
    scene: "day",
    clouds: "none",
    rain: "none",
    snow: "heavy",
    wind: "none",
    fog: false,
  },
  "Heavy active snow and settled snow map to snow overlay and base layer",
);

assertEqual(
  deriveScene(samplePoint({ weather_code: 45, visibility: 800 }), sampleAstronomy()).fog,
  true,
  "Fog weather codes or low visibility enable fog",
);

assertEqual(
  deriveScene(
    samplePoint({ wind_speed_10m: 28, wind_gusts_10m: 48 }),
    sampleAstronomy(),
  ).wind,
  "strong",
  "Strong gusts enable strong wind",
);

assertEqual(
  deriveScene(
    samplePoint({ time: "2000-01-21T18:00:00Z", is_day: 0 }),
    sampleAstronomy({
      sunrise: "2000-01-21T08:00:00Z",
      sunset: "2000-01-21T16:00:00Z",
    }),
  ).scene,
  "night-full",
  "Night points with moon illumination at least half use the full moon layer",
);

assertEqual(
  deriveScene(
    samplePoint({ time: "2000-01-06T18:00:00Z", is_day: 0 }),
    sampleAstronomy({
      sunrise: "2000-01-06T08:00:00Z",
      sunset: "2000-01-06T16:00:00Z",
    }),
  ).scene,
  "night-half",
  "Night points with moon illumination below half use the crescent moon layer",
);

const normalisedPoint = normaliseWeatherPoint(samplePoint(), sampleAstronomy());

assertEqual(normalisedPoint.source, "open-meteo", "Normalised points include the data source");
assertEqual(normalisedPoint.raw.weather_code, 0, "Normalised points preserve raw weather values");
assertEqual(
  weatherConfig.sunriseSunsetLeewayMinutes,
  60,
  "Sunrise and sunset leeway is one hour either side",
);
assertEqual(
  typeof moonIllumination(new Date("2000-01-21T18:00:00Z")),
  "number",
  "Moon illumination returns a numeric value",
);

const ignoredPaths = gitignore.split(/\r?\n/);

if (ignoredPaths.includes("data/") || ignoredPaths.includes("originals/")) {
  failures.push("data/ and originals/ must stay tracked in version control.");
}

if (packageJson.scripts["fetch:weather"] !== "node scripts/fetch-weather-data.mjs") {
  failures.push("package.json does not define the weather fetch script.");
}

if (!packageJson.scripts.test) {
  failures.push("package.json does not define the test script.");
}

if (fetchScript.includes("rmSync(dataDirectory") || fetchScript.includes("renameSync(tempDirectory, dataDirectory)")) {
  failures.push("The fetch script must preserve existing historical data instead of replacing data/.");
}

if (fetchScript.includes("await fetch(")) {
  failures.push("The fetch script must use node:https instead of global fetch for Node compatibility.");
}

if (!workflow.includes('cron: "0 * * * *"')) {
  failures.push("The fetch workflow is not scheduled hourly.");
}

if (!workflow.includes("contents: write")) {
  failures.push("The fetch workflow cannot push generated data back to the repository.");
}

if (!workflow.includes("npm run fetch:weather -- --strict")) {
  failures.push("The fetch workflow does not run a strict weather fetch.");
}

if (!workflow.includes("git add data originals")) {
  failures.push("The fetch workflow does not stage both transformed and original weather data.");
}

if (existsSync("data/index.json")) {
  const manifest = JSON.parse(readFileSync("data/index.json", "utf8"));

  if (!Array.isArray(manifest.points) || manifest.points.length !== 192) {
    failures.push("data/index.json does not contain exactly 192 weather points.");
  } else {
    const missingPointFiles = manifest.points.filter((point) => !existsSync(join("data", point.file)));
    const flatPointFiles = manifest.points.filter((point) => !/^\d{4}\/\d{2}\/\d{2}\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}\.json$/.test(point.file));

    if (missingPointFiles.length > 0) {
      failures.push(`data/index.json references missing point files: ${missingPointFiles.map((point) => point.file).join(", ")}.`);
    }

    if (flatPointFiles.length > 0) {
      failures.push(`data/index.json includes non-nested point files: ${flatPointFiles.map((point) => point.file).join(", ")}.`);
    }
  }
}

if (existsSync("originals")) {
  const originalFiles = recursiveJsonFiles("originals");
  const flatOriginalFiles = originalFiles.filter((file) => !/^originals\/\d{4}\/\d{2}\/\d{2}\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}\.json$/.test(file));

  if (flatOriginalFiles.length > 0) {
    failures.push(`originals includes non-nested response files: ${flatOriginalFiles.join(", ")}.`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Passed.");

function recursiveJsonFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return recursiveJsonFiles(path);
    }

    return entry.isFile() && entry.name.endsWith(".json") ? [path] : [];
  });
}
