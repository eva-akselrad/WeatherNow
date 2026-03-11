/* ════════════════════════════════════════════════════════════════
   app.js – Main application controller
   Ties together: WeatherAPI, Displays, MusicPlayer, AlertsManager, Settings
   ════════════════════════════════════════════════════════════════ */

(() => {
    'use strict';

    // ── State ──────────────────────────────────────────────────────
    let slideIds = [];
    let currentSlide = 0;
    let cycleTimer = null;
    let progressTimer = null;
    let isPaused = false;
    let slideInterval = 12000;
    let progressStart = 0;
    let progressDuration = 0;
    let locationSet = false;
    let scrollRaf = null; // requestAnimationFrame handle for autoscroll

    const DEFAULT_LOCATION = 'New York, NY';

    // ── DOM refs ───────────────────────────────────────────────────
    const locationDisplay = document.getElementById('location-display');
    const locationInput = document.getElementById('location-input');
    const locationGo = document.getElementById('location-go');
    const locationGPS = document.getElementById('location-gps');
    const locationStatus = document.getElementById('location-status');
    const clockTime = document.getElementById('clock-time');
    const clockDate = document.getElementById('clock-date');
    const navPrev = document.getElementById('nav-prev');
    const navNext = document.getElementById('nav-next');
    const navPause = document.getElementById('nav-pause');
    const navRefresh = document.getElementById('nav-refresh');
    const loadingSlide = document.getElementById('slide-loading');
    const progressFill = document.getElementById('slide-progress');
    const dotsContainer = document.getElementById('slide-dots');

    // ── Clock ──────────────────────────────────────────────────────
    function startClock() {
        function tick() {
            const now = new Date();
            const h = now.getHours();
            const m = String(now.getMinutes()).padStart(2, '0');
            const s = String(now.getSeconds()).padStart(2, '0');
            const ampm = h >= 12 ? 'PM' : 'AM';
            const h12 = ((h % 12) || 12);
            if (clockTime) clockTime.textContent = `${h12}:${m}:${s} ${ampm}`;
            const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
            const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
            if (clockDate) clockDate.textContent = `${days[now.getDay()]} ${months[now.getMonth()]} ${now.getDate()}`;
        }
        tick();
        setInterval(tick, 1000);
    }

    // ── Build slide list from active displays ──────────────────────
    function buildSlideList() {
        const active = Settings.getActiveDisplays();
        const allSlides = [
            { id: 'slide-conditions', display: 'conditions', label: 'CONDITIONS' },
            { id: 'slide-observations', display: 'observations', label: 'OBSERVATIONS' },
            { id: 'slide-hourly', display: 'hourly', label: 'HOURLY' },
            { id: 'slide-extended', display: 'extended', label: 'EXTENDED' },
            { id: 'slide-precipchart', display: 'precipchart', label: 'PRECIPITATION' },
            { id: 'slide-almanac', display: 'almanac', label: 'ALMANAC' },
            { id: 'slide-airquality', display: 'airquality', label: 'AIR QUALITY' },
            { id: 'slide-pollen', display: 'pollen', label: 'POLLEN' },
            { id: 'slide-travel', display: 'travel', label: 'TRAVEL FORECAST' },
            { id: 'slide-regional-obs', display: 'regionalobs', label: 'REGIONAL OBSERVATIONS' },
            { id: 'slide-regional-fcst', display: 'regionalfcst', label: 'REGIONAL FORECAST' },
            { id: 'slide-spc', display: 'spc', label: 'SPC OUTLOOK' },
            { id: 'slide-radar', display: 'radar', label: 'RADAR' },
            { id: 'slide-alerts', display: 'alerts', label: 'ALERTS' },
            { id: 'slide-customforecast', display: 'customforecast', label: 'CUSTOM FORECAST' },
        ];

        slideIds = allSlides.filter(s => active.includes(s.display));
        buildDots();
    }

    // ── Navigation dots ────────────────────────────────────────────
    function buildDots() {
        if (!dotsContainer) return;
        dotsContainer.innerHTML = '';
        slideIds.forEach((s, i) => {
            const dot = document.createElement('div');
            dot.className = 'slide-dot' + (i === currentSlide ? ' active' : '');
            dot.addEventListener('click', () => goToSlide(i));
            dotsContainer.appendChild(dot);
        });
    }

    function updateDots() {
        dotsContainer?.querySelectorAll('.slide-dot').forEach((d, i) => {
            d.classList.toggle('active', i === currentSlide);
        });
    }

    // ── Auto-scroll ────────────────────────────────────────────────
    // Each slide that can overflow declares a primary scrollable container.
    // When a slide becomes active its container is smoothly scrolled so all
    // content is shown without user interaction.  The scroll resets to the
    // top/left when the slide is swapped out.
    const SCROLL_MAP = {
        'slide-hourly':       { id: 'hourly-container',  dir: 'x' },
        'slide-extended':     { id: 'extended-container', dir: 'y' },
        'slide-observations': { id: 'obs-grid',           dir: 'y' },
        'slide-alerts':       { id: 'alerts-container',   dir: 'y' },
        // travel, regional-obs, regional-fcst, spc all use fixed or map layouts
        // that manage their own sizing — no autoscroll needed
    };

    /** Stop any running autoscroll animation and reset the previous container. */
    function stopAutoScroll() {
        if (scrollRaf !== null) {
            cancelAnimationFrame(scrollRaf);
            scrollRaf = null;
        }
    }

    /**
     * Start a smooth autoscroll for the given slide element.
     * - 2 s initial pause so the viewer sees the beginning of the content.
     * - Scrolls at 40 px/s.
     * - At the end: 1.5 s pause, then jumps back to start and repeats.
     * - Skips silently if the container has no overflow.
     * - Pauses on mouse-enter, resumes on mouse-leave (kiosk-friendly).
     */
    function startAutoScroll(slideEl) {
        stopAutoScroll();
        if (!slideEl) return;

        const entry = SCROLL_MAP[slideEl.id];
        if (!entry) return;

        const container = document.getElementById(entry.id);
        if (!container) return;

        const isX = entry.dir === 'x';
        const PX_PER_S = 40;
        const INITIAL_DELAY_MS = 2000;
        const END_PAUSE_MS = 1500;

        // Reset position immediately when slide activates
        container.scrollLeft = 0;
        container.scrollTop = 0;

        let paused = false;
        let delayRemaining = INITIAL_DELAY_MS;
        let lastTs = null;
        let waitingAtEnd = false;

        function animate(ts) {
            if (paused) { scrollRaf = requestAnimationFrame(animate); return; }
            if (!lastTs) lastTs = ts;
            const dt = ts - lastTs;
            lastTs = ts;

            if (delayRemaining > 0) {
                delayRemaining -= dt;
                scrollRaf = requestAnimationFrame(animate);
                return;
            }

            if (waitingAtEnd) {
                scrollRaf = requestAnimationFrame(animate);
                return;
            }

            const px = (PX_PER_S * dt) / 1000;
            if (isX) {
                const maxScroll = container.scrollWidth - container.clientWidth;
                if (maxScroll <= 2) return; // nothing to scroll
                container.scrollLeft = Math.min(container.scrollLeft + px, maxScroll);
                if (container.scrollLeft >= maxScroll - 1) {
                    waitingAtEnd = true;
                    setTimeout(() => {
                        container.scrollLeft = 0;
                        delayRemaining = 800;
                        lastTs = null;
                        waitingAtEnd = false;
                    }, END_PAUSE_MS);
                }
            } else {
                const maxScroll = container.scrollHeight - container.clientHeight;
                if (maxScroll <= 2) return; // nothing to scroll
                container.scrollTop = Math.min(container.scrollTop + px, maxScroll);
                if (container.scrollTop >= maxScroll - 1) {
                    waitingAtEnd = true;
                    setTimeout(() => {
                        container.scrollTop = 0;
                        delayRemaining = 800;
                        lastTs = null;
                        waitingAtEnd = false;
                    }, END_PAUSE_MS);
                }
            }

            scrollRaf = requestAnimationFrame(animate);
        }

        // Pause on hover so users can read without the content sliding away
        container.addEventListener('mouseenter', () => { paused = true; }, { passive: true });
        container.addEventListener('mouseleave', () => { paused = false; lastTs = null; }, { passive: true });

        scrollRaf = requestAnimationFrame(animate);
    }

    // ── Slide transitions ──────────────────────────────────────────
    function showSlide(idx) {
        // Stop any running autoscroll before transitioning
        stopAutoScroll();

        // Hide all visible slides
        document.querySelectorAll('.slide.active').forEach(s => {
            s.classList.add('slide-exit');
            s.classList.remove('active');
            setTimeout(() => s.classList.remove('slide-exit'), 600);
        });

        const target = slideIds[idx];
        if (!target) return;
        const el = document.getElementById(target.id);
        if (!el) return;
        el.classList.remove('hidden', 'slide-exit');
        setTimeout(() => {
            el.classList.add('active');
            // Begin autoscroll once the slide has finished its enter animation
            startAutoScroll(el);
        }, 20);

        currentSlide = idx;
        updateDots();

        // Update ticker label
        Displays.updateTicker(WeatherAPI.getData(), target.label);

        // Update location display
        if (locationDisplay) locationDisplay.textContent = WeatherAPI.getLocation().label || 'Unknown';

        // Alerts slide behavior – skip via timeout to avoid re-entering showSlide mid-flight
        if (target.display === 'alerts') {
            const alerts = WeatherAPI.getAlerts();
            if (!alerts.length) {
                setTimeout(() => goToSlide((idx + 1) % slideIds.length), 50);
                return;
            }
        }

        // Custom Forecast slide – skip if no periods or viewer's location doesn't match targeting
        if (target.display === 'customforecast') {
            const forecasts = WeatherAPI.getData()?.customForecasts || [];
            const matching = forecasts.filter(cf => cf?.periods?.length && isInForecastArea(cf.targeting));
            if (!matching.length) {
                setTimeout(() => goToSlide((idx + 1) % slideIds.length), 50);
                return;
            }
        }

        // Radar: notify Leaflet the container is now visible
        if (target.display === 'radar' && typeof RadarMap !== 'undefined') {
            setTimeout(() => RadarMap.onSlideVisible(), 100);
        }

        // Regional map slides: initialise / refresh Leaflet when container becomes visible
        if (target.display === 'regionalobs' && typeof Displays !== 'undefined') {
            setTimeout(() => Displays.onRegionalObsVisible(), 80);
        }
        if (target.display === 'regionalfcst' && typeof Displays !== 'undefined') {
            setTimeout(() => Displays.onRegionalFcstVisible(), 80);
        }
    }

    function goToSlide(idx) {
        clearCycleTimer();
        if (idx < 0) idx = slideIds.length - 1;
        if (idx >= slideIds.length) idx = 0;
        showSlide(idx);
        if (!isPaused) startCycleTimer();
    }

    function nextSlide() {
        goToSlide((currentSlide + 1) % slideIds.length);
    }

    function prevSlide() {
        goToSlide((currentSlide - 1 + slideIds.length) % slideIds.length);
    }

    // ── Progress bar ───────────────────────────────────────────────
    function startProgressBar(duration) {
        if (!progressFill) return;
        progressFill.style.transition = 'none';
        progressFill.style.width = '0%';
        progressStart = performance.now();
        progressDuration = duration;
        requestAnimationFrame(updateProgressBar);
    }

    function updateProgressBar(now) {
        if (isPaused || !progressFill) return;
        const elapsed = now - progressStart;
        const pct = Math.min((elapsed / progressDuration) * 100, 100);
        progressFill.style.width = pct + '%';
        if (pct < 100) requestAnimationFrame(ts => updateProgressBar(ts));
    }

    // ── Cycle timer ────────────────────────────────────────────────
    function startCycleTimer() {
        clearCycleTimer();
        startProgressBar(slideInterval);
        cycleTimer = setTimeout(() => {
            nextSlide();
        }, slideInterval);
    }

    function clearCycleTimer() {
        clearTimeout(cycleTimer);
        cycleTimer = null;
    }

    function pauseCycle() {
        isPaused = true;
        clearCycleTimer();
        if (navPause) navPause.textContent = '▶';
    }

    function resumeCycle() {
        isPaused = false;
        if (navPause) navPause.textContent = '⏸';
        startCycleTimer();
    }

    // ── Weather data fetch & render ────────────────────────────────
    async function fetchAndRender(showLoading = false) {
        if (showLoading) showLoadingSlide();

        try {
            const { weather, alerts } = await WeatherAPI.fetchAll();
            const loc = WeatherAPI.getLocation();

            hideLoadingSlide();

            // Build/rebuild slide list
            buildSlideList();

            // Filter custom forecasts to only those that match viewer's location
            if (weather.customForecasts) {
                weather.customForecasts = weather.customForecasts.filter(cf => isInForecastArea(cf.targeting));
            }

            // Render all displays
            Displays.renderAll(
                weather, alerts,
                loc.lat, loc.lon,
                alert => AlertsManager.announceOne(alert, MusicPlayer.duck, MusicPlayer.unduck)
            );

            // Show/hide alert banner
            AlertsManager.showBanner(alerts);

            // Announce new alerts with TTS
            AlertsManager.announceNew(
                alerts,
                MusicPlayer.duck,
                MusicPlayer.unduck
            );

            // Update location display
            if (locationDisplay) locationDisplay.textContent = loc.label;

            // Start at first slide if coming from loading
            if (showLoading) {
                currentSlide = 0;
                showSlide(0);
                startCycleTimer();
            }

        } catch (err) {
            console.error('Weather fetch error:', err);
            if (locationStatus) locationStatus.textContent = '⚠ Failed to load weather data.';
            hideLoadingSlide();
        }
    }

    function showLoadingSlide() {
        clearCycleTimer();
        document.querySelectorAll('.slide.active').forEach(s => {
            s.classList.remove('active');
            s.classList.add('hidden');
        });
        if (loadingSlide) {
            loadingSlide.classList.remove('hidden');
            loadingSlide.style.opacity = '1';
            loadingSlide.style.transform = 'none';
        }
    }

    function hideLoadingSlide() {
        if (loadingSlide) {
            loadingSlide.style.transition = 'opacity 0.3s';
            loadingSlide.style.opacity = '0';
            setTimeout(() => {
                loadingSlide.classList.add('hidden');
                loadingSlide.style.opacity = '';
                loadingSlide.style.transition = '';
            }, 300);
        }
    }

    // ── Location handling ──────────────────────────────────────────
    async function setLocation(query) {
        if (!query.trim()) return;
        if (locationStatus) locationStatus.textContent = '🔍 Searching...';
        try {
            await WeatherAPI.loadLocation(query);
            locationSet = true;
            if (locationStatus) locationStatus.textContent = `✓ Set to: ${WeatherAPI.getLocation().label}`;
            fetchAndRender(true);
        } catch (err) {
            if (locationStatus) locationStatus.textContent = '⚠ Location not found. Try "City, State" format.';
        }
    }

    async function setLocationGPS() {
        if (locationStatus) locationStatus.textContent = '📡 Getting GPS location...';
        try {
            await WeatherAPI.loadGPS();
            locationSet = true;
            if (locationStatus) locationStatus.textContent = `✓ Set to: ${WeatherAPI.getLocation().label}`;
            fetchAndRender(true);
        } catch {
            if (locationStatus) locationStatus.textContent = '⚠ GPS unavailable. Enter location manually.';
        }
    }

    // ── Bind all event handlers ────────────────────────────────────
    function bindControls() {
        // Location
        locationGo?.addEventListener('click', () => setLocation(locationInput.value));
        locationInput?.addEventListener('keydown', e => { if (e.key === 'Enter') setLocation(locationInput.value); });
        locationGPS?.addEventListener('click', setLocationGPS);

        // Nav controls
        navPrev?.addEventListener('click', () => { prevSlide(); });
        navNext?.addEventListener('click', () => { nextSlide(); });
        navPause?.addEventListener('click', () => {
            if (isPaused) resumeCycle(); else pauseCycle();
        });
        navRefresh?.addEventListener('click', () => {
            if (locationSet) fetchAndRender(false);
        });

        // Settings callbacks
        Settings.bindDisplayToggles(() => {
            buildSlideList();
            if (currentSlide >= slideIds.length) currentSlide = 0;
            showSlide(currentSlide);
        });

        // Permalink
        const btnCopy = document.getElementById('btn-copy-permalink');
        btnCopy?.addEventListener('click', async () => {
            const status = document.getElementById('permalink-status');
            try {
                const state = Settings.getState();
                const loc = { query: locationInput?.value || WeatherAPI.getLocation().label };
                const checkKiosk = document.getElementById('permalink-kiosk-toggle');
                const isKiosk = checkKiosk ? checkKiosk.checked : false;

                const payload = { s: state, l: loc, k: isKiosk };
                const encoded = btoa(JSON.stringify(payload));

                const url = new URL(window.location.href);
                url.searchParams.set('s', encoded);

                await navigator.clipboard.writeText(url.toString());

                if (status) {
                    status.textContent = '✓ Copied to clipboard!';
                    status.style.color = '#4ade80';
                    setTimeout(() => { if (status.textContent === '✓ Copied to clipboard!') status.textContent = ''; }, 3000);
                }
            } catch (err) {
                console.error('Failed to copy permalink', err);
                if (status) {
                    status.textContent = '❌ Failed to copy';
                    status.style.color = '#f87171';
                    setTimeout(() => { if (status.textContent === '❌ Failed to copy') status.textContent = ''; }, 3000);
                }
            }
        });

        // Keyboard nav
        document.addEventListener('keydown', e => {
            if (e.target.tagName === 'INPUT') return;
            if (e.key === 'ArrowRight') nextSlide();
            if (e.key === 'ArrowLeft') prevSlide();
            if (e.key === 'p' || e.key === 'P') {
                if (isPaused) resumeCycle(); else pauseCycle();
            }
            if (e.key === 'r' || e.key === 'R') {
                if (locationSet) fetchAndRender(false);
            }
        });
    }

    // ── Auto-refresh every 5 minutes ──────────────────────────────
    function startAutoRefresh() {
        setInterval(() => {
            if (locationSet) fetchAndRender(false);
        }, 5 * 60 * 1000);
    }

    // ── Settings callbacks ─────────────────────────────────────────
    function onSettingsChange(change) {
        if (change.type === 'units') {
            WeatherAPI.setUnits(!change.celsius);
            if (locationSet) fetchAndRender(false);
        }
        if (change.type === 'speed') {
            slideInterval = change.seconds * 1000;
            if (!isPaused && locationSet) {
                clearCycleTimer();
                startCycleTimer();
            }
        }
    }

    // ── Boot ───────────────────────────────────────────────────────
    let autoKiosk = false;

    async function processPermalink() {
        try {
            const params = new URLSearchParams(window.location.search);
            const s = params.get('s');
            if (s) {
                const decoded = JSON.parse(atob(s));
                if (decoded.s) localStorage.setItem('weathernow_settings', JSON.stringify(decoded.s));
                if (decoded.l) localStorage.setItem('weathernow_location', JSON.stringify(decoded.l));
                if (decoded.k) autoKiosk = true;

                // Clean URL
                const url = new URL(window.location.href);
                url.searchParams.delete('s');
                window.history.replaceState({}, document.title, url.pathname + url.search);
            }
        } catch (err) {
            console.error("Failed to process permalink", err);
        }
    }

    async function boot() {
        await processPermalink();

        startClock();
        Settings.init(onSettingsChange);
        MusicPlayer.init();
        bindControls();
        startAutoRefresh();

        // Try to restore last location from storage
        const saved = (() => {
            try { return JSON.parse(localStorage.getItem('weathernow_location')); } catch { return null; }
        })();

        if (saved?.query) {
            if (locationInput) locationInput.value = saved.query;
            await setLocation(saved.query);
        } else {
            // First, use IP geolocation as an instant initial estimate (no permission required)
            let ipSuccess = false;
            try {
                await WeatherAPI.loadIPLocation();
                locationSet = true;
                if (locationStatus) locationStatus.textContent = `✓ Set to: ${WeatherAPI.getLocation().label}`;
                fetchAndRender(true).catch(err => console.error('Weather fetch error after IP geolocation:', err));
                ipSuccess = true;
            } catch {
                // IP geolocation unavailable; fall through to GPS
            }

            // Then try GPS for a more precise location
            if (ipSuccess) {
                // Weather is already loading; refine in the background without blocking
                setLocationGPS().catch(err => {
                    console.warn('GPS refinement failed, keeping IP-based location:', err);
                });
            } else {
                // No IP estimate available – must wait for GPS or fall back to default
                try {
                    await setLocationGPS();
                } catch {
                    await setLocation(DEFAULT_LOCATION);
                }
            }
        }

        // Save location when user searches
        locationGo?.addEventListener('click', () => {
            try { localStorage.setItem('weathernow_location', JSON.stringify({ query: locationInput?.value })); } catch { }
        });

        if (autoKiosk) {
            Settings.enterKiosk();
        }
    }

    // ── Custom Forecast Location Targeting ─────────────────────────
    function haversineDistance(lat1, lon1, lat2, lon2) {
        const R = 3958.8; // Earth radius in miles
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2
            + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function isInForecastArea(targeting) {
        if (!targeting || targeting.mode === 'all') return true;
        const loc = WeatherAPI.getLocation();
        if (!loc.lat) return true; // no viewer location → show by default

        if (targeting.mode === 'radius') {
            const c = targeting.center;
            const r = parseFloat(targeting.radiusMiles);
            if (!c?.lat || !c?.lon || !r) return true;
            return haversineDistance(loc.lat, loc.lon, c.lat, c.lon) <= r;
        }

        if (targeting.mode === 'zips') {
            const zips = (targeting.zips || []).map(z => String(z).trim()).filter(Boolean);
            if (!zips.length) return true;
            const details = WeatherAPI.getLocationDetails();
            if (!details?.zip) return true; // details not yet loaded → show
            return zips.includes(String(details.zip).trim());
        }

        if (targeting.mode === 'counties') {
            const counties = (targeting.counties || []).map(c => c.trim().toLowerCase()).filter(Boolean);
            if (!counties.length) return true;
            const details = WeatherAPI.getLocationDetails();
            if (!details?.county) return true;
            // Build a normalized "County Name ST" string for exact-match comparison
            const viewerToken = `${details.county} ${details.stateCode || ''}`.trim().toLowerCase();
            return counties.some(c => {
                // Exact match on the full "County Name ST" token
                const adminToken = c.toLowerCase().trim();
                return viewerToken === adminToken;
            });
        }

        return true;
    }

    // ── Start ──────────────────────────────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

})();
