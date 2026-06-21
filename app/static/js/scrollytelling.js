/* ── Scrollytelling: Bundesländer → Bezirke → Dots-Chart ────────── */
(function () {
  'use strict';
  
  /* Bundesland-Name aus GKZ-Präfix (erste Stelle) */
  const GKZ_BL = {
    '1': 'Burgenland',
    '2': 'Carinthia',
    '3': 'Lower Austria',
    '4': 'Oberösterreich',
    '5': 'Salzburg',
    '6': 'Styria',
    '7': 'Tyrol',
    '8': 'Vorarlberg',
    '9': 'Vienna',
  };
  
  /* Farbe pro Bundesland (Chart-Step) */
  const BL_COLOR = {
    'Vienna': '#1E3A5F',
    'Lower Austria': '#0EA5E9',
    'Upper Austria': '#10B981',
    'Styria': '#6366F1',
    'Tyrol': '#F59E0B',
    'Salzburg': '#EC4899',
    'Burgenland': '#14B8A6',
    'Carinthia': '#F97316',
    'Vorarlberg': '#8B5CF6',
  };
  
  /* Reihenfolge Y-Achse (annähernd nach Netto-Zuzug absteigend) */
  const BL_ORDER = [
    'Vienna', 'Lower Austria', 'Upper Austria', 'Styria',
    'Tyrol', 'Salzburg', 'Vorarlberg', 'Carinthia', 'Burgenland',
  ];
  
  /* ISO-Codes (3-stellige GKZ-Präfixe) der Landeshauptstädte — kein Wien */
  const LANDESHAUPTSTADTE_ISO = new Set(['101', '201', '316', '401', '501', '601', '701', '801']);
  
  function isLandeshauptstadt(d) {
    return LANDESHAUPTSTADTE_ISO.has(String(d.iso));
  }
  
  /* State */
  let _mapId = null;
  let _map = null;
  let _svg = null;
  let _dotsG = null;
  let _axisG = null;
  let _bezirke = [];
  let _blData = [];
  let _blFlows = [];   /* [{name, zuzug, wegzug}] Bundesland-Summen */
  let _blOutlineLayer = null;
  let _curStep = null;
  let _dataMin = 0;
  let _dataMax = 0;
  let _year = null;  /* null = alle Jahre */
  
  /* ── Einheitliche Farbfunktion (asymmetrisch, deckt dataMin…dataMax ab) ── */
  const COLOR_NEG = '#B31529';
  const COLOR_MID = '#F7F7F7';
  const COLOR_POS = '#1065AB';
  
  function storyColor(netto) {
    if (netto <= 0 && _dataMin < 0) {
      const t = Math.min(1, netto / _dataMin);
      return _lerpColor(COLOR_MID, COLOR_NEG, t);
    }
    if (netto > 0 && _dataMax > 0) {
      const t = Math.min(1, netto / _dataMax);
      return _lerpColor(COLOR_MID, COLOR_POS, t);
    }
    return COLOR_MID;
  }
  
  /* CSS-Gradient mit 0-Punkt an der richtigen Position */
  function storyGradient() {
    const range = _dataMax - _dataMin;
    const zeroPos = ((-_dataMin / range) * 100).toFixed(1);
    return `linear-gradient(to right,${COLOR_NEG} 0%,${COLOR_MID} ${zeroPos}%,${COLOR_POS} 100%)`;
  }
  
  /* Legende oben aktualisieren */
  function updateLegend() {
    const el = document.getElementById('story-legend');
    if (!el) return;
    el.innerHTML =
        `<div class="leg-title">Net-Migration</div>` +
        `<div class="leg-bar">` +
        `<span class="leg-lbl leg-lbl-left">${fmt(_dataMin)}</span>` +
        `<span class="leg-grad" style="background:${storyGradient()}"></span>` +
        `<span class="leg-lbl leg-lbl-right">+${fmt(_dataMax)}</span>` +
        `</div>`;
  }
  
  /* ── Hilfsfunktionen ──────────────────────────────────────── */
  
  function isoToBl(iso) {
    return GKZ_BL[String(iso)[0]] || '';
  }
  
  /* Deterministischer Jitter aus ISO-String → ganzzahlig in [-range, range] */
  function deterministicJitter(iso, range) {
    let h = 0;
    const s = String(iso);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffff;
    return ((h % (range * 2 + 1)) - range);
  }
  
  /* Einfaches Koordinaten-Mittel des größten GeoJSON-Rings */
  function centroidOf(feature) {
    let rings = [];
    if (feature.geometry.type === 'Polygon') {
      rings = [feature.geometry.coordinates[0]];
    } else if (feature.geometry.type === 'MultiPolygon') {
      rings = feature.geometry.coordinates.map(p => p[0]);
    }
    if (!rings.length) return null;
    const ring = rings.sort((a, b) => b.length - a.length)[0];
    if (!ring || ring.length < 3) return null;
    const n = ring.length;
    return {
      lon: ring.reduce((s, c) => s + c[0], 0) / n,
      lat: ring.reduce((s, c) => s + c[1], 0) / n,
    };
  }
  
  /* lat/lon → Pixel im Leaflet-Container */
  function toPixel(lat, lon) {
    const pt = _map.latLngToContainerPoint([lat, lon]);
    return { x: pt.x, y: pt.y };
  }
  
  /* ── Daten laden ──────────────────────────────────────────── */
  
  async function loadBezirke() {
    const yearParam = _year ? `&year=${_year}` : '';
    const [geo, choro] = await Promise.all([
      fetchJSON('/static/geojson/bezirke_999_geo.json'),
      fetchJSON(`/api/choropleth?level=bezirke${yearParam}`),
    ]);
    
    const dataMap = Object.fromEntries(choro.map(d => [d.iso, d]));
    
    return geo.features
        .map(f => {
          const iso = f.properties.iso;
          const c = centroidOf(f);
          if (!c) return null;
          const d = dataMap[iso] || {};
          const bl = isoToBl(iso);
          if (!bl) return null;
          return {
            iso,
            name: d.name || f.properties.name || iso,
            bundesland: bl,
            netto: d.netto || 0,
            zuzug: d.zuzug || 0,
            wegzug: d.wegzug || 0,
            lat: c.lat,
            lon: c.lon,
          };
        })
        .filter(Boolean);
  }
  
  /* ── SVG-Overlay einrichten ───────────────────────────────── */
  
  function setupOverlay() {
    const mapEl = document.getElementById(_mapId);
    const parent = mapEl.parentElement;
    
    const ns = 'http://www.w3.org/2000/svg';
    const svgEl = document.createElementNS(ns, 'svg');
    svgEl.id = 'scroll-overlay';
    parent.appendChild(svgEl);
    
    /* Tooltip-Div */
    const tip = document.createElement('div');
    tip.id = 'chart-tooltip';
    tip.className = 'chart-tooltip';
    parent.appendChild(tip);
    
    _svg = d3.select(svgEl);
    _axisG = _svg.append('g').attr('class', 'st-axes').style('opacity', 0);
    _dotsG = _svg.append('g').attr('class', 'st-dots');
  }
  
  /* Schwarze Bundesland-Umrandung als eigene Leaflet-Ebene */
  async function addBlOutline() {
    if (_blOutlineLayer) return;
    const geo = await fetchGeoJSON('bundeslaender');
    _blOutlineLayer = L.geoJSON(geo, {
      renderer: L.svg(),   /* SVG-Renderer damit getElement() verfügbar ist */
      style: {
        fill: false,
        color: '#ffffff',
        weight: 1,
        opacity: 0.7,
      },
      interactive: false,
    }).addTo(_map);
  }
  
  function removeBlOutline() {
    if (_blOutlineLayer && _map) {
      _map.removeLayer(_blOutlineLayer);
      _blOutlineLayer = null;
    }
  }
  
  /* Leaflet-Layer mit storyColor neu einfärben */
  function restyleChoropleth() {
    const state = (typeof _leafletMaps !== 'undefined') && _leafletMaps[_mapId];
    if (!state || !state.layer || !state.dataMap) return;
    state.layer.setStyle(f => ({
      fillColor: storyColor(state.dataMap[f.properties.iso]?.netto ?? 0),
    }));
  }
  
  /* ── Step 1: Bundesländer-Choropleth ──────────────────────── */
  
  async function toMap() {
    removeBlOutline();
    /* Karte wieder einblenden */
    const mapEl = document.getElementById(_mapId);
    if (mapEl) {
      mapEl.querySelectorAll('.leaflet-pane')
          .forEach(el => {
            el.style.opacity = '';
          });
    }
    /* Choropleth wiederherstellen */
    await renderChoropleth(_mapId, 'bundeslaender', 'netto', _year);
    restyleChoropleth();
    updateLegend();
    
    /* Overlay ausblenden */
    _dotsG.selectAll('circle, rect.bl-square')
        .transition().duration(500).attr('opacity', 0)
        .on('end', function () {
          d3.select(this).remove();
        });
    
    _axisG.transition().duration(300).style('opacity', 0)
        .on('end', () => _axisG.selectAll('*').remove());
  }
  
  /* ── Step 2: Bezirke-Choropleth ───────────────────────────── */
  
  async function toBezirke() {
    /* Dots / Achsen ausblenden */
    _axisG.transition().duration(300).style('opacity', 0)
        .on('end', () => _axisG.selectAll('*').remove());
    
    /* Bestehende Dots animieren zurück zu Geo-Positionen
       (falls man vom Chart-Step zurückscrollt) */
    _dotsG.selectAll('rect.bl-square')
        .transition().duration(400).attr('opacity', 0).remove();
    
    if (_dotsG.selectAll('circle').size() > 0) {
      const mapEl = document.getElementById(_mapId);
      if (mapEl) {
        mapEl.querySelectorAll('.leaflet-layer, .leaflet-overlay-pane, .leaflet-marker-pane')
            .forEach(el => {
              el.style.opacity = '';
            });
      }
      _dotsG.selectAll('circle')
          .transition().duration(600).ease(d3.easeCubicInOut)
          .attr('cx', d => toPixel(d.lat, d.lon).x)
          .attr('cy', d => toPixel(d.lat, d.lon).y)
          .attr('r', d => nettoRadius(d.netto))
          .attr('fill', d => storyColor(d.netto))
          .attr('opacity', 0.85);
      
      await renderChoropleth(_mapId, 'bezirke', 'netto', _year);
      restyleChoropleth();
      updateLegend();
      await addBlOutline();
      return;
    }
    
    await renderChoropleth(_mapId, 'bezirke', 'netto', _year);
    restyleChoropleth();
    updateLegend();
    await addBlOutline();
  }
  
  /* ── Step 3: Dots → Chart ─────────────────────────────────── */
  
  function toChart() {
    /* Flow-/Netto-Labels aus Steps 4+5 entfernen */
    _dotsG.selectAll('text.flow-label').remove();
    
    const svgEl = document.getElementById('scroll-overlay');
    if (!svgEl) return;
    
    const W = svgEl.clientWidth || 600;
    const H = svgEl.clientHeight || 500;
    const mg = { top: 52, right: 28, bottom: 62, left: 168 };
    
    /* Bundesland-Zentroide VOR dem Ausblenden berechnen */
    const blCentroids = {};
    if (_blOutlineLayer) {
      _blOutlineLayer.eachLayer(layer => {
        const blName = isoToBl(layer.feature?.properties?.iso);
        const c = centroidOf(layer.feature);
        if (blName && c) blCentroids[blName] = toPixel(c.lat, c.lon);
      });
      /* Outline-Pfade sanft ausfaden (eigene Transitions, vor dem Pane-Hide) */
      _blOutlineLayer.eachLayer(layer => {
        const el = layer.getElement?.();
        if (el) d3.select(el).transition().duration(350).style('opacity', '0');
      });
    }
    
    /* Choropleth-Ebenen nach kurzem Delay ausblenden (Outline hat dann schon gefadet) */
    const mapEl = document.getElementById(_mapId);
    setTimeout(() => {
      if (mapEl) mapEl.querySelectorAll('.leaflet-pane')
          .forEach(el => {
            el.style.opacity = '0';
          });
    }, 360);
    
    
    /* X-Achse: tatsächlicher Datenbereich (= dataMin…dataMax) */
    const xScale = d3.scaleLinear()
        .domain([_dataMin, _dataMax])
        .range([mg.left, W - mg.right]);
    
    /* Legende: Gradient exakt über der X-Achse ausrichten */
    const legendEl = document.getElementById('story-legend');
    if (legendEl) {
      const zeroFrac = ((-_dataMin) / (_dataMax - _dataMin) * 100).toFixed(1);
      const fmtL = d3.format(',.0f');
      legendEl.innerHTML =
          `<div class="leg-title" style="width:100%;text-align:center">NETTO-MIGRATION</div>` +
          `<div style="position:absolute;bottom:14px;left:${mg.left}px;right:${mg.right}px;height:10px;border-radius:5px;` +
          `background:linear-gradient(to right,${COLOR_NEG} 0%,${COLOR_MID} ${zeroFrac}%,${COLOR_POS} 100%)"></div>` +
          `<span style="position:absolute;bottom:10px;left:${mg.left}px;transform:translateX(-50%);` +
          `font-size:10px;color:#94a3b8;white-space:nowrap">${fmtL(_dataMin)}</span>` +
          `<span style="position:absolute;bottom:10px;right:${mg.right}px;transform:translateX(50%);` +
          `font-size:10px;color:#94a3b8;white-space:nowrap">+${fmtL(_dataMax)}</span>` +
          `<span style="position:absolute;bottom:10px;left:${xScale(0)}px;transform:translateX(-50%);` +
          `font-size:10px;color:#94a3b8">0</span>`;
    }
    
    const yScale = d3.scaleBand()
        .domain(BL_ORDER)
        .range([mg.top, H - mg.bottom])
        .padding(0.3);
    
    const bw = yScale.bandwidth();
    
    /* Punktfarbe: einheitliche storyColor (map = chart) */
    const dotColor = d => storyColor(d.netto);
    
    const circles = _dotsG.selectAll('circle.bez-dot')
        .data(_bezirke, d => d.iso)
        .join(
            enter => enter.append('circle')
                .attr('class', 'bez-dot')
                .attr('cx', d => toPixel(d.lat, d.lon).x)
                .attr('cy', d => toPixel(d.lat, d.lon).y)
                .attr('r', d => nettoRadius(d.netto))
                .attr('fill', dotColor)
                .attr('opacity', 0.85),
            update => update,
            exit => exit.transition().duration(300).attr('opacity', 0).remove()
        );
    
    const tip = document.getElementById('chart-tooltip');
    
    /* Tooltip-Handler */
    function showTip(event, d) {
      if (!tip) return;
      const sign = d.netto >= 0 ? '+' : '';
      tip.innerHTML = `<strong>${d.name}</strong><br>Net: ${sign}${fmt(d.netto)}`;
      tip.style.opacity = '1';
      moveTip(event);
    }
    
    function moveTip(event) {
      if (!tip) return;
      const rect = document.getElementById(_mapId).parentElement.getBoundingClientRect();
      tip.style.left = (event.clientX - rect.left + 14) + 'px';
      tip.style.top = (event.clientY - rect.top - 36) + 'px';
    }
    
    function hideTip() {
      if (tip) tip.style.opacity = '0';
    }
    
    /* Dots animieren: geo-Positionen → Chart-Positionen */
    circles
        .transition().duration(950).ease(d3.easeCubicInOut)
        .delay((_, i) => i * 4)
        .attr('cx', d => xScale(d.netto))
        .attr('cy', d => (yScale(d.bundesland) ?? 0) + bw / 2)
        .attr('r', d => isLandeshauptstadt(d) ? 4 : 5)
        .attr('fill', dotColor)
        .attr('opacity', 0.85);
    
    /* Hover aktivieren sobald Animation fertig ist */
    setTimeout(() => {
      _dotsG.selectAll('circle.bez-dot')
          .style('pointer-events', 'all')
          .style('cursor', 'pointer')
          .on('mouseover', showTip)
          .on('mousemove', moveTip)
          .on('mouseout', hideTip);
    }, 1100);
    
    /* Ringe für Landeshauptstädte (nach der Animation einfügen) */
    setTimeout(() => {
      _dotsG.selectAll('circle.lhs-ring').remove();
      _bezirke.filter(d => isLandeshauptstadt(d)).forEach(d => {
        _dotsG.append('circle')
            .attr('class', 'lhs-ring')
            .attr('cx', xScale(d.netto))
            .attr('cy', (yScale(d.bundesland) ?? 0) + bw / 2)
            .attr('r', 8)
            .attr('fill', 'none')
            .attr('stroke', 'rgba(255,255,255,0.7)')
            .attr('stroke-width', 1.5)
            .attr('opacity', 0.85)
            .style('pointer-events', 'none');
      });
    }, 980);
    
    /* Chart-Achsen aufbauen */
    _axisG.interrupt().style('opacity', 0);
    _axisG.selectAll('*').remove();
    
    /* Nulllinie */
    _axisG.append('line')
        .attr('class', 'zero-line')
        .attr('x1', xScale(0)).attr('x2', xScale(0))
        .attr('y1', mg.top).attr('y2', H - mg.bottom)
        .attr('stroke', 'rgba(255,255,255,0.35)')
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '4 3');
    
    /* X-Achse */
    _axisG.append('g')
        .attr('class', 'x-axis')
        .attr('transform', `translate(0,${H - mg.bottom})`)
        .call(
            d3.axisBottom(xScale)
                .ticks(6)
                .tickFormat(d => d3.format('+,.0f')(d))
        )
        .call(g => g.select('.domain').attr('stroke', 'rgba(255,255,255,0.15)'))
        .call(g => g.selectAll('.tick line').attr('stroke', 'rgba(255,255,255,0.15)'))
        .call(g => g.selectAll('text')
            .attr('fill', '#94a3b8')
            .attr('font-size', '11px')
            .attr('font-family', 'Inter, sans-serif'));
    
    /* X-Achsen-Label */
    _axisG.append('text')
        .attr('class', 'x-axis-label')
        .attr('x', W / 2)
        .attr('y', H - mg.bottom + 44)
        .attr('text-anchor', 'middle')
        .attr('fill', '#64748b')
        .attr('font-size', '11px')
        .attr('font-family', 'Inter, sans-serif')
        .text('Net-Migration per District (In-Migration - Out-Migration)');
    
    /* Y-Labels (Bundesland-Namen) — neutral, da Farbe den Wert codiert */
    BL_ORDER.forEach(bl => {
      _axisG.append('text')
          .attr('data-bl', bl)
          .attr('x', 10)
          .attr('y', (yScale(bl) ?? 0) + bw / 2)
          .attr('text-anchor', 'start')
          .attr('dominant-baseline', 'middle')
          .attr('fill', '#e2e8f0')
          .attr('font-size', '12.5px')
          .attr('font-weight', '600')
          .attr('font-family', 'Inter, sans-serif')
          .text(bl);
    });
    
    /* Bundesland-Quadrate: animieren von BL-Zentroid → Chart-Position */
    const sqSize = Math.max(7, Math.min(11, bw * 0.38));
    _dotsG.selectAll('rect.bl-square').remove();
    _blData.forEach(bl => {
      const cx = xScale(bl.netto);
      const cy = (yScale(bl.name) ?? 0) + bw / 2;
      
      const r = _dotsG.append('rect')
          .attr('class', 'bl-square')
          .attr('fill', 'none')
          .attr('stroke', '#ffffff')
          .attr('stroke-width', 1.5)
          .attr('opacity', 0)
          .style('pointer-events', 'none') /* erst nach Animation aktiv */
          .style('cursor', 'pointer');
      
      function attachTip() {
        r.style('pointer-events', 'all')
            .on('mouseover', function (event) {
              if (!tip) return;
              const sign = bl.netto >= 0 ? '+' : '';
              tip.innerHTML = `<strong>${bl.name}</strong><br>Ø Net per District: ${sign}${fmt(bl.netto)}`;
              tip.style.opacity = '1';
              const pr = document.getElementById(_mapId).parentElement.getBoundingClientRect();
              tip.style.left = (event.clientX - pr.left + 14) + 'px';
              tip.style.top = (event.clientY - pr.top - 36) + 'px';
            })
            .on('mousemove', function (event) {
              if (!tip) return;
              const pr = document.getElementById(_mapId).parentElement.getBoundingClientRect();
              tip.style.left = (event.clientX - pr.left + 14) + 'px';
              tip.style.top = (event.clientY - pr.top - 36) + 'px';
            })
            .on('mouseout', () => {
              if (tip) tip.style.opacity = '0';
            });
      }
      
      const origin = blCentroids[bl.name];
      const startSize = 16;
      if (origin) {
        /* Auftauchen am Bundesland-Zentroid als kleines Quadrat */
        r.attr('x', origin.x - startSize / 2)
            .attr('y', origin.y - startSize / 2)
            .attr('width', startSize)
            .attr('height', startSize);
        r.transition().duration(200).delay(200)
            .attr('opacity', 0.9)
            .transition().duration(880).ease(d3.easeCubicInOut)
            .attr('x', cx - sqSize / 2)
            .attr('y', cy - sqSize / 2)
            .attr('width', sqSize)
            .attr('height', sqSize)
            .on('end', attachTip);
      } else {
        r.attr('x', cx - sqSize / 2).attr('y', cy - sqSize / 2)
            .attr('width', sqSize).attr('height', sqSize)
            .transition().duration(400).delay(1100)
            .attr('opacity', 0.85)
            .on('end', attachTip);
      }
    });
    
    /* Einblenden */
    _axisG.transition().duration(600).delay(400).style('opacity', 1);
  }
  
  /* ── Step 4: Flows (Zuzug / Wegzug als Zahlen) ───────────── */
  
  /* ── Step 5: Netto-Ranking ───────────────────────────────────── */
  
  function toNetto() {
    const svgEl = document.getElementById('scroll-overlay');
    if (!svgEl) return;
    
    const W = svgEl.clientWidth || 600;
    const H = svgEl.clientHeight || 500;
    const mg = { top: 52, right: 28, bottom: 62, left: 168 };
    
    const fmtN = d3.format('+,.0f');
    const xScale = d3.scaleLinear()
        .domain([_dataMin, _dataMax])
        .range([mg.left, W - mg.right]);
    const yScaleOld = d3.scaleBand()
        .domain(BL_ORDER)
        .range([mg.top, H - mg.bottom])
        .padding(0.3);
    const bw = yScaleOld.bandwidth();
    const x0 = xScale(0);
    const fs = Math.max(13, Math.min(17, bw * 0.65));
    const fsBig = fs * 1.35;
    
    /* Gesamtnetto = Zuzug − Wegzug pro Bundesland */
    const nettoByBl = {};
    _blFlows.forEach(bl => {
      nettoByBl[bl.name] = bl.zuzug - bl.wegzug;
    });
    
    /* Legende + Nulllinie ausblenden */
    const legendEl = document.getElementById('story-legend');
    if (legendEl) legendEl.style.opacity = '0';
    _axisG.select('line.zero-line').transition().duration(300).style('opacity', '0');
    
    /* Phase 1: Neg-Labels nach rechts (→ x0), Pos-Labels nach links (→ x0),
       dabei ausfaden — Merge-Effekt */
    _dotsG.selectAll('text.flow-neg')
        .transition().duration(500).ease(d3.easeCubicIn)
        .attr('x', x0).attr('opacity', 0)
        .on('end', function () {
          d3.select(this).remove();
        });
    
    _dotsG.selectAll('text.flow-pos')
        .transition().duration(500).ease(d3.easeCubicIn)
        .attr('x', x0).attr('opacity', 0)
        .on('end', function () {
          d3.select(this).remove();
        });
    
    /* Phase 2: Netto-Wert poppt am Zentrum auf, dann Farbe + Ranking */
    setTimeout(() => {
      _dotsG.selectAll('text.netto-label').remove();
      
      _blFlows.forEach((bl, i) => {
        const netto = nettoByBl[bl.name];
        const cy = (yScaleOld(bl.name) ?? 0) + bw / 2;
        const col = storyColor(netto);
        
        /* Pop-in: groß + weiß → normal + Zielfarbe */
        _dotsG.append('text')
            .datum({ name: bl.name, netto })
            .attr('class', 'flow-label netto-label')
            .attr('data-bl', bl.name)
            .attr('x', x0).attr('y', cy)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')
            .attr('fill', '#ffffff')
            .attr('font-size', fsBig + 'px')
            .attr('font-weight', '700')
            .attr('font-family', 'Inter, sans-serif')
            .attr('opacity', 0)
            .text(fmtN(netto))
            /* Einblenden */
            .transition().duration(200).delay(i * 45).attr('opacity', 1)
            /* Schrumpfen + Einfärben */
            .transition().duration(350).ease(d3.easeCubicOut)
            .attr('font-size', fs + 'px')
            .attr('fill', col);
      });
      
      /* Phase 3: Sortieren nach Netto (absteigend) */
      const appearDuration = _blFlows.length * 45 + 600;
      setTimeout(() => {
        const sortedOrder = [..._blFlows]
            .sort((a, b) => nettoByBl[b.name] - nettoByBl[a.name])
            .map(d => d.name);
        
        const yScaleNew = d3.scaleBand()
            .domain(sortedOrder)
            .range([mg.top, H - mg.bottom])
            .padding(0.3);
        
        _dotsG.selectAll('text.netto-label')
            .transition().duration(700).ease(d3.easeCubicInOut)
            .attr('y', function (d) {
              return (yScaleNew(d.name) ?? 0) + bw / 2;
            });
        
        _axisG.selectAll('text[data-bl]')
            .transition().duration(700).ease(d3.easeCubicInOut)
            .attr('y', function () {
              const name = d3.select(this).attr('data-bl');
              return (yScaleNew(name) ?? 0) + bw / 2;
            });
      }, appearDuration);
    }, 550);
  }
  
  /* ── Step 4: Flows (Zuzug / Wegzug als Zahlen) ───────────── */
  
  function toFlows() {
    /* Netto-Labels aus Step 5 entfernen */
    _dotsG.selectAll('text.netto-label').remove();
    
    const svgEl = document.getElementById('scroll-overlay');
    if (!svgEl) return;
    
    const W = svgEl.clientWidth || 600;
    const H = svgEl.clientHeight || 500;
    const mg = { top: 52, right: 28, bottom: 62, left: 168 };
    
    const xScale = d3.scaleLinear()
        .domain([_dataMin, _dataMax])
        .range([mg.left, W - mg.right]);
    
    const yScale = d3.scaleBand()
        .domain(BL_ORDER)
        .range([mg.top, H - mg.bottom])
        .padding(0.3);
    
    const bw = yScale.bandwidth();
    const x0 = xScale(0);
    const pad = 18;
    const fmtN = d3.format(',.0f');
    const fs = Math.max(13, Math.min(17, bw * 0.65)) + 'px';
    
    /* Legende + X-Achse ausblenden */
    const legendEl = document.getElementById('story-legend');
    if (legendEl) legendEl.style.opacity = '0';
    _axisG.selectAll('.x-axis, .x-axis-label')
        .transition().duration(300).style('opacity', '0');
    
    /* Phase 1: Dots sammeln sich links/rechts der Nulllinie (600ms) */
    _dotsG.selectAll('circle.bez-dot')
        .transition().duration(600).ease(d3.easeCubicInOut)
        .attr('cx', d => d.netto < 0 ? x0 - 20 : x0 + 20)
        .attr('r', 2)
        .attr('opacity', 0.5);
    
    _dotsG.selectAll('circle.lhs-ring, rect.bl-square')
        .transition().duration(300).attr('opacity', 0).remove();
    
    /* Phase 2: Dots ausfaden + Zahlen einblenden (nach 600ms) */
    setTimeout(() => {
      _dotsG.selectAll('circle.bez-dot')
          .transition().duration(350).attr('opacity', 0)
          .on('end', function () {
            d3.select(this).remove();
          });
      
      _dotsG.selectAll('text.flow-label').remove();
      
      _blFlows.forEach((bl, i) => {
        const cy = (yScale(bl.name) ?? 0) + bw / 2;
        const delay = i * 40;
        
        _dotsG.append('text')
            .attr('class', 'flow-label flow-neg')
            .attr('x', x0 - pad)
            .attr('y', cy)
            .attr('text-anchor', 'end')
            .attr('dominant-baseline', 'middle')
            .attr('fill', COLOR_NEG)
            .attr('font-size', fs)
            .attr('font-weight', '700')
            .attr('font-family', 'Inter, sans-serif')
            .attr('opacity', 0)
            .text(`−${fmtN(bl.wegzug)}`)
            .transition().duration(400).delay(delay).attr('opacity', 1);
        
        _dotsG.append('text')
            .attr('class', 'flow-label flow-pos')
            .attr('x', x0 + pad)
            .attr('y', cy)
            .attr('text-anchor', 'start')
            .attr('dominant-baseline', 'middle')
            .attr('fill', COLOR_POS)
            .attr('font-size', fs)
            .attr('font-weight', '700')
            .attr('font-family', 'Inter, sans-serif')
            .attr('opacity', 0)
            .text(`+${fmtN(bl.zuzug)}`)
            .transition().duration(400).delay(delay).attr('opacity', 1);
      });
    }, 650);
    
    _axisG.interrupt().style('opacity', 1);
  }
  
  /* ── Dot-Hilfsfunktionen ──────────────────────────────────── */
  
  function nettoRadius(n) {
    return Math.max(3, Math.min(9, 3 + Math.sqrt(Math.abs(n)) * 0.055));
  }
  
  function nettoColor(n) {
    if (n > 150) return COLOR_POS;
    if (n < -150) return COLOR_NEG;
    return '#94A3B8';
  }
  
  /* ── Scrollama ────────────────────────────────────────────── */
  
  function setupScroller() {
    const scroller = scrollama();
    
    scroller
        .setup({ step: '.scroll-step', offset: 0.55 })
        .onStepEnter(({ element }) => {
          const step = element.dataset.step;
          if (step === _curStep) return;
          _curStep = step;
          
          document.querySelectorAll('.scroll-step').forEach(el =>
              el.classList.toggle('is-active', el === element)
          );
          
          if (step === 'map') toMap();
          if (step === 'bezirke') toBezirke();
          if (step === 'chart') toChart();
          if (step === 'flows') toFlows();
          if (step === 'netto') toNetto();
        })
        .onStepExit(({ element, direction }) => {
          if (direction !== 'up') return;
          const step = element.dataset.step;
          /* Rückwärts-Scroll: einen Step zurück */
          if (step === 'bezirke') {
            _curStep = 'map';
            toMap();
          }
          if (step === 'chart') {
            _curStep = 'bezirke';
            toBezirke();
          }
          if (step === 'flows') {
            _curStep = 'chart';
            toChart();
          }
          if (step === 'netto') {
            _curStep = 'flows';
            toFlows();
          }
        });
    
    window.addEventListener('resize', () => {
      scroller.resize();
      if (_curStep === 'chart') toChart();
      if (_curStep === 'flows') toFlows();
      if (_curStep === 'netto') toNetto();
      if (_curStep === 'bezirke') toBezirke();
    });
  }
  
  /* ── Einstiegspunkt ───────────────────────────────────────── */
  
  async function init(mapId) {
    _mapId = mapId;
    
    /* Lade-Overlay zeigen */
    const loadEl = document.getElementById('scroll-loading');
    if (loadEl) loadEl.style.display = 'flex';
    
    try {
      _bezirke = await loadBezirke();
      _dataMin = Math.min(..._bezirke.map(d => d.netto));
      _dataMax = Math.max(..._bezirke.map(d => d.netto));
      
      /* Bundesland-Durchschnitt aus Bezirksdaten */
      const blAgg = {};
      _bezirke.forEach(d => {
        if (!blAgg[d.bundesland]) blAgg[d.bundesland] = { sum: 0, count: 0, zuzug: 0, wegzug: 0 };
        blAgg[d.bundesland].sum += d.netto;
        blAgg[d.bundesland].count += 1;
        blAgg[d.bundesland].zuzug += d.zuzug || 0;
        blAgg[d.bundesland].wegzug += d.wegzug || 0;
      });
      _blData = BL_ORDER.map(name => ({
        name,
        netto: blAgg[name] ? Math.round(blAgg[name].sum / blAgg[name].count) : 0,
      }));
      _blFlows = BL_ORDER.map(name => ({
        name,
        zuzug: blAgg[name] ? blAgg[name].zuzug : 0,
        wegzug: blAgg[name] ? blAgg[name].wegzug : 0,
      }));
    } catch (e) {
      console.error('[Scrollytelling] District data could not be loaded:', e);
      if (loadEl) loadEl.style.display = 'none';
      return;
    }
    if (loadEl) loadEl.style.display = 'none';
    
    /* Leaflet-Karte aus der zentralen Registry holen */
    _map = (typeof _leafletMaps !== 'undefined') && _leafletMaps[mapId]?.map;
    if (!_map) {
      console.error('[Scrollytelling] Map not found:', mapId);
      return;
    }
    
    /* Karten-Interaktion während der Story deaktivieren */
    _map.dragging.disable();
    _map.touchZoom.disable();
    _map.doubleClickZoom.disable();
    _map.scrollWheelZoom.disable();
    _map.keyboard.disable();
    
    setupOverlay();
    setupScroller();
    
    /* Initiale Bundesländer-Karte mit korrekten Farben einfärben */
    restyleChoropleth();
    updateLegend();
    
    /* Ersten Step als aktiv markieren */
    const first = document.querySelector('.scroll-step');
    if (first) first.classList.add('is-active');
  }
  
  async function setYear(year) {
    _year = year || null;
    /* Bezirk-Daten neu laden */
    _bezirke = await loadBezirke();
    _dataMin = Math.min(..._bezirke.map(d => d.netto));
    _dataMax = Math.max(..._bezirke.map(d => d.netto));
    const blAgg = {};
    _bezirke.forEach(d => {
      if (!blAgg[d.bundesland]) blAgg[d.bundesland] = { sum: 0, count: 0, zuzug: 0, wegzug: 0 };
      blAgg[d.bundesland].sum += d.netto;
      blAgg[d.bundesland].count += 1;
      blAgg[d.bundesland].zuzug += d.zuzug || 0;
      blAgg[d.bundesland].wegzug += d.wegzug || 0;
    });
    _blData = BL_ORDER.map(name => ({
      name,
      netto: blAgg[name] ? Math.round(blAgg[name].sum / blAgg[name].count) : 0,
    }));
    _blFlows = BL_ORDER.map(name => ({
      name,
      zuzug: blAgg[name] ? blAgg[name].zuzug : 0,
      wegzug: blAgg[name] ? blAgg[name].wegzug : 0,
    }));
    /* Aktuellen Step neu rendern */
    if (_curStep === 'map') await toMap();
    else if (_curStep === 'bezirke') await toBezirke();
    else if (_curStep === 'chart') toChart();
    else if (_curStep === 'flows') toFlows();
    else if (_curStep === 'netto') toNetto();
  }
  
  window.initScrollytelling = init;
  window.scrollySetYear = setYear;
})();
