# Binnenmigration Österreich

Interactive visualisation of internal migration in Austria, based on data from Statistik Austria.

## What the site shows

- **Dashboard** — Overview: time series, federal-state balance, citizenship distribution, Sankey diagram of migration flows
- **Map** — Geographic view of net migration by federal state, filterable by year
- **Explorer** — Detailed search: filter by year, origin/destination region, gender and citizenship, with CSV export

## Data sources

- Migration flows with gender and nationality data: [Offene Daten Österreich](https://www.data.gv.at/datasets/2d8c43fc-e0bd-389c-b15b-1d6787ed554f?locale=de)
- Migration flows: [Statistik Austria Open Data](https://data.statistik.gv.at/data/OGDEXT_BINNENWAND_1.zip)
- Migration flows with age data: [STATcube](https://statcube.at/statistik.at/ext/statcube/jsf/tableView/tableView.xhtml)

Data is downloaded automatically on first startup and cached locally.

## Getting started

```bash
docker compose up --buildy
```

Open in browser: [http://localhost:5000](http://localhost:5000)

**Requirement:** Docker Desktop installed. No local Python needed.
