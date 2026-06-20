import pandas as pd
import requests
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / 'data' / 'cache'

MIG_URL = 'https://data.statistik.gv.at/data/OGDEXT_BINNENWAND_1.zip'
GEM_URL = 'https://www.statistik.at/fileadmin/pages/453/RegGemVz2024.ods'


MIG_CACHE   = DATA_DIR / 'OGDEXT_BINNENWAND_1.zip'
GEM_CACHE   = DATA_DIR / 'RegGemVz2024.ods'
PKL_CACHE   = DATA_DIR / 'dataframes.pkl'
ALTER_CACHE = DATA_DIR / 'altersdaten.csv'

# ── Label mappings ────────────────────────────────────────────────────
# Edit these dicts to change how coded values appear everywhere in the app.
# After changing, delete data/cache/dataframes.pkl so the cache is rebuilt.
LABEL_MAP = {
    'geschlecht': {
        '1': 'männlich',
        '2': 'weiblich',
    },
    'staatsbuergerschaft': {
        '1': 'Inländer',
        '2': 'Ausländer',
    },
}


def _download(url, path):
    if path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    print(f'Downloading {url} ...', flush=True)
    r = requests.get(url, timeout=120)
    r.raise_for_status()
    path.write_bytes(r.content)


def _load_migrations():
    _download(MIG_URL, MIG_CACHE)
    df = pd.read_csv(MIG_CACHE, sep=';', decimal=',', header=None)

    new_columns = []
    for col in df.columns:
        sample = str(df.iloc[0, col])
        new_columns.append(sample.split('-')[0] if '-' in sample else f'col_{col}')

    def strip_prefix(val):
        s = str(val)
        return s.split('-', 1)[1] if '-' in s else val

    df = df.map(strip_prefix)
    df.columns = new_columns
    df.columns = ['jahr', 'von', 'nach', 'staatsb', 'geschlecht', 'anzahl']
    df['jahr']   = pd.to_numeric(df['jahr'])
    df['anzahl'] = pd.to_numeric(df['anzahl'])
    df['von']    = df['von'].astype(int)
    df['nach']   = df['nach'].astype(int)
    return df


def _load_gemeinden():
    _download(GEM_URL, GEM_CACHE)
    df = pd.read_excel(GEM_CACHE, engine='odf', sheet_name='Gemeinden', header=0)
    df.columns = df.columns.str.strip()
    df['Gemeinde kennziffer']         = pd.to_numeric(df['Gemeinde kennziffer'], errors='coerce')
    df['Bevölkerungszahl 01.01.2024'] = pd.to_numeric(df['Bevölkerungszahl 01.01.2024'], errors='coerce')
    df = df.dropna(subset=['Gemeinde kennziffer', 'Bundeslandkennziffer']).reset_index(drop=True)
    df['Gemeinde kennziffer']         = df['Gemeinde kennziffer'].astype(int)
    df['Bevölkerungszahl 01.01.2024'] = df['Bevölkerungszahl 01.01.2024'].astype(int)
    return df


def _load_altersdaten():
    # STATcube export: 8 header rows, semicolon-separated, year only in first row of group
    df = pd.read_csv(
        ALTER_CACHE,
        sep=';',
        skiprows=9,
        header=None,
        usecols=[0, 1, 2, 4, 6],
        names=['jahr', 'altersgruppe', 'ueber_gemeindegrenzen', 'innerhalb_gemeinde', 'zwischen_bundeslaendern'],
        encoding='latin-1',
    )
    df = df[df['altersgruppe'].notna() & (df['altersgruppe'].str.strip() != '')]
    df['jahr'] = df['jahr'].replace('', pd.NA).ffill()
    df['jahr'] = pd.to_numeric(df['jahr'], errors='coerce')
    for col in ['ueber_gemeindegrenzen', 'innerhalb_gemeinde', 'zwischen_bundeslaendern']:
        df[col] = pd.to_numeric(df[col], errors='coerce')
    df = df.dropna(subset=['jahr']).reset_index(drop=True)
    df['jahr'] = df['jahr'].astype(int)
    return df


def load_data():
    if PKL_CACHE.exists():
        print('Loading DataFrames from pickle cache ...', flush=True)
        return pd.read_pickle(PKL_CACHE)

    print('Building DataFrames (first run, this takes ~30s) ...', flush=True)
    df_mig = _load_migrations()
    df_gem = _load_gemeinden()

    cols = ['Gemeinde kennziffer', 'Bundesland', 'Name Bezirk', 'Gemeindename',
            'Bevölkerungszahl 01.01.2024']
    sub = df_gem[cols]

    df = pd.merge(df_mig, sub, left_on='von', right_on='Gemeinde kennziffer', how='left')
    df = df.rename(columns={c: f'{c}-von' for c in cols if c != 'Gemeinde kennziffer'})
    df = df.drop(columns=['Gemeinde kennziffer'])

    df = pd.merge(df, sub, left_on='nach', right_on='Gemeinde kennziffer', how='left')
    df = df.rename(columns={c: f'{c}-nach' for c in cols if c != 'Gemeinde kennziffer'})
    df = df.drop(columns=['Gemeinde kennziffer'])

    df = df.rename(columns={
        'staatsb':                          'staatsbuergerschaft',
        'von':                              'von_gkz',
        'nach':                             'nach_gkz',
        'Bundesland-von':                   'von_bundesland',
        'Name Bezirk-von':                  'von_bezirk',
        'Gemeindename-von':                 'von_gemeinde',
        'Bevölkerungszahl 01.01.2024-von':  'von_bevoelkerung',
        'Bundesland-nach':                  'nach_bundesland',
        'Name Bezirk-nach':                 'nach_bezirk',
        'Gemeindename-nach':                'nach_gemeinde',
        'Bevölkerungszahl 01.01.2024-nach': 'nach_bevoelkerung',
    })

    for col, mapping in LABEL_MAP.items():
        if col in df.columns:
            df[col] = df[col].astype(str).map(mapping).fillna(df[col].astype(str))

    df_alter = _load_altersdaten()
    result = (df, df_gem, df_alter)
    pd.to_pickle(result, PKL_CACHE)
    print(f'Ready: {len(df):,} rows, {df["jahr"].nunique()} years', flush=True)
    return result


