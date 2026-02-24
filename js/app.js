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
            { id: 'slide-radar', display: 'radar', label: 'RADAR' },
            { id: 'slide-alerts', display: 'alerts', label: 'ALERTS' },
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

    // ── Slide transitions ──────────────────────────────────────────
    function showSlide(idx) {
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
        setTimeout(() => el.classList.add('active'), 20);

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

        // Radar: notify Leaflet the container is now visible
        if (target.display === 'radar' && typeof RadarMap !== 'undefined') {
            setTimeout(() => RadarMap.onSlideVisible(), 100);
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
    async function boot() {
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
            // Default to GPS, fallback to New York
            try {
                await setLocationGPS();
            } catch {
                await setLocation(DEFAULT_LOCATION);
            }
        }

        // Save location when user searches
        locationGo?.addEventListener('click', () => {
            try { localStorage.setItem('weathernow_location', JSON.stringify({ query: locationInput?.value })); } catch { }
        });
    }

    // ── Start ──────────────────────────────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

})();
