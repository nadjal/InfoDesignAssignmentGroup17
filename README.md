# Binnenmigration Österreich

Interactive visualisation of internal migration in Austria, based on data from Statistik Austria.

## What the site shows

- **Dashboard** — Overview: time series, federal-state balance, citizenship distribution, Sankey diagram of migration flows
- **Map** — Geographic view of net migration by federal state, filterable by year
- **Explorer** — Detailed search: filter by year, origin/destination region, gender and citizenship, with CSV export

## Data sources

- Migration flows: [Statistik Austria Open Data](https://data.statistik.gv.at/data/OGDEXT_BINNENWAND_1.zip)
- Municipality register: [Statistik Austria Registerzählung](https://www.statistik.at/fileadmin/pages/453/RegGemVz2024.ods)

Data is downloaded automatically on first startup and cached locally.

## Getting started

```bash
docker compose up --build
```

Open in browser: [http://localhost:5000](http://localhost:5000)

**Requirement:** Docker Desktop installed. No local Python needed.
