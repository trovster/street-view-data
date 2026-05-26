import { fileURLToPath } from "node:url";
import { backfillWeatherDataForDay } from "./fetch-weather-data.mjs";

const timezone = "Europe/London";

export async function backfillWeatherData(monthInput, { strict = false, today = new Date() } = {}) {
  try {
    const dates = backfillDatesForMonth(monthInput, { today });
    let pointCount = 0;

    if (dates.length === 0) {
      console.log(`No dates to backfill for ${parseBackfillMonth(monthInput).label}; the month is after today.`);
      return;
    }

    for (const date of dates) {
      const result = await backfillWeatherDataForDay(date);

      pointCount += result.pointCount;
      console.log(`Backfilled ${date}: ${result.pointCount} points, original response ${result.originalPath}.`);
    }

    console.log(`Backfilled ${pointCount} weather points for ${parseBackfillMonth(monthInput).label}.`);
  } catch (error) {
    if (strict) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }

    console.warn(`Weather backfill skipped: ${error.message}`);
  }
}

export function backfillDatesForMonth(monthInput, { today = new Date() } = {}) {
  const month = parseBackfillMonth(monthInput);
  const todayParts = localDateParts(today);

  if (month.year > todayParts.year || (month.year === todayParts.year && month.month > todayParts.month)) {
    return [];
  }

  const finalDay =
    month.year === todayParts.year && month.month === todayParts.month
      ? todayParts.day
      : daysInMonth(month.year, month.month);

  return Array.from(
    { length: finalDay },
    (_, index) => `${month.label}-${String(index + 1).padStart(2, "0")}`,
  );
}

export function parseBackfillMonth(monthInput) {
  const input = String(monthInput ?? "").trim();

  if (!input) {
    throw new Error("Provide a month to backfill, for example: 2026-05.");
  }

  const numericMonth = input.match(/^(\d{4})-(\d{2})$/);

  if (numericMonth) {
    return normaliseMonth(Number(numericMonth[1]), Number(numericMonth[2]));
  }

  const parsedDate = new Date(input);

  if (Number.isNaN(parsedDate.getTime())) {
    throw new Error(`Invalid backfill month: ${input}.`);
  }

  return normaliseMonth(parsedDate.getFullYear(), parsedDate.getMonth() + 1);
}

function normaliseMonth(year, month) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Backfill month must include a valid year and month.");
  }

  return {
    year,
    month,
    label: `${year}-${String(month).padStart(2, "0")}`,
  };
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function localDateParts(date) {
  const localParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const parts = Object.fromEntries(localParts.map((part) => [part.type, part.value]));

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const monthInput = process.argv.slice(2).find((argument) => !argument.startsWith("--"));

  await backfillWeatherData(monthInput, { strict: process.argv.includes("--strict") });
}
