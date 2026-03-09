/* ════════════════════════════════════════════════════════════════
   weather.js – Weather API integration (Open-Meteo + NWS + Pollen)
   All APIs are free, no key required.
   ════════════════════════════════════════════════════════════════ */

const WeatherAPI = (() => {

    let currentLat = null, currentLon = null;
    let currentLocation = '';
    let useFahrenheit = true;
    let weatherData = {}, alertsData = [];
    let locationDetails = null; // { zip, county, state, stateCode }

    // ── Geocoding ─────────────────────────────────────────────────
    async function geocode(query) {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1`;
        const resp = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!resp.ok) throw new Error('Geocoding failed');
        const data = await resp.json();
        if (!data.length) throw new Error('Location not found');
        const r = data[0], addr = r.address;
        const label = [addr.city || addr.town || addr.village || addr.county, addr.state].filter(Boolean).join(', ');
        return { lat: parseFloat(r.lat), lon: parseFloat(r.lon), label };
    }

    async function reverseGeocode(lat, lon) {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`;
        const resp = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!resp.ok) throw new Error('Reverse geocoding failed');
        const data = await resp.json(), addr = data.address;
        return [addr.city || addr.town || addr.village || addr.county, addr.state].filter(Boolean).join(', ');
    }

    // ── Fetch ZIP + county details for targeting ──────────────────
    async function fetchLocationDetails(lat, lon) {
        try {
            const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`;
            const resp = await fetch(url, { headers: { Accept: 'application/json' } });
            if (!resp.ok) return null;
            const data = await resp.json();
            const addr = data.address || {};
            const stateCode = addr.state_code || (() => {
                const iso = addr['ISO3166-2-lvl4'];
                if (!iso || typeof iso !== 'string') return null;
                const parts = iso.split('-');
                return parts.length === 2 ? parts[1] : null;
            })();
            return {
                zip: addr.postcode || null,
                county: addr.county || addr.state_district || null,
                state: addr.state || null,
                stateCode: stateCode || null
            };
        } catch { return null; }
    }

    // ── Main Weather Fetch (Open-Meteo) ───────────────────────────
    async function fetchWeather(lat, lon) {
        const units = useFahrenheit ? 'fahrenheit' : 'celsius';
        const windU = useFahrenheit ? 'mph' : 'kmh';
        const precU = useFahrenheit ? 'inch' : 'mm';

        const params = new URLSearchParams({
            latitude: lat, longitude: lon,
            current: [
                'temperature_2m', 'apparent_temperature', 'relative_humidity_2m',
                'dew_point_2m', 'precipitation', 'weather_code', 'cloud_cover',
                'surface_pressure', 'wind_speed_10m', 'wind_direction_10m',
                'wind_gusts_10m', 'visibility', 'uv_index', 'is_day',
                'rain', 'snowfall', 'showers', 'snow_depth'
            ].join(','),
            hourly: [
                'temperature_2m', 'weather_code', 'precipitation_probability',
                'precipitation', 'apparent_temperature', 'wind_speed_10m',
                'relative_humidity_2m', 'cloud_cover', 'visibility',
                'snow_depth', 'freezing_level_height', 'cape'
            ].join(','),
            daily: [
                'weather_code', 'temperature_2m_max', 'temperature_2m_min',
                'precipitation_probability_max', 'precipitation_sum',
                'sunrise', 'sunset', 'uv_index_max', 'daylight_duration',
                'wind_speed_10m_max', 'wind_gusts_10m_max',
                'precipitation_hours', 'snowfall_sum', 'rain_sum'
            ].join(','),
            temperature_unit: units,
            wind_speed_unit: windU,
            precipitation_unit: precU,
            timezone: 'auto',
            forecast_days: 8,
            forecast_hours: 48,
            past_hours: 2
        });

        const resp = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
        if (!resp.ok) throw new Error('Weather fetch failed');
        return resp.json();
    }

    // ── Air Quality + Pollen (Open-Meteo AQ API) ──────────────────
    async function fetchAirQuality(lat, lon) {
        const params = new URLSearchParams({
            latitude: lat, longitude: lon,
            current: [
                'us_aqi', 'pm2_5', 'pm10', 'ozone', 'nitrogen_dioxide',
                'carbon_monoxide', 'sulphur_dioxide', 'dust',
                'alder_pollen', 'birch_pollen', 'grass_pollen',
                'mugwort_pollen', 'olive_pollen', 'ragweed_pollen'
            ].join(','),
            hourly: ['us_aqi', 'pm2_5', 'pm10'].join(','),
            timezone: 'auto'
        });
        try {
            const resp = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`);
            if (!resp.ok) return null;
            return resp.json();
        } catch { return null; }
    }

    // ── NWS Alerts ────────────────────────────────────────────────
    async function fetchAlerts(lat, lon) {
        const url = `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}&status=actual&message_type=alert`;
        try {
            const resp = await fetch(url, { headers: { Accept: 'application/geo+json', 'User-Agent': 'WeatherNow/1.0' } });
            if (!resp.ok) return [];
            const data = await resp.json();
            return (data.features || []).map(f => f.properties);
        } catch { return []; }
    }

    // ── Helpers ───────────────────────────────────────────────────
    function fmtTime(d) { return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }); }
    function fmtTemp(v) { return v == null ? '--' : `${Math.round(v)}°${useFahrenheit ? 'F' : 'C'}`; }
    function hPaToInHg(v) { return (v * 0.02953).toFixed(2); }
    function fmtVis(m) {
        if (m == null) return '--';
        if (useFahrenheit) { const mi = m / 1609.34; return mi >= 10 ? '10+ mi' : `${mi.toFixed(1)} mi`; }
        return m >= 10000 ? '10+ km' : `${(m / 1000).toFixed(1)} km`;
    }
    function windDir(deg) {
        return ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(deg / 22.5) % 16];
    }
    function aqiLabel(v) {
        if (v <= 50) return { label: 'Good', color: '#00c846' };
        if (v <= 100) return { label: 'Moderate', color: '#ffd000' };
        if (v <= 150) return { label: 'Unhealthy (Sensitive)', color: '#ff6600' };
        if (v <= 200) return { label: 'Unhealthy', color: '#cc0000' };
        if (v <= 300) return { label: 'Very Unhealthy', color: '#7d0023' };
        return { label: 'Hazardous', color: '#4d0011' };
    }
    function pollenLevel(v) {
        if (v == null) return { label: '--', color: '#94a3b8' };
        if (v <= 0) return { label: 'None', color: '#4ade80' };
        if (v <= 10) return { label: 'Low', color: '#a3e635' };
        if (v <= 50) return { label: 'Moderate', color: '#fbbf24' };
        if (v <= 200) return { label: 'High', color: '#f97316' };
        return { label: 'Very High', color: '#ef4444' };
    }
    function getMoonPhase() {
        const diff = (Date.now() - new Date('2024-01-11').getTime()) / 86400000;
        const phase = ((diff % 29.53059) + 29.53059) % 29.53059;
        for (const [name, max] of [
            ['🌑 New Moon', 1.85], ['🌒 Waxing Crescent', 7.38], ['🌓 First Quarter', 11.08],
            ['🌔 Waxing Gibbous', 14.77], ['🌕 Full Moon', 16.61], ['🌖 Waning Gibbous', 22.15],
            ['🌗 Last Quarter', 25.84], ['🌘 Waning Crescent', 29.53]
        ]) { if (phase < max) return name; }
        return '🌑 New Moon';
    }
    function wmoToWeather(code, isDay = true) {
        const map = {
            0: { emoji: isDay ? '☀️' : '🌙', desc: 'Clear sky' }, 1: { emoji: isDay ? '🌤' : '🌙', desc: 'Mainly clear' },
            2: { emoji: '⛅', desc: 'Partly cloudy' }, 3: { emoji: '☁️', desc: 'Overcast' },
            45: { emoji: '🌫', desc: 'Fog' }, 48: { emoji: '🌫', desc: 'Icy fog' },
            51: { emoji: '🌦', desc: 'Light drizzle' }, 53: { emoji: '🌦', desc: 'Drizzle' }, 55: { emoji: '🌧', desc: 'Heavy drizzle' },
            61: { emoji: '🌧', desc: 'Light rain' }, 63: { emoji: '🌧', desc: 'Rain' }, 65: { emoji: '🌧', desc: 'Heavy rain' },
            66: { emoji: '🌨', desc: 'Light freezing rain' }, 67: { emoji: '🌨', desc: 'Freezing rain' },
            71: { emoji: '🌨', desc: 'Light snow' }, 73: { emoji: '❄️', desc: 'Snow' }, 75: { emoji: '❄️', desc: 'Heavy snow' },
            77: { emoji: '🌨', desc: 'Snow grains' },
            80: { emoji: '🌦', desc: 'Light showers' }, 81: { emoji: '🌧', desc: 'Showers' }, 82: { emoji: '⛈', desc: 'Heavy showers' },
            85: { emoji: '🌨', desc: 'Snow showers' }, 86: { emoji: '🌨', desc: 'Heavy snow showers' },
            95: { emoji: '⛈', desc: 'Thunderstorm' }, 96: { emoji: '⛈', desc: 'Thunderstorm w/ hail' }, 99: { emoji: '⛈', desc: 'Thunderstorm w/ heavy hail' },
        };
        return map[code] || { emoji: '🌡', desc: 'Unknown' };
    }
    function uvLabel(v) {
        const n = parseFloat(v);
        if (isNaN(n)) return '--';
        if (n <= 2) return `${v} · Low`;
        if (n <= 5) return `${v} · Moderate`;
        if (n <= 7) return `${v} · High`;
        if (n <= 10) return `${v} · Very High`;
        return `${v} · Extreme`;
    }

    // ── Compute heat index / wind chill ───────────────────────────
    function heatIndex(tempF, rh) {
        if (tempF < 80) return null; // only relevant at high temps
        const hi = -42.379 + 2.04901523 * tempF + 10.14333127 * rh
            - 0.22475541 * tempF * rh - 0.00683783 * tempF * tempF
            - 0.05481717 * rh * rh + 0.00122874 * tempF * tempF * rh
            + 0.00085282 * tempF * rh * rh - 0.00000199 * tempF * tempF * rh * rh;
        return Math.round(hi);
    }
    function windChill(tempF, windMph) {
        if (tempF > 50 || windMph < 3) return null; // only relevant when cold and windy
        return Math.round(35.74 + 0.6215 * tempF - 35.75 * Math.pow(windMph, 0.16) + 0.4275 * tempF * Math.pow(windMph, 0.16));
    }

    // ── getSunData ─────────────────────────────────────────────────
    function getSunData(daily) {
        if (!daily?.sunrise?.length) return {};
        const sunrise = new Date(daily.sunrise[0]);
        const sunset = new Date(daily.sunset[0]);
        const msDay = sunset - sunrise;
        const solarNoon = new Date(sunrise.getTime() + msDay / 2);
        const now = new Date();
        const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
        // civil twilight approx = sunrise - 30 min
        const dawnCivil = new Date(sunrise.getTime() - 30 * 60000);
        const duskCivil = new Date(sunset.getTime() + 30 * 60000);
        return {
            sunrise: fmtTime(sunrise),
            sunset: fmtTime(sunset),
            dayLength: `${Math.floor(msDay / 3600000)}h ${Math.floor((msDay % 3600000) / 60000)}m`,
            solarNoon: fmtTime(solarNoon),
            dayOfYear: `Day ${dayOfYear} of 365`,
            dawnCivil: fmtTime(dawnCivil),
            duskCivil: fmtTime(duskCivil),
        };
    }

    // ── processData ────────────────────────────────────────────────
    function processData(raw, aq) {
        const c = raw.current, d = raw.daily, h = raw.hourly;
        const isDay = c.is_day === 1;
        const wx = wmoToWeather(c.weather_code, isDay);
        const sunData = getSunData(d);
        const moon = getMoonPhase();

        const windSpd = Math.round(c.wind_speed_10m);
        const windU = useFahrenheit ? 'mph' : 'km/h';
        const tempF = useFahrenheit ? c.temperature_2m : c.temperature_2m * 9 / 5 + 32;
        const rhValue = c.relative_humidity_2m;

        // Cloud cover descriptive
        const cloudPct = c.cloud_cover;
        const cloudDesc = cloudPct <= 10 ? 'Clear' : cloudPct <= 30 ? 'Mostly Clear' :
            cloudPct <= 60 ? 'Partly Cloudy' : cloudPct <= 85 ? 'Mostly Cloudy' : 'Overcast';

        // Pressure trend (compare current to 2h ago if available)
        const pressureTrend = (() => {
            if (!h?.surface_pressure?.length) return '';
            const now = c.surface_pressure;
            const prev = h.surface_pressure[0]; // 2 hours ago (past_hours=2)
            const diff = (now - prev) * 0.02953;
            if (Math.abs(diff) < 0.01) return '→ Steady';
            return diff > 0 ? `↑ Rising` : `↓ Falling`;
        })();

        // Current conditions
        const conditions = {
            temp: fmtTemp(c.temperature_2m),
            feelsLike: fmtTemp(c.apparent_temperature),
            humidity: `${rhValue}%`,
            dewpoint: fmtTemp(c.dew_point_2m),
            wind: `${windSpd} ${windU} ${windDir(c.wind_direction_10m)}`,
            windDeg: c.wind_direction_10m,
            windRaw: windSpd,
            gusts: c.wind_gusts_10m ? `${Math.round(c.wind_gusts_10m)} ${windU}` : '--',
            visibility: fmtVis(c.visibility),
            pressure: `${hPaToInHg(c.surface_pressure)} inHg`,
            pressureTrend,
            pressureHPa: `${Math.round(c.surface_pressure)} hPa`,
            uv: uvLabel(c.uv_index != null ? c.uv_index.toFixed(1) : null),
            uvRaw: c.uv_index,
            cloudCover: `${cloudPct}% (${cloudDesc})`,
            ceiling: 'Unlimited',
            snowDepth: c.snow_depth ? `${(c.snow_depth * (useFahrenheit ? 39.37 : 100)).toFixed(1)} ${useFahrenheit ? 'in' : 'cm'}` : 'None',
            precipitation24h: c.precipitation != null ? `${c.precipitation.toFixed(2)} ${useFahrenheit ? 'in' : 'mm'}` : '--',
            heatIndex: (() => {
                const hi = heatIndex(tempF, rhValue);
                if (!hi) return '--';
                return useFahrenheit ? `${hi}°F` : `${Math.round((hi - 32) * 5 / 9)}°C`;
            })(),
            windChill: (() => {
                const wc = windChill(tempF, windSpd);
                if (!wc) return '--';
                return useFahrenheit ? `${wc}°F` : `${Math.round((wc - 32) * 5 / 9)}°C`;
            })(),
            icon: wx.emoji, desc: wx.desc, isDay,
            rawTemp: c.temperature_2m,
            rawCode: c.weather_code,
        };

        // Hourly (next 48h, skip past_hours offset)
        const hourlyOffset = 2; // past_hours=2
        const hourly = [];
        for (let i = hourlyOffset; i < Math.min(hourlyOffset + 24, h.time.length); i++) {
            const t = new Date(h.time[i]);
            const wxH = wmoToWeather(h.weather_code[i], t.getHours() >= 6 && t.getHours() < 20);
            hourly.push({
                time: i === hourlyOffset ? 'Now' : fmtTime(t),
                icon: wxH.emoji, desc: wxH.desc,
                temp: fmtTemp(h.temperature_2m[i]),
                feelsLike: fmtTemp(h.apparent_temperature?.[i]),
                precip: h.precipitation_probability[i] > 5 ? `💧 ${h.precipitation_probability[i]}%` : '',
                precipAmt: h.precipitation?.[i] > 0 ? `${h.precipitation[i].toFixed(2)}"` : '',
                wind: h.wind_speed_10m?.[i] ? `${Math.round(h.wind_speed_10m[i])} ${windU}` : '',
                cloud: h.cloud_cover?.[i] != null ? `${h.cloud_cover[i]}%` : '',
                isCurrent: i === hourlyOffset
            });
        }

        // Hourly precip chart (next 24h)
        const precipChart = [];
        for (let i = hourlyOffset; i < Math.min(hourlyOffset + 24, h.time.length); i++) {
            const t = new Date(h.time[i]);
            precipChart.push({
                time: i === hourlyOffset ? 'Now' : `${t.getHours()}:00`,
                prob: h.precipitation_probability?.[i] || 0,
                amount: h.precipitation?.[i] || 0,
                snow: (h.snow_depth?.[i] || 0) > 0,
                cape: h.cape?.[i] || 0
            });
        }

        // Daily (7-day)
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const daily = [];
        for (let i = 0; i < Math.min(7, d.time.length); i++) {
            const dt = new Date(d.time[i] + 'T12:00:00');
            const wxD = wmoToWeather(d.weather_code[i]);
            daily.push({
                name: i === 0 ? 'Today' : days[dt.getDay()],
                icon: wxD.emoji, desc: wxD.desc,
                hi: fmtTemp(d.temperature_2m_max[i]),
                lo: fmtTemp(d.temperature_2m_min[i]),
                precip: d.precipitation_probability_max[i] > 5 ? `💧 ${d.precipitation_probability_max[i]}%` : '',
                precipSum: d.precipitation_sum?.[i] > 0 ? `${d.precipitation_sum[i].toFixed(2)} ${useFahrenheit ? 'in' : 'mm'}` : '',
                snowSum: d.snowfall_sum?.[i] > 0 ? `❄ ${d.snowfall_sum[i].toFixed(1)} ${useFahrenheit ? 'in' : 'cm'}` : '',
                wind: d.wind_speed_10m_max?.[i] ? `${Math.round(d.wind_speed_10m_max[i])} ${windU}` : '',
                uvMax: d.uv_index_max?.[i] != null ? d.uv_index_max[i].toFixed(0) : '--',
                isToday: i === 0
            });
        }

        // Almanac
        const almanac = { ...sunData, moon };

        // AQ + Pollen
        let airQuality = null, pollen = null;
        if (aq?.current) {
            const aqi = Math.round(aq.current.us_aqi || 0);
            const info = aqiLabel(aqi);
            airQuality = {
                aqi, label: info.label, color: info.color,
                pct: Math.min((aqi / 300) * 100, 100),
                pm25: aq.current.pm2_5?.toFixed(1) ?? '--',
                pm10: aq.current.pm10?.toFixed(1) ?? '--',
                ozone: aq.current.ozone?.toFixed(1) ?? '--',
                no2: aq.current.nitrogen_dioxide?.toFixed(1) ?? '--',
                co: aq.current.carbon_monoxide?.toFixed(0) ?? '--',
                so2: aq.current.sulphur_dioxide?.toFixed(1) ?? '--',
                dust: aq.current.dust?.toFixed(1) ?? '--',
            };
            const g = aq.current.grass_pollen,
                b = aq.current.birch_pollen,
                al = aq.current.alder_pollen,
                mw = aq.current.mugwort_pollen,
                ra = aq.current.ragweed_pollen,
                ol = aq.current.olive_pollen;
            const totalPollen = [g, b, al, mw, ra, ol].filter(x => x != null).reduce((a, v) => a + v, 0);
            const pollenLbl = pollenLevel(totalPollen > 0 ? totalPollen : null);
            pollen = {
                grass: { val: g != null ? Math.round(g) : '--', ...pollenLevel(g) },
                birch: { val: b != null ? Math.round(b) : '--', ...pollenLevel(b) },
                alder: { val: al != null ? Math.round(al) : '--', ...pollenLevel(al) },
                ragweed: { val: ra != null ? Math.round(ra) : '--', ...pollenLevel(ra) },
                mugwort: { val: mw != null ? Math.round(mw) : '--', ...pollenLevel(mw) },
                olive: { val: ol != null ? Math.round(ol) : '--', ...pollenLevel(ol) },
                overall: pollenLbl
            };
        }

        // Ticker
        const ticker = `${wx.emoji} ${wx.desc} | ${conditions.temp} (Feels ${conditions.feelsLike}) | Humidity: ${conditions.humidity} | Dewpoint: ${conditions.dewpoint} | Wind: ${conditions.wind} | Gusts: ${conditions.gusts} | Visibility: ${conditions.visibility} | Pressure: ${conditions.pressure} ${pressureTrend} | UV: ${conditions.uvRaw ?? '--'} | Cloud Cover: ${cloudPct}%${c.snow_depth > 0 ? ' | Snow Depth: ' + conditions.snowDepth : ''}`;

        return { conditions, hourly, daily, almanac, airQuality, pollen, precipChart, ticker };
    }

    // ── Multi-city helpers ────────────────────────────────────────

    /** Haversine distance in miles between two lat/lon points */
    function haversineMiles(lat1, lon1, lat2, lon2) {
        const R = 3958.8;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2
            + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    /**
     * Fetch minimal current + 2-day forecast for a single lat/lon.
     * Returns { temp, hi, lo, icon, desc, weatherCode, isDay }
     */
    async function fetchCityWeather(lat, lon) {
        const units = useFahrenheit ? 'fahrenheit' : 'celsius';
        const windU = useFahrenheit ? 'mph' : 'kmh';
        const params = new URLSearchParams({
            latitude: lat, longitude: lon,
            current: 'temperature_2m,weather_code,is_day',
            daily: 'temperature_2m_max,temperature_2m_min,weather_code',
            temperature_unit: units,
            wind_speed_unit: windU,
            timezone: 'auto',
            forecast_days: 2,
        });
        const resp = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
        if (!resp.ok) throw new Error('City weather fetch failed');
        const data = await resp.json();
        const c = data.current;
        const d = data.daily;
        const isDay = c.is_day === 1;
        const wx = wmoToWeather(c.weather_code, isDay);
        const wxTomorrow = wmoToWeather(d.weather_code?.[1] ?? d.weather_code?.[0], true);
        return {
            temp: fmtTemp(c.temperature_2m),
            tempRaw: c.temperature_2m,
            hi: fmtTemp(d.temperature_2m_max[0]),
            lo: fmtTemp(d.temperature_2m_min[0]),
            tomorrowHi: fmtTemp(d.temperature_2m_max[1] ?? d.temperature_2m_max[0]),
            tomorrowIcon: wxTomorrow.emoji,
            tomorrowDesc: wxTomorrow.desc,
            icon: wx.emoji,
            desc: wx.desc,
            weatherCode: c.weather_code,
            isDay,
        };
    }

    /**
     * Fetch weather for a list of city objects { name, state, lat, lon }.
     * Returns array of { name, state, lat, lon, ...weatherData } in parallel.
     */
    async function fetchTravelCities(cities) {
        const results = await Promise.allSettled(
            cities.map(city =>
                fetchCityWeather(city.lat, city.lon).then(wx => ({ ...city, ...wx, error: false }))
            )
        );
        return results.map((r, i) =>
            r.status === 'fulfilled' ? r.value : { ...cities[i], error: true, temp: '--', hi: '--', lo: '--', icon: '?', desc: '' }
        );
    }

    /**
     * Find the N cities closest to (lat, lon) from MAJOR_US_CITIES and fetch their weather.
     * Excludes the user's own location if it matches a city within 10 miles.
     */
    async function fetchNearbyCities(lat, lon, count = 8) {
        if (typeof MAJOR_US_CITIES === 'undefined') return [];
        const sorted = MAJOR_US_CITIES
            .map(c => ({ ...c, dist: haversineMiles(lat, lon, c.lat, c.lon) }))
            .sort((a, b) => a.dist - b.dist)
            .filter(c => c.dist > 10) // exclude user's immediate city
            .slice(0, count);
        return fetchTravelCities(sorted);
    }

    /**
     * Fetch SPC categorical outlook for Days 1–3 via local proxy.
     * Returns { day1, day2, day3 } where each is a GeoJSON FeatureCollection or null.
     */
    async function fetchSPCOutlook() {
        const days = ['1', '2', '3'];
        const results = await Promise.allSettled(
            days.map(d =>
                fetch(`/api/spc-outlook?day=${d}`, { cache: 'no-store' })
                    .then(r => r.ok ? r.json() : null)
                    .catch(() => null)
            )
        );
        return {
            day1: results[0].status === 'fulfilled' ? results[0].value : null,
            day2: results[1].status === 'fulfilled' ? results[1].value : null,
            day3: results[2].status === 'fulfilled' ? results[2].value : null,
        };
    }

    /**
     * Point-in-ring test (ray casting, GeoJSON coordinate order: [lon, lat]).
     */
    function pointInRing(lon, lat, ring) {
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [xi, yi] = ring[i];
            const [xj, yj] = ring[j];
            const intersect = ((yi > lat) !== (yj > lat))
                && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    /**
     * Given a GeoJSON FeatureCollection (SPC categorical outlook) and user coordinates,
     * return the highest risk category label at that point.
     * Order: TSTM < MRGL < SLGT < ENH < MDT < HIGH
     */
    function spcRiskAtPoint(geoJSON, lat, lon) {
        if (!geoJSON?.features?.length) return null;
        const ORDER = ['TSTM', 'MRGL', 'SLGT', 'ENH', 'MDT', 'HIGH'];
        let maxIdx = -1;
        for (const feature of geoJSON.features) {
            const label = feature.properties?.LABEL;
            if (!label) continue;
            const geom = feature.geometry;
            if (!geom) continue;
            let hit = false;
            if (geom.type === 'Polygon') {
                hit = pointInRing(lon, lat, geom.coordinates[0]);
            } else if (geom.type === 'MultiPolygon') {
                hit = geom.coordinates.some(poly => pointInRing(lon, lat, poly[0]));
            }
            if (hit) {
                const idx = ORDER.indexOf(label);
                if (idx > maxIdx) maxIdx = idx;
            }
        }
        return maxIdx >= 0 ? ORDER[maxIdx] : null;
    }

    /**
     * Process SPC GeoJSON outlook into a structured object for rendering.
     * Returns { days: [{ label, risk, riskLabel, color }, ...], valid: boolean }
     */
    function processSPCOutlook(spcData, lat, lon) {
        const RISK_META = {
            null:   { label: 'No Risk',   color: '#3a3a3a', pct: 0 },
            TSTM:   { label: 'T\'Storm',  color: '#2e7d32', pct: 14 },
            MRGL:   { label: 'Marginal',  color: '#4caf50', pct: 28 },
            SLGT:   { label: 'Slight',    color: '#cddc39', pct: 46 },
            ENH:    { label: 'Enhanced',  color: '#ff9800', pct: 62 },
            MDT:    { label: 'Moderate',  color: '#f44336', pct: 78 },
            HIGH:   { label: 'High',      color: '#e91e63', pct: 95 },
        };

        const now = new Date();
        const dayNames = [];
        for (let i = 0; i < 3; i++) {
            const d = new Date(now);
            d.setDate(d.getDate() + i);
            dayNames.push(d.toLocaleDateString('en-US', { weekday: 'long' }));
        }

        const datasets = [spcData.day1, spcData.day2, spcData.day3];
        const days = datasets.map((data, i) => {
            const risk = spcRiskAtPoint(data, lat, lon);
            const meta = RISK_META[risk] ?? RISK_META[null];
            return {
                dayName: dayNames[i],
                risk,
                riskLabel: meta.label,
                color: meta.color,
                pct: meta.pct,
                available: data !== null,
            };
        });

        return { days, valid: datasets.some(d => d !== null) };
    }

    // ── Public ────────────────────────────────────────────────────
    async function loadLocation(query) {
        const geo = await geocode(query);
        currentLat = geo.lat; currentLon = geo.lon; currentLocation = geo.label;
        locationDetails = null;
        fetchLocationDetails(currentLat, currentLon).then(d => { locationDetails = d; }).catch(() => {});
        return geo;
    }
    async function loadIPLocation() {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
            const resp = await fetch('https://ipapi.co/json/', { signal: controller.signal });
            if (!resp.ok) throw new Error('IP geolocation failed');
            const data = await resp.json();
            if (!data.latitude || !data.longitude) throw new Error('IP geolocation returned no coordinates');
            currentLat = data.latitude;
            currentLon = data.longitude;
            currentLocation = [data.city, data.region].filter(Boolean).join(', ') || 'Your Location';
            locationDetails = null;
            fetchLocationDetails(currentLat, currentLon).then(d => { locationDetails = d; }).catch(() => {});
            return { lat: currentLat, lon: currentLon, label: currentLocation };
        } finally {
            clearTimeout(timer);
        }
    }
    async function loadGPS() {
        return new Promise((res, rej) => {
            if (!navigator.geolocation) return rej(new Error('Geolocation not supported'));
            navigator.geolocation.getCurrentPosition(async pos => {
                currentLat = pos.coords.latitude; currentLon = pos.coords.longitude;
                try { currentLocation = await reverseGeocode(currentLat, currentLon); } catch { currentLocation = 'Your Location'; }
                locationDetails = null;
                fetchLocationDetails(currentLat, currentLon).then(d => { locationDetails = d; }).catch(() => {});
                res({ lat: currentLat, lon: currentLon, label: currentLocation });
            }, rej);
        });
    }
    async function fetchAll() {
        if (!currentLat) throw new Error('No location set');

        // Nearby cities power both the Travel Forecast and Regional slides,
        // adapting automatically to the user's current position.
        const [raw, aq, alerts, cf, nearbyCities, spcRaw] = await Promise.all([
            fetchWeather(currentLat, currentLon),
            fetchAirQuality(currentLat, currentLon),
            fetchAlerts(currentLat, currentLon),
            fetch('/api/custom-forecast', { cache: 'no-store' })
                .then(r => r.ok ? r.json() : { periods: [], updatedAt: null })
                .catch(() => ({ periods: [], updatedAt: null })),
            fetchNearbyCities(currentLat, currentLon, 8).catch(() => []),
            fetchSPCOutlook().catch(() => ({ day1: null, day2: null, day3: null })),
        ]);

        weatherData = processData(raw, aq);
        weatherData.customForecast = cf;
        // Both travel and regional slides share the same nearby-city dataset
        weatherData.nearbyCities = nearbyCities;
        weatherData.travelCities = nearbyCities;
        weatherData.spcOutlook = processSPCOutlook(spcRaw, currentLat, currentLon);
        alertsData = alerts;
        return { weather: weatherData, alerts: alertsData };
    }
    function setUnits(f) { useFahrenheit = f; }
    function getLocation() { return { lat: currentLat, lon: currentLon, label: currentLocation }; }
    function getLocationDetails() { return locationDetails; }
    function getData() { return weatherData; }
    function getAlerts() { return alertsData; }

    return {
        loadLocation, loadIPLocation, loadGPS, fetchAll, setUnits,
        getLocation, getLocationDetails, getData, getAlerts,
        fetchTravelCities, fetchNearbyCities,
    };
})();
