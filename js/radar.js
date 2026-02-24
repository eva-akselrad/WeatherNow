/* ════════════════════════════════════════════════════════════════
   radar.js – Leaflet map with animated RainViewer radar tiles
   Uses RainViewer public API (free, no key required)
   ════════════════════════════════════════════════════════════════ */

const RadarMap = (() => {

    let map = null;
    let radarLayers = [];
    let timestamps = [];
    let currentFrame = 0;
    let animating = true;
    let animTimer = null;
    let initialized = false;
    let pendingLat = null;
    let pendingLon = null;

    const RAINVIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json';
    const FRAME_INTERVAL = 600; // ms between frames during animation
    const COLOR_SCHEME = 2;   // 2 = classic radar green→red
    const SMOOTHING = 1;
    const SNOW = 1;

    // ── Initialize the map once ────────────────────────────────────
    function initMap(lat, lon) {
        if (initialized) {
            // Just pan to new location
            map.setView([lat, lon], 8);
            pendingLat = null;
            pendingLon = null;
            return;
        }

        // Make sure the container exists and has dimensions
        const container = document.getElementById('radar-map');
        if (!container) return;

        initialized = true;

        // Create Leaflet map
        map = L.map('radar-map', {
            center: [lat, lon],
            zoom: 8,
            zoomControl: true,
            attributionControl: true,
            scrollWheelZoom: true
        });

        // Dark-styled base tile layer (CartoDB Dark Matter)
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '© OpenStreetMap © CARTO',
            subdomains: 'abcd',
            maxZoom: 19
        }).addTo(map);

        // Location marker
        const icon = L.divIcon({
            html: `<div style="
        width:14px;height:14px;
        background:var(--accent,#3b82f6);
        border:3px solid #fff;
        border-radius:50%;
        box-shadow:0 0 10px rgba(59,130,246,0.8);
      "></div>`,
            className: '',
            iconSize: [14, 14],
            iconAnchor: [7, 7]
        });
        L.marker([lat, lon], { icon }).addTo(map).bindPopup('Your Location');

        // Load radar data
        loadRadarFrames();

        // Wire up playback controls
        bindControls();
    }

    // ── Fetch RainViewer frame list ────────────────────────────────
    async function loadRadarFrames() {
        try {
            const resp = await fetch(RAINVIEWER_API);
            if (!resp.ok) throw new Error('RainViewer API failed');
            const data = await resp.json();

            // Get past + nowcast frames
            const past = (data.radar?.past || []);
            const nowcast = (data.radar?.nowcast || []);
            const allFrames = [...past, ...nowcast];

            if (!allFrames.length) {
                showError('No radar frames available');
                return;
            }

            timestamps = allFrames;
            currentFrame = timestamps.length - 1; // start on latest

            // Remove old layers
            radarLayers.forEach(l => map.removeLayer(l));
            radarLayers = [];

            // Create a tile layer for each timestamp (but only show the current one)
            timestamps.forEach((frame, i) => {
                const url = `${data.host}${frame.path}/512/{z}/{x}/{y}/${COLOR_SCHEME}/${SMOOTHING}_${SNOW}.png`;
                const layer = L.tileLayer(url, {
                    opacity: i === currentFrame ? 0.75 : 0,
                    zIndex: 200 + i,
                    attribution: 'RainViewer'
                });
                layer.addTo(map);
                radarLayers.push(layer);
            });

            updateTimestamp();
            buildFrameDots();

            // Start animation
            if (animating) startAnimation();

        } catch (err) {
            console.warn('Radar load error:', err);
            showError('Radar data unavailable');
        }
    }

    // ── Show/hide layers by frame ──────────────────────────────────
    function showFrame(idx) {
        if (!radarLayers.length) return;
        idx = ((idx % radarLayers.length) + radarLayers.length) % radarLayers.length;

        radarLayers.forEach((layer, i) => {
            layer.setOpacity(i === idx ? 0.75 : 0);
        });

        currentFrame = idx;
        updateTimestamp();
        updateFrameDots();

        // Live badge brightness
        const liveBadge = document.getElementById('radar-updated');
        if (liveBadge) {
            const isLive = idx === radarLayers.length - 1;
            liveBadge.style.opacity = isLive ? '1' : '0.45';
        }
    }

    // ── Animation loop ─────────────────────────────────────────────
    function startAnimation() {
        clearInterval(animTimer);
        animTimer = setInterval(() => {
            const next = (currentFrame + 1) % radarLayers.length;
            showFrame(next);
        }, FRAME_INTERVAL);
        const btn = document.getElementById('radar-play');
        if (btn) btn.textContent = '⏸';
        animating = true;
    }

    function stopAnimation() {
        clearInterval(animTimer);
        animTimer = null;
        const btn = document.getElementById('radar-play');
        if (btn) btn.textContent = '▶';
        animating = false;
    }

    function toggleAnimation() {
        if (animating) stopAnimation(); else startAnimation();
    }

    function jumpToLive() {
        stopAnimation();
        showFrame(radarLayers.length - 1);
        startAnimation();
    }

    // ── Timestamp label ────────────────────────────────────────────
    function updateTimestamp() {
        const label = document.getElementById('radar-timestamp');
        if (!label || !timestamps[currentFrame]) return;
        const ts = timestamps[currentFrame].time;
        const d = new Date(ts * 1000);
        label.textContent = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    }

    // ── Frame dots ────────────────────────────────────────────────
    function buildFrameDots() {
        const container = document.getElementById('radar-frame-dots');
        if (!container) return;
        container.innerHTML = '';
        timestamps.forEach((_, i) => {
            const dot = document.createElement('div');
            dot.className = 'radar-dot' + (i === currentFrame ? ' active' : '');
            dot.addEventListener('click', () => { stopAnimation(); showFrame(i); });
            container.appendChild(dot);
        });
    }

    function updateFrameDots() {
        const dots = document.querySelectorAll('.radar-dot');
        dots.forEach((d, i) => d.classList.toggle('active', i === currentFrame));
    }

    // ── Error state ────────────────────────────────────────────────
    function showError(msg) {
        const container = document.getElementById('radar-map');
        if (container) {
            container.innerHTML = `<div style="
        display:flex;align-items:center;justify-content:center;
        height:100%;color:var(--text-secondary,#94a3b8);
        font-size:0.9rem;gap:10px;flex-direction:column;
      ">
        <span style="font-size:2rem">🛰</span>
        <span>${msg}</span>
      </div>`;
        }
    }

    // ── Control bindings ───────────────────────────────────────────
    function bindControls() {
        document.getElementById('radar-play')?.addEventListener('click', toggleAnimation);
        document.getElementById('radar-live')?.addEventListener('click', jumpToLive);
    }

    // ── Public: render (called by displays.js) ────────────────────
    function render(lat, lon) {
        if (!lat || !lon) return;

        // Leaflet needs the container to be visible to initialize correctly
        const container = document.getElementById('radar-map');
        if (!container) return;

        if (!initialized) {
            pendingLat = lat;
            pendingLon = lon;
            // Use a short delay to ensure the slide is visible before init
            setTimeout(() => initMap(lat, lon), 150);
        } else {
            map.setView([lat, lon], 8);
            loadRadarFrames(); // refresh frames on location change
        }
    }

    // ── Call this when the radar slide becomes visible ─────────────
    function onSlideVisible() {
        if (map) {
            map.invalidateSize(); // fix grey tiles from hidden init
        } else if (pendingLat) {
            initMap(pendingLat, pendingLon);
        }
    }

    return { render, onSlideVisible };
})();
