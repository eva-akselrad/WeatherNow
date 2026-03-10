/* ════════════════════════════════════════════════════════════════
   radar.js – Leaflet map with animated radar via RainViewer API

   Why RainViewer instead of IEM WMS:
   - IEM nexrad-n0q WMS ignores the TIME parameter and always returns
     the current composite, so all animation frames were identical.
   - setParams()+redraw() re-fetches tiles on every 700ms step; WMS
     tiles take 1-3 s to load so the overlay was perpetually blank.
   - RainViewer's public API returns Unix-timestamped tile cache paths
     (no API key required).  Each frame has a unique URL so the browser
     fetches and caches distinct images, and the opacity-toggle
     animation is smooth because tiles are pre-loaded in the background.
   ════════════════════════════════════════════════════════════════ */

const RadarMap = (() => {
  let map = null;
  let frames = []; // [{dt, layer}]
  let currentFrame = 0;
  let animating = true;
  let animTimer = null;
  let initialized = false;
  let pendingLat = null;
  let pendingLon = null;
  let refreshTimer = null;

  const FRAME_COUNT = 6;
  const ANIM_INTERVAL = 700; // ms per animation step
  const RADAR_OPACITY = 0.7;

  // RainViewer public API – no key required
  const RV_API = "https://api.rainviewer.com/public/weather-maps.json";
  // Tile URL template filled in per-frame from the API response
  // path = e.g. "/v2/radar/1699999800"
  // color 2 = classic colorized, smooth+snow flags = 1_1
  const RV_TILE = (path) =>
    `https://tilecache.rainviewer.com${path}/256/{z}/{x}/{y}/2/1_1.png`;

  // ── Fetch available radar frames from RainViewer ───────────────
  async function fetchRainViewerFrames() {
    try {
      const resp = await fetch(RV_API);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const past = data.radar?.past ?? [];
      return past.slice(-FRAME_COUNT);
    } catch (e) {
      console.warn("RainViewer fetch failed:", e);
      return [];
    }
  }

  // ── Build a tile layer for one RainViewer frame ───────────────
  function makeRVLayer(path) {
    return L.tileLayer(RV_TILE(path), {
      tileSize: 256,
      opacity: 0, // hidden until showFrame makes it visible
      zIndex: 200,
      // RainViewer 256-px tiles are only rendered for zoom levels 0–6.
      // Setting maxNativeZoom prevents Leaflet from requesting unsupported
      // zoom levels (which return a "Zoom Level Not Supported" error image);
      // at higher map zooms Leaflet upscales the zoom-6 tile instead.
      maxNativeZoom: 6,
      attribution:
        '<a href="https://rainviewer.com" target="_blank">RainViewer</a>',
    });
  }

  // ── Build all animation frames ─────────────────────────────────
  async function buildFrames() {
    // Remove old radar layers
    frames.forEach((f) => {
      if (map.hasLayer(f.layer)) map.removeLayer(f.layer);
    });
    frames = [];

    const rvFrames = await fetchRainViewerFrames();
    if (!rvFrames.length) {
      console.warn("No radar frames available from RainViewer");
      return;
    }

    rvFrames.forEach(({ time, path }) => {
      const layer = makeRVLayer(path);
      layer.addTo(map);
      frames.push({ dt: new Date(time * 1000), layer });
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
    frames.forEach((f, i) =>
      f.layer.setOpacity(i === idx ? RADAR_OPACITY : 0),
    );
    currentFrame = idx;
    updateTimestamp();
    updateDots();

    const lv = document.getElementById("radar-updated");
    if (lv) lv.style.opacity = idx === frames.length - 1 ? "1" : "0.5";
  }

  // ── Animation ─────────────────────────────────────────────────
  function startAnimation() {
    clearInterval(animTimer);
    const btn = document.getElementById("radar-play");
    if (btn) btn.textContent = "⏸";
    animating = true;
    animTimer = setInterval(() => showFrame(currentFrame + 1), ANIM_INTERVAL);
  }

  function stopAnimation() {
    clearInterval(animTimer);
    animTimer = null;
    const btn = document.getElementById("radar-play");
    if (btn) btn.textContent = "▶";
    animating = false;
  }

  function toggleAnimation() {
    if (animating) stopAnimation();
    else startAnimation();
  }

  function jumpToLive() {
    showFrame(frames.length - 1);
    if (!animating) startAnimation();
  }

  // ── Timestamp display ─────────────────────────────────────────
  function updateTimestamp() {
    const el = document.getElementById("radar-timestamp");
    if (!el || !frames[currentFrame]) return;
    el.textContent = frames[currentFrame].dt.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "UTC",
      timeZoneName: "short",
    });
  }

  // ── Frame dots ────────────────────────────────────────────────
  function buildDots() {
    const c = document.getElementById("radar-frame-dots");
    if (!c) return;
    c.innerHTML = "";
    frames.forEach((_, i) => {
      const d = document.createElement("div");
      d.className = "radar-dot" + (i === currentFrame ? " active" : "");
      d.addEventListener("click", () => {
        stopAnimation();
        showFrame(i);
      });
      c.appendChild(d);
    });
  }

  function updateDots() {
    document
      .querySelectorAll(".radar-dot")
      .forEach((d, i) => d.classList.toggle("active", i === currentFrame));
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

    const container = document.getElementById("radar-map");
    if (!container) return;
    initialized = true;

    map = L.map("radar-map", {
      center: [lat, lon],
      zoom: 7,
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: true,
    });

    // Dark base map
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      {
        attribution:
          '© <a href="https://www.openstreetmap.org">OSM</a> © <a href="https://carto.com/">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 15,
      },
    ).addTo(map);

    // Location marker
    const icon = L.divIcon({
      html: `<div style="
                width:12px;height:12px;
                background:var(--accent,#3b82f6);
                border:3px solid #fff;border-radius:50%;
                box-shadow:0 0 10px rgba(59,130,246,.9);
            "></div>`,
      className: "",
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });
    L.marker([lat, lon], { icon }).addTo(map).bindPopup("Your Location");

    // Build initial radar frames
    buildFrames();

    // Wire controls
    document
      .getElementById("radar-play")
      ?.addEventListener("click", toggleAnimation);
    document
      .getElementById("radar-live")
      ?.addEventListener("click", jumpToLive);

    // Refresh frames every 5 minutes
    refreshTimer = setInterval(refreshAll, 5 * 60_000);
  }

  function refreshAll() {
    clearInterval(animTimer);
    animTimer = null;
    buildFrames();
  }

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
