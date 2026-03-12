/* ════════════════════════════════════════════════════════════════
   displays.js – Slide rendering engine (expanded)
   ════════════════════════════════════════════════════════════════ */

const Displays = (() => {
    function el(id) { return document.getElementById(id); }
    function txt(id, v) { const e = el(id); if (e) e.textContent = v ?? '--'; }

    // ── Regional map state ────────────────────────────────────────
    let obsMap = null;
    let fcstMap = null;
    // Store pending data so maps can be refreshed when first made visible
    let pendingObsData = null;
    let pendingFcstData = null;

    // ── Current Conditions ─────────────────────────────────────────
    function renderConditions(data) {
        const c = data.conditions;
        txt('cond-temp', c.temp);
        txt('cond-desc', c.desc);
        txt('cond-icon', c.icon);
        txt('cond-feelslike', `Feels like ${c.feelsLike}`);
        txt('cond-humidity', c.humidity);
        txt('cond-dewpoint', c.dewpoint);
        txt('cond-wind', c.wind);
        txt('cond-gusts', c.gusts);
        txt('cond-vis', c.visibility);
        txt('cond-pressure', `${c.pressure} ${c.pressureTrend}`);
        txt('cond-cloud', c.cloudCover);
        txt('cond-uv', c.uv);
        txt('cond-precip', c.precipitation24h);
        txt('cond-snow', c.snowDepth);

        // Heat index or wind chill
        const hiwc = el('cond-heatindex-wc');
        if (hiwc) {
            if (c.heatIndex !== '--') hiwc.textContent = `Heat Index: ${c.heatIndex}`;
            else if (c.windChill !== '--') hiwc.textContent = `Wind Chill: ${c.windChill}`;
            else hiwc.textContent = '';
        }
    }

    // ── Detailed Observations (ASOS-style dense grid) ──────────────
    function renderObservations(data) {
        const container = el('obs-grid');
        if (!container) return;
        const c = data.conditions;
        const a = data.almanac;

        const sections = [
            {
                label: '🌤 Current Conditions',
                cls: 'obs-section-conditions',
                items: [
                    { icon: '🌡', label: 'Temperature', value: c.temp },
                    { icon: '🤔', label: 'Feels Like', value: c.feelsLike },
                    { icon: '💧', label: 'Humidity', value: c.humidity },
                    { icon: '🌫', label: 'Dewpoint', value: c.dewpoint },
                    { icon: '☁️', label: 'Cloud Cover', value: c.cloudCover },
                    { icon: '☀️', label: 'UV Index', value: c.uv },
                ]
            },
            {
                label: '💨 Wind & Atmosphere',
                cls: 'obs-section-wind',
                items: [
                    { icon: '💨', label: 'Wind', value: c.wind },
                    { icon: '🧭', label: 'Direction', value: `${c.windDeg ?? '--'}° (${windDirArrow(c.windDeg)})` },
                    { icon: '🌬', label: 'Gusts', value: c.gusts },
                    { icon: '👀', label: 'Visibility', value: c.visibility },
                    { icon: '📊', label: 'Pressure', value: c.pressure },
                    { icon: '📈', label: 'Trend', value: c.pressureTrend || '--' },
                ]
            },
            {
                label: '🌧 Precipitation & Extremes',
                cls: 'obs-section-precip',
                items: [
                    { icon: '🌧', label: 'Precip (24h)', value: c.precipitation24h },
                    { icon: '❄️', label: 'Snow Depth', value: c.snowDepth },
                    { icon: '🔥', label: 'Heat Index', value: c.heatIndex !== '--' ? c.heatIndex : 'N/A' },
                    { icon: '🥶', label: 'Wind Chill', value: c.windChill !== '--' ? c.windChill : 'N/A' },
                ]
            },
            {
                label: '🌅 Sun & Almanac',
                cls: 'obs-section-almanac',
                items: [
                    { icon: '🌅', label: 'Sunrise', value: a?.sunrise || '--' },
                    { icon: '🌇', label: 'Sunset', value: a?.sunset || '--' },
                    { icon: '🕛', label: 'Solar Noon', value: a?.solarNoon || '--' },
                    { icon: '📅', label: 'Day Length', value: a?.dayLength || '--' },
                    { icon: '🌄', label: 'Civil Dawn', value: a?.dawnCivil || '--' },
                    { icon: '🌆', label: 'Civil Dusk', value: a?.duskCivil || '--' },
                    { icon: '🌕', label: 'Moon Phase', value: a?.moon || '--' },
                    { icon: '🔢', label: 'Day of Year', value: a?.dayOfYear || '--' },
                ]
            },
        ];

        container.innerHTML = sections.map(sec => `
          <div class="obs-section ${sec.cls}">
            <div class="obs-section-header">${sec.label}</div>
            <div class="obs-section-grid">
              ${sec.items.map(item => `
                <div class="obs-card">
                  <span class="obs-icon">${item.icon}</span>
                  <div class="obs-card-body">
                    <span class="obs-label">${item.label}</span>
                    <span class="obs-value">${item.value}</span>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `).join('');
    }

    function windDirArrow(deg) {
        if (deg == null) return '--';
        const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
        return dirs[Math.round(deg / 22.5) % 16];
    }

    // ── Hourly Forecast ────────────────────────────────────────────
    function renderHourly(data) {
        const container = el('hourly-container');
        if (!container) return;
        container.innerHTML = '';
        (data.hourly || []).forEach(h => {
            const card = document.createElement('div');
            card.className = 'hourly-card' + (h.isCurrent ? ' current' : '');
            card.innerHTML = `
              <div class="hourly-time">${h.time}</div>
              <div class="hourly-icon">${h.icon}</div>
              <div class="hourly-temp">${h.temp}</div>
              <div class="hourly-desc">${h.desc}</div>
              ${h.precip ? `<div class="hourly-precip">${h.precip}</div>` : ''}
              ${h.wind ? `<div class="hourly-wind">💨 ${h.wind}</div>` : ''}
            `;
            container.appendChild(card);
        });
    }

    // ── Extended Forecast ──────────────────────────────────────────
    function renderExtended(data) {
        const container = el('extended-container');
        if (!container) return;
        container.innerHTML = '';
        (data.daily || []).forEach(d => {
            const card = document.createElement('div');
            card.className = 'day-card' + (d.isToday ? ' today' : '');
            card.innerHTML = `
              <div class="day-name">${d.name}</div>
              <div class="day-icon">${d.icon}</div>
              <div class="day-desc">${d.desc}</div>
              <div class="day-hi-lo"><span class="day-hi">${d.hi}</span><span class="day-lo">${d.lo}</span></div>
              ${d.precip ? `<div class="day-precip">${d.precip}</div>` : ''}
              ${d.precipSum ? `<div class="day-precip" style="font-size:0.7rem">${d.precipSum}</div>` : ''}
              ${d.snowSum ? `<div class="day-precip" style="color:var(--accent2)">${d.snowSum}</div>` : ''}
              ${d.wind ? `<div class="day-wind">💨 ${d.wind}</div>` : ''}
            `;
            container.appendChild(card);
        });
    }

    // ── Precipitation Chart ────────────────────────────────────────
    function renderPrecipChart(data) {
        const container = el('precip-chart');
        if (!container) return;
        const chart = data.precipChart || [];
        if (!chart.length) { container.innerHTML = '<div class="no-alerts">No precipitation data available.</div>'; return; }

        const maxProb = 100;
        const maxAmt = Math.max(...chart.map(h => h.amount || 0), 0.01);

        container.innerHTML = `
          <div class="pc-bars">
            ${chart.map(h => {
            const probH = Math.round((h.prob / maxProb) * 100);
            const amtH = maxAmt > 0 ? Math.round((h.amount / maxAmt) * 80) : 0;
            const isThunder = h.cape > 200;
            const barColor = h.snow ? 'var(--accent2)' : isThunder ? '#f59e0b' : 'var(--accent)';
            return `
                  <div class="pc-col">
                    <div class="pc-prob-label">${h.prob > 5 ? h.prob + '%' : ''}</div>
                    <div class="pc-bar-wrap">
                      <div class="pc-prob-bar" style="height:${probH}%;opacity:0.35;background:${barColor}"></div>
                      ${amtH > 0 ? `<div class="pc-amt-bar" style="height:${amtH}%;background:${barColor}"></div>` : ''}
                      ${isThunder ? '<div class="pc-thunder">⚡</div>' : ''}
                    </div>
                    <div class="pc-time">${h.time}</div>
                  </div>`;
        }).join('')}
          </div>
        `;
    }

    // ── Almanac ────────────────────────────────────────────────────
    function renderAlmanac(data) {
        const a = data.almanac;
        if (!a) return;
        txt('alm-sunrise', a.sunrise);
        txt('alm-sunset', a.sunset);
        txt('alm-moon', a.moon);
        txt('alm-daylength', a.dayLength);
        txt('alm-solarnoon', a.solarNoon);
        txt('alm-dayofyear', a.dayOfYear);
    }

    // ── On This Day – Climate History ──────────────────────────────
    function renderClimateHistory(data) {
        const container = el('climate-history-container');
        if (!container) return;

        const ch = data.climateHistory;

        if (!ch) {
            container.innerHTML = `
              <div class="ch-unavailable">
                <div class="ch-unavail-icon">📅</div>
                <div class="ch-unavail-text">Historical climate data is unavailable for this location.</div>
              </div>`;
            return;
        }

        const dateLabel = el('climate-history-date');
        if (dateLabel) dateLabel.textContent = ch.date;

        const yearsLabel = el('climate-history-years');
        if (yearsLabel) yearsLabel.textContent = ch.years > 0
            ? `${ch.startYear}–${new Date().getFullYear() - 1} (${ch.years} yr)`
            : '';

        container.innerHTML = `
          <div class="ch-section">
            <div class="ch-section-header">🌡 Temperature Records</div>
            <div class="ch-grid">
              <div class="ch-record-card ch-record-hot">
                <div class="ch-record-label">Record High</div>
                <div class="ch-record-value">${esc(ch.recordHigh?.temp ?? '--')}</div>
                ${ch.recordHigh?.year ? `<div class="ch-record-year">${ch.recordHigh.year}</div>` : ''}
              </div>
              <div class="ch-record-card ch-record-cold">
                <div class="ch-record-label">Record Low</div>
                <div class="ch-record-value">${esc(ch.recordLow?.temp ?? '--')}</div>
                ${ch.recordLow?.year ? `<div class="ch-record-year">${ch.recordLow.year}</div>` : ''}
              </div>
              <div class="ch-avg-card">
                <div class="ch-avg-row">
                  <span class="ch-avg-label">Avg High</span>
                  <span class="ch-avg-value ch-avg-hot">${esc(ch.avgHigh)}</span>
                </div>
                <div class="ch-avg-row">
                  <span class="ch-avg-label">Avg Low</span>
                  <span class="ch-avg-value ch-avg-cold">${esc(ch.avgLow)}</span>
                </div>
              </div>
            </div>
          </div>
          <div class="ch-section">
            <div class="ch-section-header">🌧 Precipitation Records</div>
            <div class="ch-grid">
              <div class="ch-record-card ch-record-precip">
                <div class="ch-record-label">Record Precip</div>
                <div class="ch-record-value ch-precip-val">${esc(ch.recordPrecip?.amount ?? 'None on record')}</div>
                ${ch.recordPrecip?.year ? `<div class="ch-record-year">${ch.recordPrecip.year}</div>` : ''}
              </div>
              <div class="ch-avg-card ch-avg-card-full">
                <div class="ch-avg-row">
                  <span class="ch-avg-label">Avg Precip</span>
                  <span class="ch-avg-value">${esc(ch.avgPrecip)}</span>
                </div>
              </div>
            </div>
          </div>
        `;
    }

    // ── Air Quality ────────────────────────────────────────────────
    function renderAirQuality(data) {
        const aq = data.airQuality;
        if (!aq) { txt('aqi-value', 'N/A'); txt('aqi-label', 'Unavailable'); return; }
        txt('aqi-value', aq.aqi);
        txt('aqi-label', aq.label);
        el('aqi-value').style.color = aq.color;
        el('aqi-label').style.color = aq.color;
        const ind = el('aqi-indicator');
        if (ind) ind.style.left = `${Math.max(0, Math.min(aq.pct, 97))}%`;
        txt('aqi-pm25', aq.pm25);
        txt('aqi-pm10', aq.pm10);
        txt('aqi-ozone', aq.ozone);
        txt('aqi-no2', aq.no2);

        // Add extra AQ pollutants if the elements exist
        txt('aqi-co', aq.co);
        txt('aqi-so2', aq.so2);
        txt('aqi-dust', aq.dust);
    }


    // ── Radar ──────────────────────────────────────────────────────
    function renderRadar(lat, lon) {
        if (typeof RadarMap !== 'undefined') RadarMap.render(lat, lon);
    }

    // ── Severe Alerts ──────────────────────────────────────────────
    function renderAlerts(alerts, onTTS) {
        const container = el('alerts-container');
        if (!container) return;
        container.innerHTML = '';
        if (!alerts?.length) {
            container.innerHTML = '<div class="no-alerts">✅ No active severe weather alerts for this area.</div>';
            return;
        }
        alerts.forEach((alert, i) => {
            const card = document.createElement('div');
            card.className = 'alert-card';
            const desc = alert.description || '';
            card.innerHTML = `
              <div class="alert-card-header">
                <span class="alert-card-title">⚠ ${alert.event || 'Weather Alert'}</span>
                <span class="alert-card-severity">${alert.severity || 'Unknown'}</span>
                <button class="alert-tts-btn" data-idx="${i}" title="Read aloud">🔊 Announce</button>
              </div>
              <div class="alert-card-body">${desc}</div>
              <div class="alert-card-meta">
                📍 ${alert.areaDesc || 'Unknown area'}&nbsp;|&nbsp; Expires: ${alert.expires ? new Date(alert.expires).toLocaleString() : '--'}
              </div>
            `;
            card.querySelector('.alert-tts-btn').addEventListener('click', e => { e.stopPropagation(); if (onTTS) onTTS(alert); });
            container.appendChild(card);
        });
    }

    // ── Custom Forecast ────────────────────────────────────────────
    function renderCustomForecast(forecasts) {
        const container = el('customforecast-container');
        if (!container) return;
        container.innerHTML = '';
        // Accept array (new) or single object (legacy)
        const all = Array.isArray(forecasts) ? forecasts : (forecasts?.periods?.length ? [forecasts] : []);
        if (!all.length) return;

        all.forEach((cf, cfIdx) => {
            const periods = cf?.periods || [];
            if (!periods.length) return;

            const section = document.createElement('div');
            section.className = 'cf-section';
            section.dataset.count = String(periods.length);

            // Label header when multiple forecasts are active
            if (all.length > 1 && cf.label) {
                const header = document.createElement('div');
                header.className = 'cf-section-label';
                header.textContent = cf.label;
                section.appendChild(header);
            }

            periods.forEach(p => {
                const card = document.createElement('div');
                card.className = 'day-card';
                const hiLoHtml = (p.hi || p.lo)
                    ? `<div class="day-hi-lo">${p.hi ? `<span class="day-hi">${esc(p.hi)}</span>` : ''}${p.lo ? `<span class="day-lo">${esc(p.lo)}</span>` : ''}</div>`
                    : '';
                card.innerHTML = `
                  <div class="day-name">${esc(p.name || '')}</div>
                  <div class="day-icon">${esc(p.icon || '🌤')}</div>
                  ${p.desc ? `<div class="day-desc markdown-body">${(typeof marked !== 'undefined' ? marked.parse(p.desc, { breaks: true }) : esc(p.desc))}</div>` : ''}
                  ${hiLoHtml}
                  ${p.precip ? `<div class="day-precip">💧 ${esc(String(p.precip))}%</div>` : ''}
                  ${p.wind ? `<div class="day-wind">💨 ${esc(p.wind)}</div>` : ''}
                `;
                section.appendChild(card);
            });

            container.appendChild(section);
        });

        const updatedEl = el('customforecast-updated');
        if (updatedEl && all.length) {
            const latest = all.reduce((a, b) => ((a?.updatedAt ?? 0) > (b?.updatedAt ?? 0) ? a : b), all[0]);
            if (latest?.updatedAt) {
                updatedEl.textContent = `Updated: ${new Date(latest.updatedAt).toLocaleString()}`;
            }
        }
    }

    function esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /** Convert a 6-digit hex colour (#rrggbb) to "r,g,b" string for rgba(). */
    function hexToRgb(hex) {
        const n = parseInt(hex.replace('#', ''), 16);
        return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
    }

    // ── Travel Forecast ────────────────────────────────────────────
    // Full-screen WeatherStar-style vertical list: city / icon / lo / hi
    function renderTravel(data) {
        const rows = el('travel-rows');
        if (!rows) return;

        const cities = data.travelCities || [];
        const dayLabel = el('travel-day-label');
        if (dayLabel) {
            const today = new Date();
            dayLabel.textContent = `Travel Forecast \u2014 ${today.toLocaleDateString('en-US', { weekday: 'long' })}`;
        }

        if (!cities.length) {
            rows.innerHTML = '<div class="no-alerts" style="margin:auto">📡 Fetching city data…</div>';
        } else {
            rows.innerHTML = cities.map(city => {
                const stateBadge = city.state
                    ? `<span class="ws4k-city-state">${esc(city.state)}</span>`
                    : '';
                return `
                  <div class="ws4k-city-row">
                    <span class="ws4k-city-name">${esc(city.name)}${stateBadge}</span>
                    <span class="ws4k-city-icon">${city.icon || '?'}</span>
                    <span class="ws4k-city-lo">${esc(stripDeg(city.lo))}</span>
                    <span class="ws4k-city-hi">${esc(stripDeg(city.hi))}</span>
                  </div>`;
            }).join('');
        }

        const footer = el('travel-footer');
        if (footer && data.conditions) {
            const c = data.conditions;
            footer.textContent = `Humidity: ${c.humidity}   \u2022   Dewpoint: ${c.dewpoint}`;
        }
    }

    /** Strip trailing "°F" / "°C" suffix so numbers sit cleaner in the table. */
    function stripDeg(s) {
        if (!s) return '--';
        return String(s).replace(/°[FC]$/, '').replace(/°$/, '') || '--';
    }

    // ── Shared Leaflet map factory ──────────────────────────────────
    /**
     * Create a Leaflet map inside `containerId` and return it.
     * Safe to call only once per container — callers guard with the
     * module-level `obsMap` / `fcstMap` null-check.
     * Returns null if the container element is missing.
     */
    function createRegionalMap(containerId) {
        const container = el(containerId);
        if (!container) return null;

        const map = L.map(containerId, {
            zoomControl: false,
            attributionControl: true,
            dragging: false,
            touchZoom: false,
            doubleClickZoom: false,
            scrollWheelZoom: false,
            boxZoom: false,
            keyboard: false,
        });

        // Same CartoDB Dark All tiles as the radar slide — already dark, no filter needed.
        L.tileLayer(
            'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
            {
                attribution: '© <a href="https://www.openstreetmap.org">OSM</a> © <a href="https://carto.com/">CARTO</a>',
                subdomains: 'abcd',
                maxZoom: 15,
            }
        ).addTo(map);

        return map;
    }

    /** Build a custom divIcon marker showing city name, temperature and icon. */
    function makeCityMarker(city, tempText, iconEmoji) {
        const html = `
          <div class="ws4k-marker">
            <span class="ws4k-marker-name">${esc(city.name)}</span>
            <span class="ws4k-marker-row">
              <span class="ws4k-marker-temp">${esc(tempText)}</span>
              <span class="ws4k-marker-icon">${iconEmoji || ''}</span>
            </span>
          </div>`;
        return L.marker([city.lat, city.lon], {
            icon: L.divIcon({ html, className: '', iconSize: [100, 55], iconAnchor: [50, 55] }),
            interactive: false,
        });
    }

    /** Place markers on a map, fit bounds, and refresh size. */
    function populateMap(map, cities, getValue, getIcon) {
        // Clear old markers
        map.eachLayer(l => { if (l instanceof L.Marker) map.removeLayer(l); });

        const coords = [];
        cities.forEach(city => {
            if (city.error) return;
            const marker = makeCityMarker(city, getValue(city), getIcon(city));
            marker.addTo(map);
            coords.push([city.lat, city.lon]);
        });

        if (coords.length) {
            const bounds = L.latLngBounds(coords).pad(0.25);
            map.fitBounds(bounds, { animate: false });
        }

        map.invalidateSize();
    }

    // ── Regional Observations ──────────────────────────────────────
    function renderRegionalObs(data) {
        pendingObsData = data;

        const container = el('regional-obs-map');
        if (!container || container.offsetWidth === 0) return; // slide not visible yet

        if (!obsMap) obsMap = createRegionalMap('regional-obs-map');
        if (!obsMap) return;

        const cities = data.nearbyCities || [];
        if (!cities.length) return;

        populateMap(obsMap, cities,
            c => stripDeg(c.temp),
            c => c.icon || '?'
        );

        const footer = el('regional-obs-footer');
        if (footer && data.conditions) {
            const c = data.conditions;
            const extra = c.windChill !== '--'
                ? `Wind Chill: ${c.windChill}`
                : c.heatIndex !== '--' ? `Heat Index: ${c.heatIndex}` : '';
            footer.textContent = `Temp: ${c.temp}   \u2022   ${extra}`.replace(/\s*\u2022\s*$/, '').trim();
        }
    }

    // ── Regional Forecast ──────────────────────────────────────────
    function renderRegionalFcst(data) {
        pendingFcstData = data;

        const container = el('regional-fcst-map');
        if (!container || container.offsetWidth === 0) return;

        if (!fcstMap) fcstMap = createRegionalMap('regional-fcst-map');
        if (!fcstMap) return;

        const cities = data.nearbyCities || [];
        if (!cities.length) return;

        populateMap(fcstMap, cities,
            c => stripDeg(c.tomorrowHi || c.hi),
            c => c.tomorrowIcon || c.icon || '?'
        );

        const footer = el('regional-fcst-footer');
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const dayName = tomorrow.toLocaleDateString('en-US', { weekday: 'long' });

        // Update the map overlay title with the forecast day
        const mapTitle = el('regional-fcst-map-title');
        if (mapTitle) mapTitle.textContent = `Forecast for ${dayName}`;

        if (footer && data.conditions) {
            const c = data.conditions;
            const extra = c.windChill !== '--'
                ? `Wind Chill: ${c.windChill}`
                : c.heatIndex !== '--' ? `Heat Index: ${c.heatIndex}` : '';
            footer.textContent = `${dayName}   \u2022   Temp: ${c.temp}   \u2022   ${extra}`.replace(/\s*\u2022\s*$/, '').trim();
        }
    }

    // ── SPC Outlook ─────────────────────────────────────────────────
    // Horizontal bar chart — one row per day, bar width ∝ risk level.
    function renderSPCOutlook(data) {
        const container = el('spc-chart');
        if (!container) return;

        const spc = data.spcOutlook;
        if (!spc || !spc.valid) {
            container.innerHTML = `
              <div style="flex:1;display:flex;align-items:center;justify-content:center">
                <div class="no-alerts">⛅ SPC outlook data unavailable.</div>
              </div>`;
            return;
        }

        // Risk-level metadata — ascending severity order
        const RISK = [
            { key: null,   pct: 0,   label: 'No Risk',   color: null },
            { key: 'TSTM', pct: 14,  label: 'T-Storm',   color: '#607d8b' },
            { key: 'MRGL', pct: 28,  label: 'Marginal',  color: '#4caf50' },
            { key: 'SLGT', pct: 46,  label: 'Slight',    color: '#cddc39' },
            { key: 'ENH',  pct: 62,  label: 'Enhanced',  color: '#ff9800' },
            { key: 'MDT',  pct: 78,  label: 'Moderate',  color: '#f44336' },
            { key: 'HIGH', pct: 100, label: 'High',      color: '#e91e63' },
        ];

        // Scale legend bands (skip the null/no-risk entry)
        const scaleBands = RISK.slice(1).map(r =>
            `<div class="ws4k-spc-band" style="background:${r.color}">${r.label}</div>`
        ).join('');

        // Build day rows
        const dayRows = spc.days.map(day => {
            const meta = RISK.find(r => r.key === day.risk) || RISK[0];
            const isNoRisk = meta.pct === 0;

            const barHtml = isNoRisk
                ? `<div class="ws4k-spc-bar ws4k-spc-bar-norisk">
                     <span class="ws4k-spc-norisk-text">No Thunderstorm Risk</span>
                   </div>`
                : `<div class="ws4k-spc-bar ws4k-spc-bar-active" data-w="${meta.pct}"
                        style="width:0%;background:${meta.color}">
                     <span class="ws4k-spc-bar-text">${esc(day.riskLabel || meta.label)}</span>
                   </div>`;

            return `
              <div class="ws4k-spc-day-row">
                <span class="ws4k-spc-day-name">${esc(day.dayName)}</span>
                <div class="ws4k-spc-bar-track">${barHtml}</div>
              </div>`;
        }).join('');

        container.innerHTML = `
          <div class="ws4k-spc-heading">
            <span class="ws4k-spc-heading-title">SPC Outlook</span>
            <span class="ws4k-spc-heading-sub">Convective Forecast</span>
          </div>
          <div class="ws4k-spc-scale-wrapper">
            <div class="ws4k-spc-scale-spacer"></div>
            <div class="ws4k-spc-scale">${scaleBands}</div>
          </div>
          <div class="ws4k-spc-days">${dayRows}</div>`;

        // Animate active bars: start at 0% → expand to target after paint
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                container.querySelectorAll('.ws4k-spc-bar-active').forEach(b => {
                    const w = b.dataset.w;
                    if (w) b.style.width = `${w}%`;
                });
            });
        });
    }

    // ── Ticker ─────────────────────────────────────────────────────
    function updateTicker(data, slideTitle) {
        const ticker = el('ticker-text');
        const label = el('ticker-label');
        if (label) label.textContent = slideTitle || 'CONDITIONS';
        if (ticker && data.ticker) {
            ticker.textContent = data.ticker;
            // Scale scroll duration with text length so long condition strings don't fly by (~80 px/s)
            requestAnimationFrame(() => {
                const containerW = ticker.parentElement?.clientWidth || 800;
                const textW = ticker.scrollWidth;
                // Animation travels from +100% to -100% of container = containerW + textW pixels total
                const totalPx = containerW + textW;
                const duration = Math.max(15, Math.round(totalPx / 80));
                ticker.style.animationDuration = `${duration}s`;
            });
        }
    }

    // ── Map visibility callbacks (called from app.js) ───────────────
    function onRegionalObsVisible() {
        if (!obsMap) obsMap = createRegionalMap('regional-obs-map');
        if (obsMap) {
            obsMap.invalidateSize();
            if (pendingObsData) renderRegionalObs(pendingObsData);
        }
    }

    function onRegionalFcstVisible() {
        if (!fcstMap) fcstMap = createRegionalMap('regional-fcst-map');
        if (fcstMap) {
            fcstMap.invalidateSize();
            if (pendingFcstData) renderRegionalFcst(pendingFcstData);
        }
    }

    // ── Render all ─────────────────────────────────────────────────
    function renderAll(weatherData, alerts, lat, lon, onTTS) {
        renderConditions(weatherData);
        renderObservations(weatherData);
        renderHourly(weatherData);
        renderExtended(weatherData);
        renderPrecipChart(weatherData);
        renderAlmanac(weatherData);
        renderClimateHistory(weatherData);
        renderAirQuality(weatherData);
        renderRadar(lat, lon);
        renderAlerts(alerts, onTTS);
        renderCustomForecast(weatherData.customForecasts);
        renderTravel(weatherData);
        renderRegionalObs(weatherData);
        renderRegionalFcst(weatherData);
        renderSPCOutlook(weatherData);
        updateTicker(weatherData, 'CONDITIONS');
    }

    return {
        renderAll, renderConditions, renderObservations, renderHourly, renderExtended,
        renderPrecipChart, renderAlmanac, renderAirQuality, renderClimateHistory,
        renderRadar, renderAlerts, renderCustomForecast, updateTicker,
        renderTravel, renderRegionalObs, renderRegionalFcst, renderSPCOutlook,
        onRegionalObsVisible, onRegionalFcstVisible,
    };
})();
