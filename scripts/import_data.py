"""
Import migration and Gemeinden data into the SQLite database,
and pre-compute aggregated summary tables for fast dashboard queries.

Usage from Jupyter notebook:
    import sqlite3, sys
    sys.path.insert(0, '/path/to/binnenmigration')  # only if needed
    from scripts.import_data import import_to_db
    import_to_db(migrations_df, gemeinden_df)

Usage from CLI:
    python scripts/import_data.py --migrations mig.csv --gemeinden gem.csv [--replace]

Expected columns
    migrations_df : jahr, von, nach, geschlecht, staatsbuergerschaft, anzahl
    gemeinden_df  : gkz, bundesland, bezirk, gemeinde, bevoelkerungszahl

Summary tables computed automatically (pandas groupby — fast):
    agg_timeseries          (jahr, geschlecht, anzahl)
    agg_bundeslaender       (jahr, von_bundesland, nach_bundesland, anzahl)
    agg_staatsbuergerschaft (jahr, staatsbuergerschaft, anzahl)
"""

import sqlite3
import sys
import argparse
from pathlib import Path

DEFAULT_DB = Path(__file__).parent.parent / 'data' / 'binnenmigration.db'

_SCHEMA = '''
CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jahr INTEGER NOT NULL,
    von_gkz TEXT NOT NULL,
    nach_gkz TEXT NOT NULL,
    geschlecht TEXT,
    staatsbuergerschaft TEXT,
    anzahl INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS gemeinden (
    gkz TEXT PRIMARY KEY,
    bundesland TEXT,
    bezirk TEXT,
    gemeinde TEXT,
    bevoelkerungszahl INTEGER
);
CREATE TABLE IF NOT EXISTS agg_timeseries (
    jahr INTEGER, geschlecht TEXT, anzahl INTEGER
);
CREATE TABLE IF NOT EXISTS agg_bundeslaender (
    jahr INTEGER, von_bundesland TEXT, nach_bundesland TEXT, anzahl INTEGER
);
CREATE TABLE IF NOT EXISTS agg_staatsbuergerschaft (
    jahr INTEGER, staatsbuergerschaft TEXT, anzahl INTEGER
);
CREATE INDEX IF NOT EXISTS idx_m_jahr ON migrations(jahr);
CREATE INDEX IF NOT EXISTS idx_m_von  ON migrations(von_gkz);
CREATE INDEX IF NOT EXISTS idx_m_nach ON migrations(nach_gkz);
'''


def import_to_db(migrations_df=None, gemeinden_df=None, db_path=None, replace=False):
    """
    Import DataFrames and compute summary tables.

    Parameters
    ----------
    migrations_df : pd.DataFrame  — columns: jahr, von, nach, geschlecht, staatsbuergerschaft, anzahl
    gemeinden_df  : pd.DataFrame  — columns: gkz, bundesland, bezirk, gemeinde, bevoelkerungszahl
    db_path       : str/Path      — defaults to data/binnenmigration.db
    replace       : bool          — replace existing data (default: append)
    """
    db_path = Path(db_path) if db_path else DEFAULT_DB
    db_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(db_path)
    try:
        for stmt in _SCHEMA.strip().split(';'):
            if stmt.strip():
                conn.execute(stmt)

        if gemeinden_df is not None:
            df = gemeinden_df.copy()
            df.columns = [c.strip().lower() for c in df.columns]
            df['gkz'] = df['gkz'].astype(str).str.strip()
            if replace:
                conn.execute('DELETE FROM gemeinden')
            df[['gkz', 'bundesland', 'bezirk', 'gemeinde', 'bevoelkerungszahl']].to_sql(
                'gemeinden', conn, if_exists='append', index=False, method='multi'
            )
            print(f'  Gemeinden:    {len(df):>10,} Einträge')

        if migrations_df is not None:
            df = migrations_df.copy()
            df.columns = [c.strip().lower() for c in df.columns]
            df = df.rename(columns={'von': 'von_gkz', 'nach': 'nach_gkz'})
            df['von_gkz']  = df['von_gkz'].astype(str).str.strip()
            df['nach_gkz'] = df['nach_gkz'].astype(str).str.strip()
            df['anzahl']   = df['anzahl'].fillna(0).astype(int)
            if replace:
                conn.execute('DELETE FROM migrations')
            df[['jahr', 'von_gkz', 'nach_gkz', 'geschlecht', 'staatsbuergerschaft', 'anzahl']].to_sql(
                'migrations', conn, if_exists='append', index=False,
                method='multi', chunksize=5000,
            )
            print(f'  Migrationen:  {len(df):>10,} Einträge')

        # ── Summary tables (pandas groupby — sehr schnell) ──────────────
        if migrations_df is not None and gemeinden_df is not None:
            print('  Berechne Summary-Tabellen ...')
            _build_summaries(df, gemeinden_df, conn)
        elif migrations_df is not None:
            print('  Hinweis: Summaries brauchen migrations_df UND gemeinden_df.')

        conn.commit()
        print(f'  Datenbank:    {db_path}')
    finally:
        conn.close()


def _build_summaries(mig_df, gem_df, conn):
    """Merge bundesland info in pandas, then groupby — orders of magnitude faster than SQL JOIN."""
    import pandas as pd

    gem = gem_df.copy()
    gem.columns = [c.strip().lower() for c in gem.columns]
    gem['gkz'] = gem['gkz'].astype(str).str.strip()

    # Add von_bundesland and nach_bundesland via merge
    bl = gem[['gkz', 'bundesland']].drop_duplicates('gkz')
    m = mig_df.copy()
    m = m.merge(bl.rename(columns={'gkz': 'von_gkz', 'bundesland': 'von_bundesland'}),
                on='von_gkz', how='left')
    m = m.merge(bl.rename(columns={'gkz': 'nach_gkz', 'bundesland': 'nach_bundesland'}),
                on='nach_gkz', how='left')

    # agg_timeseries
    ts = m.groupby(['jahr', 'geschlecht'], dropna=False)['anzahl'].sum().reset_index()
    conn.execute('DELETE FROM agg_timeseries')
    ts.to_sql('agg_timeseries', conn, if_exists='append', index=False, method='multi')
    print(f'    agg_timeseries:          {len(ts):>6,} Zeilen')

    # agg_bundeslaender (covers sankey + karte too)
    bl_agg = (m.groupby(['jahr', 'von_bundesland', 'nach_bundesland'], dropna=False)['anzahl']
               .sum().reset_index())
    conn.execute('DELETE FROM agg_bundeslaender')
    bl_agg.to_sql('agg_bundeslaender', conn, if_exists='append', index=False, method='multi')
    print(f'    agg_bundeslaender:       {len(bl_agg):>6,} Zeilen')

    # agg_staatsbuergerschaft
    st = (m.groupby(['jahr', 'staatsbuergerschaft'], dropna=False)['anzahl']
           .sum().reset_index())
    conn.execute('DELETE FROM agg_staatsbuergerschaft')
    st.to_sql('agg_staatsbuergerschaft', conn, if_exists='append', index=False, method='multi')
    print(f'    agg_staatsbuergerschaft: {len(st):>6,} Zeilen')


def _load_file(path):
    try:
        import pandas as pd
    except ImportError:
        print('pandas fehlt. Installieren mit: pip install pandas openpyxl')
        sys.exit(1)
    path = Path(path)
    return pd.read_excel(path) if path.suffix in ('.xlsx', '.xls') else pd.read_csv(path)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description='Migrationsdaten in SQLite importieren')
    p.add_argument('--migrations', help='Pfad zur Migrations-CSV/Excel')
    p.add_argument('--gemeinden',  help='Pfad zur Gemeinden-CSV/Excel')
    p.add_argument('--db',         help='Pfad zur SQLite-Datei', default=str(DEFAULT_DB))
    p.add_argument('--replace',    action='store_true', help='Bestehende Daten ersetzen')
    args = p.parse_args()

    if not args.migrations and not args.gemeinden:
        p.print_help()
        sys.exit(1)

    import_to_db(
        migrations_df=_load_file(args.migrations) if args.migrations else None,
        gemeinden_df=_load_file(args.gemeinden)   if args.gemeinden  else None,
        db_path=args.db,
        replace=args.replace,
    )
