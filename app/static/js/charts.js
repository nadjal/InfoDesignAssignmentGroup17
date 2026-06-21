/* ── Color palette ────────────────────────────────────────────────── */
const C = {
  primary:  '#1E3A5F',
  accent:   '#0EA5E9',
  warm:     '#F59E0B',
  success:  '#10B981',
  danger:   '#EF4444',
  purple:   '#6366F1',
  teal:     '#14B8A6',
  orange:   '#F97316',
};

const SEQ = [
  '#1E3A5F', '#0EA5E9', '#F59E0B', '#10B981',
  '#6366F1', '#EC4899', '#14B8A6', '#F97316',
];

/* ── Plotly base layout & config ──────────────────────────────────── */
const BASE = {
  paper_bgcolor: 'transparent',
  plot_bgcolor:  '#FAFCFF',
  font: { family: "'Inter', -apple-system, sans-serif", color: '#0F172A', size: 12 },
  colorway: SEQ,
  xaxis: {
    gridcolor: '#E2E8F0', linecolor: '#E2E8F0', zerolinecolor: '#CBD5E1',
    tickfont: { size: 11, color: 'white' },
  },
  yaxis: {
    gridcolor: '#E2E8F0', linecolor: 'transparent', zerolinecolor: '#CBD5E1',
    tickfont: { size: 11, color: 'white' },
  },
  legend: { bgcolor: 'transparent', font: { size: 11, color: 'white' } },
  hoverlabel: {
    bgcolor: 'white',
    bordercolor: '#E2E8F0',
    font: { family: "'Inter', sans-serif", size: 12, color: '#0F172A' },
  },
  margin: { t: 24, r: 20, b: 52, l: 64 },
};

const CFG = {
  displayModeBar: true,
  modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d'],
  displaylogo: false,
  responsive: true,
  toImageButtonOptions: { format: 'svg', filename: 'binnenmigration-at' },
};

function lay(overrides) {
  return Object.assign({}, BASE, overrides,
    overrides.xaxis ? { xaxis: Object.assign({}, BASE.xaxis, overrides.xaxis) } : {},
    overrides.yaxis ? { yaxis: Object.assign({}, BASE.yaxis, overrides.yaxis) } : {},
  );
}

/* ── Utilities ────────────────────────────────────────────────────── */
function loading(el) {
  el.innerHTML = '<div class="loading"><div class="spinner"></div>Loading data …</div>';
}

function errState(el, msg = 'No data available.') {
  el.innerHTML = `<div class="error-state"><p>${msg}</p></div>`;
}

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function fmt(n) {
  return new Intl.NumberFormat('de-AT').format(Math.round(n));
}

function animateCounter(el, target, suffix) {
  const dur = 1400;
  const t0  = performance.now();
  function tick(now) {
    const p = Math.min((now - t0) / dur, 1);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(Math.round(e * target)) + (suffix || '');
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/* ── Year slider (reusable) ───────────────────────────────────────── */
function initYearSlider({ years, sliderId, displayId, btnAllId, btnPrevId, btnPlayId, btnNextId, onChange, animMs = 2000 }) {
  if (!years.length) return;

  const slider  = document.getElementById(sliderId);
  const display = document.getElementById(displayId);
  const btnAll  = document.getElementById(btnAllId);
  const btnPrev = document.getElementById(btnPrevId);
  const btnNext = document.getElementById(btnNextId);
  const btnPlay = document.getElementById(btnPlayId);

  let current   = years[years.length - 1];
  let animTimer = null;

  slider.max   = years.length;
  slider.value = years.length - 1;
  display.textContent = current;

  function applyYear(year) {
    current = year;
    slider.value = year !== null ? years.indexOf(year) : years.length;
    display.textContent = year !== null ? year : 'All';
    if (btnAll)  btnAll.classList.toggle('active', year === null);
    if (btnPrev) btnPrev.disabled = year === years[0];
    if (btnNext) btnNext.disabled = year === null;
    onChange(year);
  }

  function stopAnim() {
    clearInterval(animTimer); animTimer = null;
    if (btnPlay) { btnPlay.textContent = '▶'; btnPlay.classList.remove('playing'); }
  }

  function startAnim() {
    stopAnim();
    if (current === null || current === years[years.length - 1]) applyYear(years[0]);
    if (btnPlay) { btnPlay.textContent = '⏸'; btnPlay.classList.add('playing'); }
    animTimer = setInterval(() => {
      const idx = years.indexOf(current);
      if (idx >= years.length - 1) { stopAnim(); } else { applyYear(years[idx + 1]); }
    }, animMs);
  }

  slider.addEventListener('input', function () {
    stopAnim();
    const idx = parseInt(this.value);
    applyYear(idx < years.length ? years[idx] : null);
  });
  if (btnAll)  btnAll.addEventListener('click',  () => { stopAnim(); applyYear(null); });
  if (btnPrev) btnPrev.addEventListener('click', () => { stopAnim(); applyYear(years[Math.max(0, years.indexOf(current) - 1)]); });
  if (btnNext) btnNext.addEventListener('click', () => { stopAnim(); if (current !== null) applyYear(years[Math.min(years.length - 1, years.indexOf(current) + 1)]); });
  if (btnPlay) btnPlay.addEventListener('click', () => { animTimer ? stopAnim() : startAnim(); });

  if (btnPrev) btnPrev.disabled = current === years[0];
  if (btnNext) btnNext.disabled = false;
}

/* ── Overview counters ────────────────────────────────────────────── */
async function initOverview() {
  try {
    const d = await fetchJSON('/api/overview');

    const total = document.getElementById('counter-total');
    const years = document.getElementById('counter-years');
    const range = document.getElementById('counter-years-range');
    const gem   = document.getElementById('counter-gemeinden');

    if (total) animateCounter(total, d.total_migrations);
    if (years) {
      const span = d.year_max - d.year_min + 1;
      animateCounter(years, span, ' Years');
      if (range) range.textContent = `${d.year_min} – ${d.year_max}`;
    }
    if (gem) animateCounter(gem, d.gemeinden_count);
  } catch (e) {
    console.warn('Overview failed:', e);
  }
}

/* ── Migrationstypen (Pie) ────────────────────────────────────────── */
const MIGRATION_TYPEN = [
  { key: 'innerhalb_bundesland',   label: 'Within Federal State',   color: '#34D399' },
  { key: 'innerhalb_gemeinde',     label: 'Within Municipality',     color: '#FACC15' },
  { key: 'zwischen_bundeslaender', label: 'Between Federal States', color: '#60A5FA' },
];
let _migrationTypenData = null;

function _migrationTypenRow(year) {
  if (!_migrationTypenData) return null;
  return year
    ? _migrationTypenData.find(d => d.jahr === year)
    : _migrationTypenData.reduce((acc, d) => ({
        zwischen_bundeslaender: (acc.zwischen_bundeslaender || 0) + d.zwischen_bundeslaender,
        innerhalb_bundesland:   (acc.innerhalb_bundesland   || 0) + d.innerhalb_bundesland,
        innerhalb_gemeinde:     (acc.innerhalb_gemeinde     || 0) + d.innerhalb_gemeinde,
      }), {});
}

async function renderMigrationTypen(id, year = null) {
  const el = document.getElementById(id);
  if (!el) return;
  try {
    if (!_migrationTypenData) {
      _migrationTypenData = await fetchJSON('/api/migration_typen');
    }
    const row = _migrationTypenRow(year);
    if (!row) { errState(el, 'No data available for this year.'); return; }

    const values = MIGRATION_TYPEN.map(t => row[t.key] || 0);

    if (el._fullLayout) {
      Plotly.restyle(el, { values: [values] }, [0]);
    } else {
      el.innerHTML = '';
      Plotly.newPlot(el, [{
        labels: MIGRATION_TYPEN.map(t => t.label),
        values,
        type: 'pie', hole: 0.55, direction: 'clockwise', sort: false, rotation: 0,
        textinfo: 'label+percent',
        textposition: 'outside',
        textfont: { size: 11, color: 'white' },
        automargin: true,
        hovertemplate: '<b>%{label}</b><br>%{value:,.0f} people <br>%{percent}<extra></extra>',
        marker: { colors: MIGRATION_TYPEN.map(t => t.color), line: { color: '#1a2535', width: 2 } },
      }], {
        paper_bgcolor: 'transparent',
        font: { ...BASE.font, color: 'white' },
        showlegend: false,
        margin: { t: 40, r: 80, b: 40, l: 80 },
      }, CFG);
    }
  } catch (e) { errState(el); }
}

/* ── Zeitreihe ────────────────────────────────────────────────────── */
async function renderTimeseries(id, highlightYear = null) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = '';
  try {
    const data = await fetchJSON('/api/timeseries');
    const years = [...new Set(data.map(d => d.jahr))].sort();
    const groups = [...new Set(data.map(d => d.geschlecht))];

    const totals = years.map(y =>
      data.filter(d => d.jahr === y).reduce((s, d) => s + (d.total || 0), 0)
    );

    const traces = [];

    traces.push({
      x: years, y: totals,
      type: 'scatter', mode: 'none',
      fill: 'tozeroy', fillcolor: 'rgba(14,165,233,0.06)',
      name: 'Total', showlegend: false, hoverinfo: 'skip',
    });

    const DARK_LINE_COLORS = ['#FB923C', '#60A5FA'];
    groups.forEach((g, i) => {
      const color = DARK_LINE_COLORS[i];
      traces.push({
        x: years,
        y: years.map(y => { const r = data.find(d => d.jahr === y && d.geschlecht === g); return r ? r.total : 0; }),
        name: g, showlegend: false, legendgroup: g,
        type: 'scatter', mode: 'lines+markers',
        line: { width: 2.5, shape: 'spline', smoothing: 0.4, color },
        marker: { size: 5, color },
        hovertemplate: '<b>%{y:,.0f}</b> people <extra>%{fullData.name}</extra>',
      });
      traces.push({
        x: [null], y: [null], name: g, showlegend: true, legendgroup: g,
        type: 'scatter', mode: 'markers',
        marker: { symbol: 'square', size: 10, color },
        hoverinfo: 'skip',
      });
    });

    traces.push({
      x: years, y: totals,
      name: 'Total',
      type: 'scatter', mode: 'lines',
      line: { width: 2, dash: 'dot', color: 'rgba(255,255,255,0.4)' },
      hovertemplate: '<b>%{y:,.0f}</b> total<extra></extra>',
    });

    const shapes = highlightYear ? [{
      type: 'line',
      x0: highlightYear, x1: highlightYear, y0: 0, y1: 1, yref: 'paper',
      line: { color: 'rgba(255,255,255,0.35)', width: 1.5, dash: 'dot' },
    }] : [];

    Plotly.newPlot(el, traces, lay({
      plot_bgcolor: '#1a2535',
      hovermode: 'x unified',
      xaxis: { gridcolor: 'rgba(255,255,255,0.08)', zerolinecolor: 'rgba(255,255,255,0.15)' },
      yaxis: { tickformat: ',.0f', gridcolor: 'rgba(255,255,255,0.08)', zerolinecolor: 'rgba(255,255,255,0.15)' },
      legend: { orientation: 'v', x: 1.01, xanchor: 'left', font: { size: 11, color: 'white' } },
      margin: { t: 24, r: 160, b: 52, l: 64 },
      shapes,
    }), CFG);
  } catch (e) { errState(el); }
}

/* ── Altersgruppen-Wanderungstypen (stacked bar) ──────────────────── */
async function renderAltersgruppen(id, year = null) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = '';
  try {
    const url = year ? `/api/altersgruppen?year=${year}` : '/api/altersgruppen';
    const data = await fetchJSON(url);
    if (!data.length) { errState(el, 'No data available for this year.'); return; }

    const groups = data.map(d => d.altersgruppe);
    const traces = MIGRATION_TYPEN.map(t => ({
      name:        t.label,
      y:           groups,
      x:           data.map(d => d[t.key] || 0),
      type:        'bar',
      orientation: 'h',
      marker:      { color: t.color },
      hovertemplate: `<b>%{y}</b><br>${t.label}: <b>%{x:,.0f}</b><extra></extra>`,
    }));

    Plotly.newPlot(el, traces, lay({
      barmode:      'stack',
      plot_bgcolor: '#1a2535',
      margin:       { t: 16, r: 16, b: 48, l: 130 },
      xaxis: {
        tickformat: ',.0f',
        title: { text: 'Migrations', font: { size: 11, color: 'white' } },
        gridcolor: 'rgba(255,255,255,0.08)',
        zerolinecolor: 'rgba(255,255,255,0.15)',
      },
      yaxis: { automargin: true, gridcolor: 'rgba(255,255,255,0.08)', linecolor: 'rgba(255,255,255,0.08)' },
      legend: { orientation: 'h', x: 0, y: -0.18, font: { size: 10, color: 'white' } },
      showlegend: true,
    }), CFG);
  } catch (e) { errState(el); }
}

/* ── Staatsbürgerschaft-Zeitreihe ────────────────────────────────── */
const STAAT_COLORS = ['#FB923C', '#60A5FA', '#F59E0B', '#3B82F6', '#FDBA74', '#93C5FD', '#EA580C', '#1D4ED8'];

async function renderStaatsbuergerschaft(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = '';
  try {
    const data    = await fetchJSON('/api/timeseries_staatsbuergerschaft');
    const years   = [...new Set(data.map(d => d.jahr))].sort();
    const staaten = [...new Set(data.map(d => d.staatsbuergerschaft))];
    const STAAT_LABELS = {
      'Inländer':  'Austrian<br>Citizenship',
      'Ausländer': 'Non-Austrian<br>Citizenship',
    };

    const totals = years.map(y =>
      data.filter(d => d.jahr === y).reduce((s, d) => s + (d.total || 0), 0)
    );

    const traces = [];

    traces.push({
      x: years, y: totals,
      type: 'scatter', mode: 'none',
      fill: 'tozeroy', fillcolor: 'rgba(14,165,233,0.06)',
      name: 'total', showlegend: false, hoverinfo: 'skip',
    });

    staaten.forEach((s, i) => {
      const color = STAAT_COLORS[i % STAAT_COLORS.length];
      const label = STAAT_LABELS[s] || s;
      traces.push({
        x: years,
        y: years.map(y => { const r = data.find(d => d.jahr === y && d.staatsbuergerschaft === s); return r ? r.total : 0; }),
        name: label, showlegend: false, legendgroup: s,
        type: 'scatter', mode: 'lines+markers',
        line:   { width: 2.5, shape: 'spline', smoothing: 0.4, color },
        marker: { size: 5, color },
        hovertemplate: '<b>%{y:,.0f}</b> people<extra>%{fullData.name}</extra>',
      });
      traces.push({
        x: [null], y: [null], name: label, showlegend: true, legendgroup: s,
        type: 'scatter', mode: 'markers',
        marker: { symbol: 'square', size: 10, color },
        hoverinfo: 'skip',
      });
    });

    traces.push({
      x: years, y: totals,
      name: 'total',
      type: 'scatter', mode: 'lines',
      line: { width: 2, dash: 'dot', color: 'rgba(255,255,255,0.4)' },
      hovertemplate: '<b>%{y:,.0f}</b> total<extra></extra>',
    });

    Plotly.newPlot(el, traces, lay({
      plot_bgcolor: '#1a2535',
      hovermode: 'x unified',
      xaxis: { gridcolor: 'rgba(255,255,255,0.08)', zerolinecolor: 'rgba(255,255,255,0.15)' },
      yaxis: { tickformat: ',.0f', gridcolor: 'rgba(255,255,255,0.08)', zerolinecolor: 'rgba(255,255,255,0.15)' },
      legend: { orientation: 'v', x: 1.01, xanchor: 'left', font: { size: 11, color: 'white' } },
      margin: { t: 24, r: 200, b: 52, l: 64 },
    }), CFG);
  } catch (e) { errState(el); }
}

/* ── Sankey ───────────────────────────────────────────────────────── */
async function renderSankey(id, year = null) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = '';
  try {
    const url = year ? `/api/sankey?year=${year}` : '/api/sankey';
    const d = await fetchJSON(url);
    if (!d.bundeslaender || !d.flows.length) { errState(el, 'No flow data available.'); return; }

    const bls = [...d.bundeslaender].sort();
    const n   = bls.length;

    const colorOf = Object.fromEntries(bls.map((bl, i) => [bl, BL_COLORS[i % BL_COLORS.length]]));

    function rgba(hex, a) {
      const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
      return `rgba(${r},${g},${b},${a})`;
    }

    const yPos = bls.map((_, i) => n > 1 ? 0.1 + i * 0.8 / (n - 1) : 0.5);

    const srcIdx = Object.fromEntries(bls.map((bl, i) => [bl, i]));
    const tgtIdx = Object.fromEntries(bls.map((bl, i) => [bl, i + n]));

    Plotly.newPlot(el, [{
      type: 'sankey',
      arrangement: 'fixed',
      node: {
        pad: 50, thickness: 30,
        line: { color: '#000', width: 1 },
        label: [...bls, ...bls],
        color: [...bls.map(bl => colorOf[bl]), ...bls.map(bl => colorOf[bl])],
        x: [...Array(n).fill(0.01), ...Array(n).fill(0.99)],
        y: [...yPos, ...yPos],
      },
      link: {
        source: d.flows.map(f => srcIdx[f.von]),
        target: d.flows.map(f => tgtIdx[f.nach]),
        value:  d.flows.map(f => f.total),
        color:  d.flows.map(f => rgba(colorOf[f.von], 0.3)),
        hovertemplate: 'From: %{source.label}<br>To: %{target.label}<br>Count: <b>%{value:,.0f}</b><extra></extra>',
      },
    }], {
      paper_bgcolor: 'transparent',
      font: { ...BASE.font, size: 13, color: 'white' },
      margin: { t: 8, r: 50, b: 8, l: 50 },
    }, CFG);
  } catch (e) { errState(el); }
}

/* ── Jahresvergleich mit Durchschnitt ────────────────────────────── */
async function renderJahresvergleich(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = '';
  try {
    if (!_migrationTypenData) {
      _migrationTypenData = await fetchJSON('/api/migration_typen');
    }
    const years  = _migrationTypenData.map(d => d.jahr);
    const totals = _migrationTypenData.map(d => d.total);
    const avg    = Math.round(totals.reduce((s, v) => s + v, 0) / totals.length);

    Plotly.newPlot(el, [
      {
        x: years, y: totals,
        type: 'scatter', mode: 'none',
        fill: 'tozeroy', fillcolor: 'rgba(96,165,250,0.15)',
        name: 'Migrations', showlegend: false, hoverinfo: 'skip',
      },
      {
        x: years, y: totals,
        type: 'scatter', mode: 'lines+markers',
        line: { width: 2.5, shape: 'spline', smoothing: 0.4, color: '#60A5FA' },
        marker: { size: 5, color: '#60A5FA' },
        name: 'Migrations', showlegend: false,
        hovertemplate: '<b>%{x}</b><br>%{y:,.0f} Migrations<extra></extra>',
      },
      {
        x: [years[0], years[years.length - 1]],
        y: [avg, avg],
        type: 'scatter', mode: 'lines',
        line: { color: 'rgba(255,255,255,0.5)', width: 2, dash: 'dot' },
        name: `Ø ${fmt(avg)} / Year`,
        hovertemplate: `Average: <b>${fmt(avg)}</b><extra></extra>`,
      },
    ], lay({
      plot_bgcolor: '#1a2535',
      hovermode: 'x unified',
      xaxis: { gridcolor: 'rgba(255,255,255,0.08)', zerolinecolor: 'rgba(255,255,255,0.15)' },
      yaxis: { tickformat: ',.0f', gridcolor: 'rgba(255,255,255,0.08)', zerolinecolor: 'rgba(255,255,255,0.15)' },
      legend: { x: 1.01, xanchor: 'left', font: { size: 11, color: 'white' } },
    }), CFG);
  } catch (e) { errState(el); }
}

/* ── Migrationstypen Zeitreihe ───────────────────────────────────── */
async function renderMigrationTypenZeitreihe(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = '';
  try {
    if (!_migrationTypenData) {
      _migrationTypenData = await fetchJSON('/api/migration_typen');
    }
    const years  = _migrationTypenData.map(d => d.jahr);
    const totals = years.map((_, i) => _migrationTypenData[i].total);
    const traces = [];

    traces.push({
      x: years, y: totals,
      type: 'scatter', mode: 'none',
      fill: 'tozeroy', fillcolor: 'rgba(14,165,233,0.06)',
      showlegend: false, hoverinfo: 'skip',
    });

    MIGRATION_TYPEN.forEach(t => {
      const color = t.color;
      traces.push({
        x: years,
        y: _migrationTypenData.map(d => d[t.key] || 0),
        name: t.label, showlegend: false, legendgroup: t.key,
        type: 'scatter', mode: 'lines+markers',
        line:   { width: 2.5, shape: 'spline', smoothing: 0.4, color },
        marker: { size: 5, color },
        hovertemplate: '<b>%{y:,.0f}</b> people<extra>%{fullData.name}</extra>',
      });
      traces.push({
        x: [null], y: [null], name: t.label, showlegend: true, legendgroup: t.key,
        type: 'scatter', mode: 'markers',
        marker: { symbol: 'square', size: 10, color },
        hoverinfo: 'skip',
      });
    });

    traces.push({
      x: years, y: totals,
      name: 'total',
      type: 'scatter', mode: 'lines',
      line: { width: 2, dash: 'dot', color: 'rgba(255,255,255,0.4)' },
      hovertemplate: '<b>%{y:,.0f}</b> total<extra></extra>',
    });

    Plotly.newPlot(el, traces, lay({
      plot_bgcolor: '#1a2535',
      hovermode: 'x unified',
      xaxis: { gridcolor: 'rgba(255,255,255,0.08)', zerolinecolor: 'rgba(255,255,255,0.15)' },
      yaxis: { tickformat: ',.0f', gridcolor: 'rgba(255,255,255,0.08)', zerolinecolor: 'rgba(255,255,255,0.15)' },
      legend: { orientation: 'v', x: 1.01, xanchor: 'left', font: { size: 11, color: 'white' } },
      margin: { t: 24, r: 160, b: 52, l: 64 },
    }), CFG);
  } catch (e) { errState(el); }
}

/* ── Zeitreihe nach Bundesland ────────────────────────────────────── */
const BL_COLORS = [
  '#60A5FA', // Burgenland  — blau
  '#FB923C', // Kärnten     — orange
  '#4ADE80', // Niederösterreich — grün
  '#F87171', // Oberösterreich   — rot
  '#C084FC', // Salzburg    — lila
  '#A16207', // Steiermark  — braun
  '#F472B6', // Tirol       — rosa
  '#94A3B8', // Vorarlberg  — grau
  '#FACC15', // Wien        — gelb
];

async function renderTimeseriesBundeslaender(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = '';
  try {
    const data = await fetchJSON('/api/timeseries_bundeslaender');
    const years = [...new Set(data.map(d => d.jahr))].sort();
    const bls   = [...new Set(data.map(d => d.bundesland))].sort();

    const traces = bls.map((bl, i) => ({
      x: years,
      y: years.map(y => { const r = data.find(d => d.jahr === y && d.bundesland === bl); return r ? r.netto : 0; }),
      name: bl,
      type: 'scatter', mode: 'lines+markers',
      line:   { width: 2.5, shape: 'spline', smoothing: 0.4, color: BL_COLORS[i % BL_COLORS.length] },
      marker: { size: 5, color: BL_COLORS[i % BL_COLORS.length] },
      hovertemplate: '<b>%{y:+,.0f}</b> people<extra>%{fullData.name}</extra>',
    }));

    Plotly.newPlot(el, traces, lay({
      plot_bgcolor: '#1a2535',
      hovermode: 'x unified',
      xaxis: { gridcolor: 'rgba(255,255,255,0.08)', zerolinecolor: 'rgba(255,255,255,0.15)' },
      yaxis: { tickformat: '+,.0f', gridcolor: 'rgba(255,255,255,0.08)', zerolinecolor: 'rgba(255,255,255,0.3)', zerolinewidth: 2 },
      legend: { orientation: 'v', x: 1.01, xanchor: 'left', font: { size: 11, color: 'white' } },
      margin: { t: 24, r: 160, b: 52, l: 64 },
    }), CFG);
  } catch (e) { errState(el); }
}

/* ── Choropleth map — Leaflet (karte.html) ───────────────────────── */

const _geojsonPromises   = {};
const _choroplethPromises = {};   // `${level}|${year}` -> Promise<data>
const _leafletMaps        = {};   // id -> { map, layer, legend, level, dataMap }
const _prebuilt           = {};   // id -> { level -> { layer, dataMap, maxAbs, metric, year } }

const _GEOJSON_URLS = {
  bundeslaender: '/static/geojson/laender_999_geo.json',
  bezirke:       '/static/geojson/bezirke_999_geo.json',
  gemeinden:     '/static/geojson/gemeinden_999_geo.json',
};

// Zoom thresholds for Austria: BL → Bezirke → Gemeinden
function _levelForZoom(zoom) {
  if (zoom < 8)  return 'bundeslaender';
  if (zoom < 10) return 'bezirke';
  return 'gemeinden';
}

function fetchGeoJSON(level) {
  if (!_geojsonPromises[level])
    _geojsonPromises[level] = fetchJSON(_GEOJSON_URLS[level]);
  return _geojsonPromises[level];
}

function _fetchChoroplethData(level, year) {
  const key = `${level}|${year ?? ''}`;
  if (!_choroplethPromises[key])
    _choroplethPromises[key] = fetchJSON(`/api/choropleth?level=${level}${year ? '&year=' + year : ''}`);
  return _choroplethPromises[key];
}

function _lerpColor(hex1, hex2, t) {
  const p = (h, o) => parseInt(h.slice(o, o+2), 16);
  const r = Math.round(p(hex1,1) + (p(hex2,1) - p(hex1,1)) * t);
  const g = Math.round(p(hex1,3) + (p(hex2,3) - p(hex1,3)) * t);
  const b = Math.round(p(hex1,5) + (p(hex2,5) - p(hex1,5)) * t);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

// 95th-percentile absolute value — prevents outliers from washing out the colour scale.
function _p95(data, metric) {
  const vals = data.map(d => Math.abs(d[metric])).sort((a, b) => a - b);
  return Math.max(vals[Math.floor(vals.length * 0.95)] ?? vals[vals.length - 1] ?? 1, 1);
}

function _choroColor(val, metric, maxAbs) {
  if (val == null || maxAbs === 0) return '#CBD5E1';
  if (metric === 'netto') {
    const t = Math.max(0, Math.min(1, (val + maxAbs) / (2 * maxAbs)));
    return t < 0.5 ? _lerpColor('#D73027', '#F7F7F7', t * 2) : _lerpColor('#F7F7F7', '#4575B4', (t - 0.5) * 2);
  }
  return _lerpColor('#EFF6FF', '#1E3A5F', Math.min(val / maxAbs, 1));
}

function _tooltipContent(name, d) {
  if (!d) return `<b>${name}</b><br>Keine Daten`;
  const sign = d.netto >= 0 ? '+' : '';
  return `<b>${name}</b><br>Netto: <b>${sign}${fmt(d.netto)}</b><br>Zuzug: ${fmt(d.zuzug)}<br>Wegzug: ${fmt(d.wegzug)}`;
}

function _addLegend(map, metric, maxAbs) {
  const TITLES = { netto: 'Net Migration', zuzug: 'In-Migration', wegzug: 'Out-Migration' };
  const grad   = metric === 'netto'
    ? 'linear-gradient(to right,#D73027,#F7F7F7,#4575B4)'
    : 'linear-gradient(to right,#EFF6FF,#1E3A5F)';
  const lo = metric === 'netto' ? fmt(-maxAbs) : '0';
  const hi = (metric === 'netto' ? '+' : '') + fmt(maxAbs);

  /* ── Horizontale Top-Legende (Karten-/Story-Seite) ── */
  const topEl = document.getElementById('story-legend');
  if (topEl) {
    topEl.innerHTML =
      `<div class="leg-title">${TITLES[metric] || metric}</div>` +
      `<div class="leg-bar">` +
        `<span class="leg-lbl leg-lbl-left">${lo}</span>` +
        `<span class="leg-grad" style="background:${grad}"></span>` +
        `<span class="leg-lbl leg-lbl-right">${hi}</span>` +
      `</div>`;
    /* Kein Leaflet-Control nötig — Dummy mit .remove() zurückgeben */
    return { remove() {} };
  }

  /* ── Fallback: Leaflet-Control unten rechts (andere Seiten) ── */
  const ctrl = L.control({ position: 'bottomright' });
  ctrl.onAdd = () => {
    const div = L.DomUtil.create('div', 'choropleth-legend');
    div.innerHTML =
      `<div class="leg-title">${TITLES[metric] || metric}</div>` +
      `<div class="leg-row">` +
        `<span class="leg-lbl">${lo}</span>` +
        `<span class="leg-grad" style="background:${grad}"></span>` +
        `<span class="leg-lbl">${hi}</span>` +
      `</div>`;
    return div;
  };
  ctrl.addTo(map);
  return ctrl;
}

// Creates the Leaflet map once. onZoom(zoom) is called on every zoomend.
function initChoroplethMap(id, onZoom) {
  if (_leafletMaps[id]) return;
  const el = document.getElementById(id);
  if (!el) return;

  const map = L.map(el, { zoomControl: true, attributionControl: false, renderer: L.canvas() });
  map.fitBounds([[46.38, 9.6], [48.85, 17.1]], { paddingTopLeft: [10, 10], paddingBottomRight: [10, 36] });
  _leafletMaps[id] = { map, layer: null, legend: null, level: null, dataMap: null };

  let _zoomTimer = null;
  map.on('zoomend', () => {
    clearTimeout(_zoomTimer);
    _zoomTimer = setTimeout(() => onZoom(map.getZoom()), 120);
  });

  // Pre-warm all GeoJSON + API data immediately in background
  ['bezirke', 'gemeinden'].forEach(l => {
    fetchGeoJSON(l).catch(() => {});
  });
}

// Builds a GeoJSON layer in the background and stores it for instant use on level switch.
async function prebuildChoroplethLayer(id, level, metric, year) {
  const state = _leafletMaps[id];
  if (!state) return;
  const [geo, data] = await Promise.all([fetchGeoJSON(level), _fetchChoroplethData(level, year)]);
  const dataMap = Object.fromEntries(data.map(d => [d.iso, d]));
  const maxAbs  = _p95(data, metric);
  const layer   = L.geoJSON(geo, {
    renderer: L.canvas(),
    style: f => ({
      fillColor:   _choroColor(dataMap[f.properties.iso]?.[metric] ?? null, metric, maxAbs),
      fillOpacity: 0.75,
      color:       'white',
      weight:      level === 'gemeinden' ? 0.3 : 0.8,
    }),
    onEachFeature: (f, lyr) => {
      const d    = dataMap[f.properties.iso];
      const name = d?.name || f.properties.name || f.properties.iso;
      lyr.bindTooltip(_tooltipContent(name, d), { sticky: true, className: 'choropleth-tt' });
    },
  });
  if (!_prebuilt[id]) _prebuilt[id] = {};
  _prebuilt[id][level] = { layer, dataMap, maxAbs, metric, year: year ?? null };
}

// Discards stale pre-built layers (call when metric or year changes).
function clearPrebuilt(id) {
  _prebuilt[id] = {};
}

// Updates the choropleth layer and legend. Map must already exist via initChoroplethMap.
async function renderChoropleth(id, level, metric, year) {
  const state = _leafletMaps[id];
  if (!state) return;

  try {
    const levelChanged = state.level !== level;

    if (levelChanged) {
      // Use pre-built layer if it matches current metric + year
      const pb = _prebuilt[id]?.[level];
      if (pb && pb.metric === metric && pb.year === (year ?? null)) {
        if (state.layer) state.map.removeLayer(state.layer);
        pb.layer.addTo(state.map);
        state.layer   = pb.layer;
        state.level   = level;
        state.dataMap = pb.dataMap;
        if (state.legend) state.legend.remove();
        state.legend  = _addLegend(state.map, metric, pb.maxAbs);
        delete _prebuilt[id][level];
        return;
      }

      // Not pre-built: build now
      const [geo, data] = await Promise.all([fetchGeoJSON(level), _fetchChoroplethData(level, year)]);
      const dataMap = Object.fromEntries(data.map(d => [d.iso, d]));
      const maxAbs  = _p95(data, metric);

      if (state.layer) state.map.removeLayer(state.layer);
      state.layer = L.geoJSON(geo, {
        renderer: L.canvas(),
        style: f => ({
          fillColor:   _choroColor(dataMap[f.properties.iso]?.[metric] ?? null, metric, maxAbs),
          fillOpacity: 0.75,
          color:       'white',
          weight:      level === 'gemeinden' ? 0.3 : 0.8,
        }),
        onEachFeature: (f, lyr) => {
          const d    = dataMap[f.properties.iso];
          const name = d?.name || f.properties.name || f.properties.iso;
          lyr.bindTooltip(_tooltipContent(name, d), { sticky: true, className: 'choropleth-tt' });
        },
      }).addTo(state.map);
      state.level   = level;
      state.dataMap = dataMap;
      if (state.legend) state.legend.remove();
      state.legend  = _addLegend(state.map, metric, maxAbs);

    } else {
      // Same level — only restyle colors
      const data    = await _fetchChoroplethData(level, year);
      const dataMap = Object.fromEntries(data.map(d => [d.iso, d]));
      const maxAbs  = _p95(data, metric);
      state.layer.setStyle(f => ({
        fillColor:   _choroColor(dataMap[f.properties.iso]?.[metric] ?? null, metric, maxAbs),
        fillOpacity: 0.75,
      }));
      state.layer.eachLayer(lyr => {
        const d    = dataMap[lyr.feature.properties.iso];
        const name = d?.name || lyr.feature.properties.name || lyr.feature.properties.iso;
        lyr.setTooltipContent(_tooltipContent(name, d));
      });
      state.dataMap = dataMap;
      if (state.legend) state.legend.remove();
      state.legend  = _addLegend(state.map, metric, maxAbs);
    }
  } catch(e) { console.error('choropleth', e); }
}

/* ── Geo map (karte.html) ─────────────────────────────────────────── */
function renderGeoMap(id, data, metric = 'netto') {
  const el = document.getElementById(id);
  if (!el || !data.length) { if (el) errState(el); return; }

  const vals    = data.map(d => d[metric]);
  const maxAbs  = Math.max(...vals.map(Math.abs), 1);
  const maxTot  = Math.max(...data.map(d => d.total), 1);

  const SCALE = metric === 'netto'
    ? [[0, '#EF4444'], [0.5, '#F1F5F9'], [1, '#10B981']]
    : [[0, '#EFF6FF'], [1, '#1E3A5F']];

  Plotly.newPlot(el, [{
    type: 'scattergeo',
    lat:  data.map(d => d.lat),
    lon:  data.map(d => d.lon),
    mode: 'markers+text',
    text: data.map(d => d.bundesland),
    textposition: 'top center',
    textfont: { size: 10, color: '#1E3A5F', family: "'Inter', sans-serif" },
    marker: {
      size:        data.map(d => 18 + (d.total / maxTot) * 46),
      color:       vals,
      colorscale:  SCALE,
      cmin: metric === 'netto' ? -maxAbs : 0,
      cmax: maxAbs,
      opacity:     0.82,
      line: { color: 'white', width: 1.5 },
      colorbar: {
        title:     { text: metric === 'netto' ? 'Netto' : 'Volumen', font: { size: 11 } },
        thickness: 10,
        len:       0.55,
        tickformat: ',.0f',
      },
    },
    customdata: data.map(d => [d.zuzug, d.ausziehend, d.netto, d.total]),
    hovertemplate:
      '<b>%{text}</b><br>' +
      'In-Migration:  %{customdata[0]:,.0f}<br>' +
      'Out-Migration: %{customdata[1]:,.0f}<br>' +
      'Net:  %{customdata[2]:,.0f}<br>' +
      'Total: %{customdata[3]:,.0f}' +
      '<extra></extra>',
  }], {
    paper_bgcolor: 'transparent',
    font: BASE.font,
    margin: { t: 8, r: 8, b: 8, l: 8 },
    geo: {
      scope:          'europe',
      showland:       true,
      landcolor:      '#F1F5F9',
      showocean:      true,
      oceancolor:     '#EFF6FF',
      showcountries:  true,
      countrycolor:   '#CBD5E1',
      showframe:      false,
      showcoastlines: false,
      lonaxis:        { range: [8.5, 18.0] },
      lataxis:        { range: [45.8, 49.8] },
      bgcolor:        'transparent',
    },
  }, { ...CFG, displayModeBar: false });
}
