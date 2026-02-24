/* ════════════════════════════════════════════════════════════════
   radar.js – Leaflet map with NEXRAD radar via IEM WMS
   
   Why WMS instead of tile cache:
   - Tile cache (IEM + NOAA) returns 404s or HTML error pages (ORB-blocked)
   - WMS protocol always returns proper image/png content-type
   - L.tileLayer.wms handles coordinate conversion automatically
   - IEM WMS supports TIME parameter for animated frames
   ════════════════════════════════════════════════════════════════ */

const RadarMap = (() => {

    let map = null;
    let frames = [];     // [{time, layer}]
    let currentFrame = 0;
    let animating = true;
    let animTimer = null;
    let initialized = false;
    let pendingLat = null;
    let pendingLon = null;
    let refreshTimer = null;

    const FRAME_COUNT = 6;
    const FRAME_MIN = 5;        // minutes between radar scans
    const ANIM_INTERVAL = 700;      // ms per animation step
    const WMS_OPACITY = 0.7;

    // IEM WMS endpoints (NEXRAD composite base reflectivity)
    const WMS_URL = 'https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q.cgi';
    const WMS_LAYER = 'nexrad-n0q';

    // ── Generate UTC timestamps ────────────────────────────────────
    // IEM WMS accepts ISO 8601 strings: 2024-01-01T00:00:00Z
    function makeTimes() {
        const now = Date.now();
        // Round to previous 5-min mark, then back extra 15 min for propagation lag
        const base = Math.floor(now / (FRAME_MIN * 60_000)) * (FRAME_MIN * 60_000) - 15 * 60_000;
        const times = [];
        for (let i = FRAME_COUNT - 1; i >= 0; i--) {
            times.push(new Date(base - i * FRAME_MIN * 60_000));
        }
        return times;
    }

    function isoZ(d) { return d.toISOString().replace(/\.\d{3}Z$/, 'Z'); }

    // ── Build WMS layer for a given time ──────────────────────────
    function makeWmsLayer(dt) {
        return L.tileLayer.wms(WMS_URL, {
            layers: WMS_LAYER,
            format: 'image/png',
            transparent: true,
            version: '1.1.1',
            time: isoZ(dt),
            opacity: 0,          // hidden by default; shown via showFrame
            zIndex: 200,
            attribution: '<a href="https://www.mesonet.agron.iastate.edu/" target="_blank">IEM/NEXRAD</a>'
        });
    }

    // ── Build all animation frames ─────────────────────────────────
    function buildFrames() {
        // Remove old radar layers
        frames.forEach(f => map.removeLayer(f.layer));
        frames = [];

        const times = makeTimes();
        times.forEach(dt => {
            const layer = makeWmsLayer(dt);
            layer.addTo(map);
            frames.push({ dt, layer });
        });

        currentFrame = frames.length - 1;
        showFrame(currentFrame);
        buildDots();
        updateTimestamp();
        if (animating) startAnimation();
    }

    // ── Show one frame ────────────────────────────────────────────
    function showFrame(idx) {
        if (!frames.length) return;
        idx = ((idx % frames.length) + frames.length) % frames.length;
        frames.forEach((f, i) => f.layer.setOpacity(i === idx ? WMS_OPACITY : 0));
        currentFrame = idx;
        updateTimestamp();
        updateDots();

        const lv = document.getElementById('radar-updated');
        if (lv) lv.style.opacity = idx === frames.length - 1 ? '1' : '0.5';
    }

    // ── Animation ─────────────────────────────────────────────────
    function startAnimation() {
        clearInterval(animTimer);
        const btn = document.getElementById('radar-play');
        if (btn) btn.textContent = '⏸';
        animating = true;
        animTimer = setInterval(() => showFrame(currentFrame + 1), ANIM_INTERVAL);
    }

    function stopAnimation() {
        clearInterval(animTimer);
        animTimer = null;
        const btn = document.getElementById('radar-play');
        if (btn) btn.textContent = '▶';
        animating = false;
    }

    function toggleAnimation() { if (animating) stopAnimation(); else startAnimation(); }

    function jumpToLive() {
        showFrame(frames.length - 1);
        if (!animating) startAnimation();
    }

    // ── Timestamp display ─────────────────────────────────────────
    function updateTimestamp() {
        const el = document.getElementById('radar-timestamp');
        if (!el || !frames[currentFrame]) return;
        el.textContent = frames[currentFrame].dt.toLocaleTimeString('en-US', {
            hour: 'numeric', minute: '2-digit', hour12: true,
            timeZone: 'UTC', timeZoneName: 'short'
        });
    }

    // ── Frame dots ────────────────────────────────────────────────
    function buildDots() {
        const c = document.getElementById('radar-frame-dots');
        if (!c) return;
        c.innerHTML = '';
        frames.forEach((_, i) => {
            const d = document.createElement('div');
            d.className = 'radar-dot' + (i === currentFrame ? ' active' : '');
            d.addEventListener('click', () => { stopAnimation(); showFrame(i); });
            c.appendChild(d);
        });
    }

    function updateDots() {
        document.querySelectorAll('.radar-dot').forEach((d, i) =>
            d.classList.toggle('active', i === currentFrame));
    }

    // ── Init Leaflet map (once) ───────────────────────────────────
    function initMap(lat, lon) {
        if (initialized) {
            map.setView([lat, lon], map.getZoom());
            pendingLat = null;
            pendingLon = null;
            refreshAll();
            return;
        }

        const container = document.getElementById('radar-map');
        if (!container) return;
        initialized = true;

        map = L.map('radar-map', {
            center: [lat, lon],
            zoom: 4,
            zoomControl: true,
            attributionControl: true,
            scrollWheelZoom: true
        });

        // Dark base map
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '© <a href="https://www.openstreetmap.org">OSM</a> © <a href="https://carto.com/">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 15
        }).addTo(map);

        // Location marker
        const icon = L.divIcon({
            html: `<div style="
                width:12px;height:12px;
                background:var(--accent,#3b82f6);
                border:3px solid #fff;border-radius:50%;
                box-shadow:0 0 10px rgba(59,130,246,.9);
            "></div>`,
            className: '', iconSize: [12, 12], iconAnchor: [6, 6]
        });
        L.marker([lat, lon], { icon }).addTo(map).bindPopup('Your Location');

        // Build initial radar frames
        buildFrames();

        // Wire controls
        document.getElementById('radar-play')?.addEventListener('click', toggleAnimation);
        document.getElementById('radar-live')?.addEventListener('click', jumpToLive);

        // Refresh frames every 5 minutes
        refreshTimer = setInterval(refreshAll, 5 * 60_000);
    }

    function refreshAll() { stopAnimation(); buildFrames(); }

    // ── Public ────────────────────────────────────────────────────
    function render(lat, lon) {
        if (!lat || !lon) return;
        if (!initialized) {
            pendingLat = lat;
            pendingLon = lon;
            setTimeout(() => initMap(lat, lon), 150);
        } else {
            map.setView([lat, lon], map.getZoom());
            refreshAll();
        }
    }

    function onSlideVisible() {
        if (map) map.invalidateSize();
        else if (pendingLat) initMap(pendingLat, pendingLon);
    }

    return { render, onSlideVisible };
})();
