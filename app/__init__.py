import json
from pathlib import Path
from flask import Flask

_GEOJSON_STATIC = {
    'bundeslaender': 'laender_999_geo.json',
    'bezirke':       'bezirke_999_geo.json',
    'gemeinden':     'gemeinden_999_geo.json',
}


def create_app():
    app = Flask(__name__)

    from .data_loader import load_data
    app.config['DF'], app.config['DF_GEM'] = load_data()

    geojson_dir = Path(__file__).parent / 'static' / 'geojson'
    names = {}
    for level, filename in _GEOJSON_STATIC.items():
        p = geojson_dir / filename
        if p.exists():
            with open(p, encoding='utf-8') as f:
                geo = json.load(f)
            names[level] = {
                feat['properties']['iso']: feat['properties']['name']
                for feat in geo['features']
            }
    app.config['GEOJSON_NAMES'] = names

    from .routes import bp
    app.register_blueprint(bp)

    return app