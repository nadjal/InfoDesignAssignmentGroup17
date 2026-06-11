import sqlite3
from pathlib import Path
from flask import current_app, g

SCHEMA = '''
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
CREATE INDEX IF NOT EXISTS idx_m_jahr ON migrations(jahr);
CREATE INDEX IF NOT EXISTS idx_m_von  ON migrations(von_gkz);
CREATE INDEX IF NOT EXISTS idx_m_nach ON migrations(nach_gkz);
CREATE TABLE IF NOT EXISTS agg_timeseries (
    jahr INTEGER, geschlecht TEXT, anzahl INTEGER
);
CREATE TABLE IF NOT EXISTS agg_bundeslaender (
    jahr INTEGER, von_bundesland TEXT, nach_bundesland TEXT, anzahl INTEGER
);
CREATE TABLE IF NOT EXISTS agg_staatsbuergerschaft (
    jahr INTEGER, staatsbuergerschaft TEXT, anzahl INTEGER
);
DROP VIEW IF EXISTS v_migrations;
CREATE VIEW v_migrations AS
    SELECT
        m.jahr,
        m.geschlecht,
        m.staatsb              AS staatsbuergerschaft,
        m.anzahl,
        m.von_gkz,
        m."Bundesland-von"    AS von_bundesland,
        m."Name Bezirk-von"   AS von_bezirk,
        m."Gemeindename-von"  AS von_gemeinde,
        m.nach_gkz,
        m."Bundesland-nach"   AS nach_bundesland,
        m."Name Bezirk-nach"  AS nach_bezirk,
        m."Gemeindename-nach" AS nach_gemeinde
    FROM migrations m;
'''


def get_db():
    if 'db' not in g:
        db_path = current_app.config['DATABASE']
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        g.db = sqlite3.connect(db_path, detect_types=sqlite3.PARSE_DECLTYPES)
        g.db.row_factory = sqlite3.Row
    return g.db


def close_db(e=None):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_app(app):
    app.teardown_appcontext(close_db)
    with app.app_context():
        db = get_db()
        for stmt in SCHEMA.split(';'):
            if stmt.strip():
                db.execute(stmt)
        db.commit()
