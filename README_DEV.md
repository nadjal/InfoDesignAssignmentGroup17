# Developer README

## Requirements

- Docker Desktop (the only local dependency)

## Start dev environment

```bash
docker compose up --build
```

The app runs at `http://localhost:5000`. File changes to Python, templates, and CSS are picked up immediately via Flask's reloader (`FLASK_DEBUG=1`).

On first startup, the app downloads two files from Statistik Austria, processes them, and saves a pickle cache to `data/cache/dataframes.pkl`. This takes ~30 seconds. All subsequent startups load from the pickle and are instant (~1s).

## Project structure

```
binnenmigration/
├── app/
│   ├── __init__.py         Flask app factory — loads data at startup
│   ├── data_loader.py      Downloads, caches and merges source data into DataFrames
│   ├── routes.py           Page routes + API endpoints (pandas, no SQL)
│   ├── content/            Markdown files for editorial text (one file per page section)
│   │   ├── index_intro.md
│   │   ├── index_timeseries.md
│   │   ├── index_sankey.md
│   │   ├── karte_intro.md
│   │   └── explorer_intro.md
│   ├── templates/
│   │   ├── base.html       Base layout (navbar, footer, script includes)
│   │   ├── index.html      Dashboard page
│   │   ├── karte.html      Map page
│   │   └── explorer.html   Data explorer
│   └── static/
│       ├── css/main.css    Design system (CSS custom properties)
│       ├── js/charts.js    Plotly renderers
│       └── exports/        Optional static Plotly exports from Jupyter
├── data/
│   └── cache/              Downloaded source files (not in Git)
├── docker-compose.yml
├── Dockerfile
├── requirements.txt
└── run.py
```

## Live reload behaviour

Flask's debug reloader (`FLASK_DEBUG=1`) watches Python files and restarts the server automatically on changes. No container restart needed.

| File type | How to see changes |
|---|---|
| `templates/*.html` | Browser refresh |
| `static/css/*.css` | Hard refresh (Cmd+Shift+R) |
| `static/js/*.js` | Hard refresh (Cmd+Shift+R) |
| `routes.py`, Python files | Flask restarts automatically (~1s with pickle cache) |
| `app/content/*.md` | Browser refresh |

## Configuring label mappings

Coded values (e.g. `1`/`2` for gender or citizenship) are translated to readable labels via `LABEL_MAP` at the top of `app/data_loader.py`:

```python
LABEL_MAP = {
    'geschlecht': {'1': 'männlich', '2': 'weiblich'},
    'staatsbuergerschaft': {'1': 'Inländer', '2': 'Ausländer'},
}
```

Edit this dict to change or extend the mappings. After any change, delete the pickle cache so it is rebuilt with the new labels (see below).

## Resetting the data cache

The processed DataFrames are stored as a pickle in `data/cache/dataframes.pkl`. Delete it to force a full reload from source (e.g. after a data update):

```bash
# on the host
rm data/cache/dataframes.pkl

# or inside the container
docker compose exec app rm data/cache/dataframes.pkl
```

The next server start will re-download and reprocess the source files (~30s), then write a new pickle.

## Data pipeline

Source data is loaded once at app startup into two in-memory pandas DataFrames:

| Variable | Content |
|---|---|
| `app.config['DF']` | Full merged table (migrations + municipality names) |
| `app.config['DF_GEM']` | Municipality register (for gemeinden count) |

Key columns in `DF`:

| Column | Type | Description |
|---|---|---|
| `jahr` | int | Year |
| `von_gkz` / `nach_gkz` | int | Municipality code (origin / destination) |
| `staatsbuergerschaft` | str | Citizenship |
| `geschlecht` | str | Gender |
| `anzahl` | int | Count |
| `von_bundesland` / `nach_bundesland` | str | Federal state |
| `von_bezirk` / `nach_bezirk` | str | District |
| `von_gemeinde` / `nach_gemeinde` | str | Municipality name |

To access DataFrames in routes: `current_app.config['DF']`

## Working with text content and templates

Editorial text lives in `app/content/` as Markdown files. Each file maps to a named block in a page template.

### Adding or editing text

Edit the relevant `.md` file — no Python or HTML changes needed. The file is rendered to HTML on every request, so changes appear immediately in dev mode.

```
app/content/
  index_intro.md        → shown above charts on the dashboard
  index_timeseries.md   → shown between time-series and the two-column section
  index_sankey.md       → shown below the Sankey diagram
  karte_intro.md        → shown above the map
  explorer_intro.md     → shown above the filter panel
```

Markdown features supported: headings, bold/italic, links, tables, fenced code blocks (via `markdown[extra]`).

### Adding a new content block to a page

**Step 1** — Create a new `.md` file in `app/content/`, e.g. `index_footnote.md`.

**Step 2** — Pass it to the template in `routes.py`:

```python
@bp.route('/')
def index():
    return render_template('index.html',
        content_intro=_md('index_intro.md'),
        content_footnote=_md('index_footnote.md'),   # add this
    )
```

**Step 3** — Add the block to the template:

```html
{% if content_footnote %}
<div class="prose">{{ content_footnote | safe }}</div>
{% endif %}
```

The `{% if %}` guard means nothing is rendered when the file is empty or missing.

### Adding a new page

1. Create `app/content/mypage_intro.md` with placeholder text
2. Add a route in `routes.py` that passes `_md(...)` variables to the template
3. Create `app/templates/mypage.html` extending `base.html`
4. Add a nav link in `base.html`

## Adding a new chart

1. Add an API route in `routes.py` (under `# ── API routes ──`) using pandas on `_df()`
2. Add a render function in `app/static/js/charts.js`
3. Add `<div id="chart-xyz">` in the template and call the render function in `{% block scripts %}`

## Datasette (optional DB browser)

`docker-compose.yml` includes a Datasette service for inspecting the cached source files — useful for query debugging.

```bash
docker compose up datasette
# → http://localhost:8079
```

## Deployment

The app is deployable on Render, Fly.io, or any VPS with Docker:

- For production, set `FLASK_DEBUG=0`
- Use `gunicorn run:app -b 0.0.0.0:5000` as the container command
- Ensure the `data/cache/` directory is a persistent volume so files are not re-downloaded on every deploy
