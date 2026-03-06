/* ════════════════════════════════════════════════════════════════
   displays.js – Slide rendering engine (expanded)
   ════════════════════════════════════════════════════════════════ */

const Displays = (() => {
    function el(id) { return document.getElementById(id); }
    function txt(id, v) { const e = el(id); if (e) e.textContent = v ?? '--'; }

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

        const items = [
            { icon: '🌡', label: 'Temperature', value: c.temp },
            { icon: '🤔', label: 'Feels Like', value: c.feelsLike },
            { icon: '💧', label: 'Humidity', value: c.humidity },
            { icon: '🌫', label: 'Dewpoint', value: c.dewpoint },
            { icon: '💨', label: 'Wind', value: c.wind },
            { icon: '💨', label: 'Wind Direction', value: `${c.windDeg ?? '--'}° (${windDirArrow(c.windDeg)})` },
            { icon: '🌬', label: 'Gusts', value: c.gusts },
            { icon: '👀', label: 'Visibility', value: c.visibility },
            { icon: '📊', label: 'Pressure', value: c.pressure },
            { icon: '📈', label: 'Trend', value: c.pressureTrend || '--' },
            { icon: '☁️', label: 'Cloud Cover', value: c.cloudCover },
            { icon: '☀️', label: 'UV Index', value: c.uv },
            { icon: '🌧', label: 'Precip (1h)', value: c.precipitation24h },
            { icon: '❄️', label: 'Snow Depth', value: c.snowDepth },
            { icon: '🔥', label: 'Heat Index', value: c.heatIndex !== '--' ? c.heatIndex : 'N/A' },
            { icon: '🥶', label: 'Wind Chill', value: c.windChill !== '--' ? c.windChill : 'N/A' },
            { icon: '🌅', label: 'Sunrise', value: a?.sunrise || '--' },
            { icon: '🌇', label: 'Sunset', value: a?.sunset || '--' },
            { icon: '🌕', label: 'Moon Phase', value: a?.moon || '--' },
            { icon: '🕛', label: 'Solar Noon', value: a?.solarNoon || '--' },
            { icon: '🌄', label: 'Civil Dawn', value: a?.dawnCivil || '--' },
            { icon: '🌆', label: 'Civil Dusk', value: a?.duskCivil || '--' },
            { icon: '📅', label: 'Day Length', value: a?.dayLength || '--' },
            { icon: '🔢', label: 'Day of Year', value: a?.dayOfYear || '--' },
        ];

        container.innerHTML = items.map(item => `
          <div class="obs-card">
            <span class="obs-icon">${item.icon}</span>
            <span class="obs-label">${item.label}</span>
            <span class="obs-value">${item.value}</span>
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
    function renderCustomForecast(cf) {
        const container = el('customforecast-container');
        if (!container) return;
        container.innerHTML = '';
        const periods = cf?.periods || [];
        if (!periods.length) return;
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
            container.appendChild(card);
        });
        const updatedEl = el('customforecast-updated');
        if (updatedEl && cf?.updatedAt) {
            updatedEl.textContent = `Updated: ${new Date(cf.updatedAt).toLocaleString()}`;
        }
    }

    function esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ── Ticker ─────────────────────────────────────────────────────
    function updateTicker(data, slideTitle) {
        const ticker = el('ticker-text');
        const label = el('ticker-label');
        if (label) label.textContent = slideTitle || 'CONDITIONS';
        if (ticker && data.ticker) ticker.textContent = data.ticker;
    }

    // ── Render all ─────────────────────────────────────────────────
    function renderAll(weatherData, alerts, lat, lon, onTTS) {
        renderConditions(weatherData);
        renderObservations(weatherData);
        renderHourly(weatherData);
        renderExtended(weatherData);
        renderPrecipChart(weatherData);
        renderAlmanac(weatherData);
        renderAirQuality(weatherData);
        renderRadar(lat, lon);
        renderAlerts(alerts, onTTS);
        renderCustomForecast(weatherData.customForecast);
        updateTicker(weatherData, 'CONDITIONS');
    }

    return {
        renderAll, renderConditions, renderObservations, renderHourly, renderExtended,
        renderPrecipChart, renderAlmanac, renderAirQuality,
        renderRadar, renderAlerts, renderCustomForecast, updateTicker
    };
})();
