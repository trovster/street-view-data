# Street View Data

This repository stores the Open-Meteo data used by the street view illustration.

Hourly automation writes the untouched Open-Meteo response to `originals/` and
the transformed scene points to `data/`. Both directories are intentionally kept
in version control.

The fetch scripts read `LATITUDE` and `LONGITUDE` from a local `.env` file or
the process environment. `.env` is ignored by git, and the GitHub workflow
generates it from repository secrets with the same names.

Files are grouped by local weather time:

```text
originals/2026/05/2026-05-24.json
data/2026/05/24/2026-05-24T16-15.json
```

`data/index.json` is the manifest consumed by the site. Its `points[].file`
values are relative to the `data/` folder.

Run `npm run fetch:weather -- --strict` to fetch current weather data, `npm run
backfill:weather -- 2026-05 --strict` to backfill a month without writing dates
after today, and `npm test` to validate the transform, repository rules, and
workflow.
