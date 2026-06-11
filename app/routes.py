from flask import Blueprint, jsonify, render_template, request, Response, current_app
import csv
import io
import pandas as pd
import markdown
from pathlib import Path

bp = Blueprint('main', __name__)

_choropleth_cache = {}   # (level, year) -> list[dict]

CONTENT_DIR = Path(__file__).parent / 'content'

BUNDESLAENDER_COORDS = {
    'Wien':             (48.2082, 16.3738),
    'Niederösterreich': (48.1070, 15.8048),
    'Oberösterreich':   (48.0065, 14.2024),
    'Salzburg':         (47.7997, 13.0447),
    'Tirol':            (47.2538, 11.6010),
    'Vorarlberg':       (47.2459,  9.7944),
    'Steiermark':       (47.1622, 14.9922),
    'Kärnten':          (46.7503, 14.0048),
    'Burgenland':       (47.5029, 16.5417),
}

EXPLORER_COLS = [
    'jahr', 'von_gemeinde', 'von_bezirk', 'von_bundesland',
    'nach_gemeinde', 'nach_bezirk', 'nach_bundesland',
    'geschlecht', 'staatsbuergerschaft', 'anzahl',
]


def _df():
    return current_app.config['DF']

def _df_gem():
    return current_app.config['DF_GEM']

def _md(filename):
    path = CONTENT_DIR / filename
    if not path.exists():
        return ''
    return markdown.markdown(path.read_text(encoding='utf-8'), extensions=['extra'])

def _filter_year(df, year):
    return df[df['jahr'] == int(year)] if year else df

def _rows(df):
    """Convert DataFrame to JSON-safe list of dicts (no numpy scalars)."""
    return df.where(df.notna(), other=None).to_dict(orient='records')


# ── Pages ──────────────────────────────────────────────────────────────────

@bp.route('/')
def index():
    return render_template('index.html',
        content_intro=_md('index_intro.md'),
        content_timeseries=_md('index_timeseries.md'),
        content_sankey=_md('index_sankey.md'),
    )

@bp.route('/karte')
def karte():
    return render_template('karte.html',
        content_intro=_md('karte_intro.md'),
    )

@bp.route('/explorer')
def explorer():
    return render_template('explorer.html',
        content_intro=_md('explorer_intro.md'),
    )

@bp.route('/gemeinde')
def gemeinde():
    return render_template('gemeinde.html',
        content_intro=_md('gemeinde_intro.md'),
    )


# ── API routes ──────────────────────────────────────────────────────────────

@bp.route('/api/overview')
def api_overview():
    df  = _df()
    gem = _df_gem()
    return jsonify({
        'total_migrations': int(df['anzahl'].sum()),
        'year_min':         int(df['jahr'].min()),
        'year_max':         int(df['jahr'].max()),
        'gemeinden_count':  int(gem['Gemeinde kennziffer'].nunique()),
    })


@bp.route('/api/years')
def api_years():
    years = sorted(int(y) for y in _df()['jahr'].dropna().unique())
    return jsonify(years)


@bp.route('/api/filters')
def api_filters():
    df = _df()
    return jsonify({
        'bundeslaender':       sorted(str(v) for v in df['von_bundesland'].dropna().unique()),
        'geschlechter':        sorted(str(v) for v in df['geschlecht'].dropna().unique()),
        'staatsbuergerschaft': sorted(str(v) for v in df['staatsbuergerschaft'].dropna().unique()),
    })


@bp.route('/api/timeseries')
def api_timeseries():
    result = (
        _df()
        .groupby(['jahr', 'geschlecht'], dropna=True)['anzahl']
        .sum().reset_index()
        .rename(columns={'anzahl': 'total'})
        .sort_values(['jahr', 'geschlecht'])
        .astype({'jahr': int, 'total': int})
    )
    return jsonify(_rows(result))


@bp.route('/api/bundeslaender')
def api_bundeslaender():
    df  = _filter_year(_df(), request.args.get('year'))
    aus = df.groupby('von_bundesland')['anzahl'].sum()
    zu  = df.groupby('nach_bundesland')['anzahl'].sum()
    bls = sorted(set(aus.index.tolist()) | set(zu.index.tolist()))
    result = [
        {
            'bundesland': bl,
            'ausziehend': int(aus.get(bl, 0) or 0),
            'zuzug':      int(zu.get(bl, 0) or 0),
            'netto':      int((zu.get(bl, 0) or 0) - (aus.get(bl, 0) or 0)),
        }
        for bl in bls if bl and str(bl) != 'nan'
    ]
    return jsonify(result)


@bp.route('/api/staatsbuergerschaft')
def api_staatsbuergerschaft():
    df = _filter_year(_df(), request.args.get('year'))
    result = (
        df.groupby('staatsbuergerschaft', dropna=True)['anzahl']
        .sum().reset_index()
        .rename(columns={'anzahl': 'total'})
        .sort_values('total', ascending=False)
        .astype({'total': int})
    )
    return jsonify(_rows(result))


@bp.route('/api/timeseries_bundeslaender')
def api_timeseries_bundeslaender():
    df = _df()
    zuzug = (
        df.groupby(['jahr', 'nach_bundesland'], dropna=True)['anzahl']
        .sum().reset_index()
        .rename(columns={'nach_bundesland': 'bundesland', 'anzahl': 'zuzug'})
    )
    wegzug = (
        df.groupby(['jahr', 'von_bundesland'], dropna=True)['anzahl']
        .sum().reset_index()
        .rename(columns={'von_bundesland': 'bundesland', 'anzahl': 'wegzug'})
    )
    merged = zuzug.merge(wegzug, on=['jahr', 'bundesland'], how='outer').fillna(0)
    merged['netto'] = merged['zuzug'] - merged['wegzug']
    merged = (merged
        .sort_values(['bundesland', 'jahr'])
        .astype({'jahr': int, 'zuzug': int, 'wegzug': int, 'netto': int})
    )
    return jsonify(_rows(merged))


@bp.route('/api/sankey')
def api_sankey():
    df = _filter_year(_df(), request.args.get('year'))
    df = df[df['von_bundesland'] != df['nach_bundesland']]
    flows = (
        df.groupby(['von_bundesland', 'nach_bundesland'], dropna=True)['anzahl']
        .sum().reset_index()
        .rename(columns={'anzahl': 'total'})
    )
    bundeslaender = sorted(
        set(flows['von_bundesland'].tolist()) | set(flows['nach_bundesland'].tolist())
    )
    return jsonify({
        'bundeslaender': bundeslaender,
        'flows': [
            {'von': str(r['von_bundesland']), 'nach': str(r['nach_bundesland']), 'total': int(r['total'])}
            for _, r in flows.iterrows()
        ],
    })



@bp.route('/api/choropleth')
def api_choropleth():
    level = request.args.get('level', 'bundeslaender')
    year  = request.args.get('year')
    if level not in ('bundeslaender', 'bezirke', 'gemeinden'):
        return jsonify({'error': 'invalid level'}), 400

    key = (level, year)
    if key not in _choropleth_cache:
        df = _filter_year(_df(), year)
        df = df.dropna(subset=['von_gkz', 'nach_gkz']).copy()
        n        = {'bundeslaender': 1, 'bezirke': 3, 'gemeinden': 5}[level]
        iso_von  = df['von_gkz'].astype(int).astype(str).str[:n]
        iso_nach = df['nach_gkz'].astype(int).astype(str).str[:n]
        zuzug    = df.groupby(iso_nach)['anzahl'].sum()
        wegzug   = df.groupby(iso_von)['anzahl'].sum()
        isos     = sorted(set(zuzug.index) | set(wegzug.index))
        names    = current_app.config.get('GEOJSON_NAMES', {}).get(level, {})
        _choropleth_cache[key] = [{
            'iso':    iso,
            'name':   names.get(iso, iso),
            'zuzug':  int(zuzug.get(iso, 0)),
            'wegzug': int(wegzug.get(iso, 0)),
            'netto':  int(zuzug.get(iso, 0)) - int(wegzug.get(iso, 0)),
        } for iso in isos]

    resp = jsonify(_choropleth_cache[key])
    resp.headers['Cache-Control'] = 'public, max-age=3600'
    return resp


@bp.route('/api/karte')
def api_karte():
    df  = _filter_year(_df(), request.args.get('year'))
    aus = df.groupby('von_bundesland')['anzahl'].sum()
    zu  = df.groupby('nach_bundesland')['anzahl'].sum()
    result = [
        {
            'bundesland': bl,
            'lat': lat, 'lon': lon,
            'ausziehend': int(aus.get(bl, 0) or 0),
            'zuzug':      int(zu.get(bl, 0) or 0),
            'netto':      int((zu.get(bl, 0) or 0) - (aus.get(bl, 0) or 0)),
            'total':      int((aus.get(bl, 0) or 0) + (zu.get(bl, 0) or 0)),
        }
        for bl, (lat, lon) in BUNDESLAENDER_COORDS.items()
    ]
    return jsonify(result)


@bp.route('/api/gemeinden')
def api_gemeinden():
    df = _df()
    von  = df[['von_gkz',  'von_gemeinde',  'von_bundesland' ]].rename(columns={'von_gkz': 'gkz',  'von_gemeinde': 'name',  'von_bundesland': 'bundesland'})
    nach = df[['nach_gkz', 'nach_gemeinde', 'nach_bundesland']].rename(columns={'nach_gkz': 'gkz', 'nach_gemeinde': 'name', 'nach_bundesland': 'bundesland'})
    gem  = (pd.concat([von, nach])
              .drop_duplicates('gkz')
              .dropna(subset=['name'])
              .sort_values('name')
              .reset_index(drop=True))
    return jsonify(_rows(gem[['gkz', 'name', 'bundesland']]))


@bp.route('/api/gemeinde_top')
def api_gemeinde_top():
    gkz = request.args.get('gkz', type=int)
    if not gkz:
        return jsonify({'error': 'gkz required'}), 400

    df = _df()

    df = _filter_year(df, request.args.get('year'))

    top_nach = (
        df[(df['von_gkz'] == gkz) & (df['nach_gkz'] != gkz)]
        .groupby(['nach_gkz', 'nach_gemeinde', 'nach_bundesland'])['anzahl'].sum()
        .reset_index()
        .rename(columns={'nach_gkz': 'gkz', 'nach_gemeinde': 'name', 'nach_bundesland': 'bundesland', 'anzahl': 'anzahl'})
        .nlargest(5, 'anzahl')
        .astype({'anzahl': int})
    )
    top_von = (
        df[(df['nach_gkz'] == gkz) & (df['von_gkz'] != gkz)]
        .groupby(['von_gkz', 'von_gemeinde', 'von_bundesland'])['anzahl'].sum()
        .reset_index()
        .rename(columns={'von_gkz': 'gkz', 'von_gemeinde': 'name', 'von_bundesland': 'bundesland', 'anzahl': 'anzahl'})
        .nlargest(5, 'anzahl')
        .astype({'anzahl': int})
    )
    return jsonify({'top_nach': _rows(top_nach), 'top_von': _rows(top_von)})


def _apply_explorer_filters(df, args):
    year    = args.get('year')
    von_bl  = args.get('von_bl')
    nach_bl = args.get('nach_bl')
    geschl  = args.get('geschlecht')
    staat   = args.get('staatsbuergerschaft')

    mask = pd.Series(True, index=df.index)
    if year:    mask &= df['jahr'] == int(year)
    if von_bl:  mask &= df['von_bundesland'] == von_bl
    if nach_bl: mask &= df['nach_bundesland'] == nach_bl
    if geschl:  mask &= df['geschlecht'] == geschl
    if staat:   mask &= df['staatsbuergerschaft'] == staat
    return df[mask].sort_values(['jahr', 'anzahl'], ascending=[False, False])


@bp.route('/api/explorer')
def api_explorer():
    page     = max(1, int(request.args.get('page', 1)))
    per_page = min(200, int(request.args.get('per_page', 50)))
    filtered = _apply_explorer_filters(_df(), request.args)
    total    = len(filtered)
    page_df  = filtered[EXPLORER_COLS].iloc[(page - 1) * per_page: page * per_page]
    return jsonify({'total': total, 'page': page, 'per_page': per_page, 'data': _rows(page_df)})


@bp.route('/api/explorer/csv')
def api_explorer_csv():
    filtered = _apply_explorer_filters(_df(), request.args)
    buf = io.StringIO()
    filtered[EXPLORER_COLS].to_csv(buf, index=False)
    return Response(buf.getvalue(), mimetype='text/csv; charset=utf-8',
                    headers={'Content-Disposition': 'attachment; filename=binnenmigration.csv'})
