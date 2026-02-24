/* ════════════════════════════════════════════════════════════════
   settings.js – Settings panel, theme, kiosk mode controller
   ════════════════════════════════════════════════════════════════ */

const Settings = (() => {

    let currentTheme = 'dark';
    let isKiosk = false;
    let onSettingsChange = null;

    // ── Public: init ───────────────────────────────────────────────
    function init(onChange) {
        onSettingsChange = onChange;
        bindPanel();
        bindTheme();
        bindKiosk();
        bindUnitToggle();
        bindSpeedSlider();
        bindAlertToggles();
        loadFromStorage();
    }

    // ── Settings panel open/close ──────────────────────────────────
    function bindPanel() {
        const openBtn = document.getElementById('settings-open');
        const closeBtn = document.getElementById('settings-close');
        const overlay = document.getElementById('settings-overlay');
        const panel = document.getElementById('settings-panel');

        openBtn?.addEventListener('click', openPanel);
        closeBtn?.addEventListener('click', closePanel);
        overlay?.addEventListener('click', closePanel);

        // Escape key
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                if (isKiosk) exitKiosk();
                else closePanel();
            }
        });
    }

    function openPanel() {
        const panel = document.getElementById('settings-panel');
        const overlay = document.getElementById('settings-overlay');
        panel?.classList.add('open');
        overlay?.classList.remove('hidden');
    }

    function closePanel() {
        const panel = document.getElementById('settings-panel');
        const overlay = document.getElementById('settings-overlay');
        panel?.classList.remove('open');
        overlay?.classList.add('hidden');
    }

    // ── Theme ──────────────────────────────────────────────────────
    function bindTheme() {
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                setTheme(btn.dataset.theme);
                document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                saveToStorage();
            });
        });
    }

    function setTheme(theme) {
        const body = document.getElementById('app-body');
        body.className = body.className.replace(/theme-\S+/g, '').trim();
        body.classList.add(`theme-${theme}`);
        currentTheme = theme;
    }

    // ── Kiosk Mode ────────────────────────────────────────────────
    function bindKiosk() {
        const kioskBtn = document.getElementById('kiosk-btn');
        const fsBtn = document.getElementById('nav-fullscreen');

        kioskBtn?.addEventListener('click', () => { closePanel(); enterKiosk(); });
        fsBtn?.addEventListener('click', () => {
            if (isKiosk) exitKiosk();
            else enterKiosk();
        });

        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement && isKiosk) exitKiosk();
        });
    }

    function enterKiosk() {
        document.body.classList.add('kiosk-mode');
        isKiosk = true;
        const fsBtn = document.getElementById('nav-fullscreen');
        if (fsBtn) fsBtn.textContent = '⊠';
        document.documentElement.requestFullscreen?.().catch(() => { });
    }

    function exitKiosk() {
        document.body.classList.remove('kiosk-mode');
        isKiosk = false;
        const fsBtn = document.getElementById('nav-fullscreen');
        if (fsBtn) fsBtn.textContent = '⛶';
        if (document.fullscreenElement) document.exitFullscreen?.();
    }

    // ── Unit toggle ────────────────────────────────────────────────
    function bindUnitToggle() {
        const toggle = document.getElementById('unit-toggle');
        const label = document.getElementById('unit-label');
        toggle?.addEventListener('change', e => {
            const isCelsius = e.target.checked;
            if (label) label.textContent = isCelsius ? '°C' : '°F';
            onSettingsChange?.({ type: 'units', celsius: isCelsius });
            saveToStorage();
        });
    }

    // ── Speed slider ───────────────────────────────────────────────
    function bindSpeedSlider() {
        const slider = document.getElementById('speed-slider');
        const display = document.getElementById('speed-value');
        slider?.addEventListener('input', e => {
            if (display) display.textContent = e.target.value;
            onSettingsChange?.({ type: 'speed', seconds: parseInt(e.target.value) });
            saveToStorage();
        });
    }

    // ── Active displays ────────────────────────────────────────────
    function getActiveDisplays() {
        const checks = document.querySelectorAll('[data-display]');
        const active = [];
        checks.forEach(cb => { if (cb.checked) active.push(cb.dataset.display); });
        return active;
    }

    function bindDisplayToggles(onChange) {
        document.querySelectorAll('.checkbox-grid input[type=checkbox]').forEach(cb => {
            cb.addEventListener('change', () => {
                onChange?.(getActiveDisplays());
                saveToStorage();
            });
        });
    }

    // ── TTS & Duck toggles ─────────────────────────────────────────
    function getTTSEnabled() { return document.getElementById('tts-toggle')?.checked ?? true; }
    function getDuckEnabled() { return document.getElementById('duck-toggle')?.checked ?? true; }

    function bindAlertToggles() {
        document.getElementById('tts-toggle')?.addEventListener('change', e => {
            if (typeof AlertsManager !== 'undefined') AlertsManager.setTTS(e.target.checked);
        });
        document.getElementById('duck-toggle')?.addEventListener('change', e => {
            if (typeof AlertsManager !== 'undefined') AlertsManager.setDuck(e.target.checked);
        });

        // TTS test buttons
        const ttsStatus = document.getElementById('tts-status');
        document.getElementById('tts-test-btn')?.addEventListener('click', () => {
            if (typeof AlertsManager === 'undefined') return;
            if (ttsStatus) ttsStatus.textContent = '🔊 Speaking test alert...';
            AlertsManager.testAlert(
                () => { if (typeof MusicPlayer !== 'undefined') MusicPlayer.duck(); },
                () => {
                    if (typeof MusicPlayer !== 'undefined') MusicPlayer.unduck();
                    if (ttsStatus) ttsStatus.textContent = '✓ Test complete';
                    setTimeout(() => { if (ttsStatus) ttsStatus.textContent = ''; }, 3000);
                }
            );
        });

        document.getElementById('tts-test-conditions')?.addEventListener('click', () => {
            if (typeof AlertsManager === 'undefined') return;
            // Build a simple current conditions text from the DOM
            const temp = document.getElementById('cond-temp')?.textContent || '--';
            const desc = document.getElementById('cond-desc')?.textContent || '';
            const wind = document.getElementById('cond-wind')?.textContent || '';
            const humidity = document.getElementById('cond-humidity')?.textContent || '';
            const loc = document.getElementById('location-display')?.textContent || 'your area';
            const text = `Current conditions for ${loc}: ${desc}, ${temp}. Wind ${wind}. Humidity ${humidity}.`;
            if (ttsStatus) ttsStatus.textContent = '🌤 Reading conditions...';
            AlertsManager.testConditions(
                text,
                () => { if (typeof MusicPlayer !== 'undefined') MusicPlayer.duck(); },
                () => {
                    if (typeof MusicPlayer !== 'undefined') MusicPlayer.unduck();
                    if (ttsStatus) ttsStatus.textContent = '✓ Done';
                    setTimeout(() => { if (ttsStatus) ttsStatus.textContent = ''; }, 3000);
                }
            );
        });
    }

    // ── Persistence ────────────────────────────────────────────────
    function saveToStorage() {
        try {
            const state = {
                theme: currentTheme,
                units: document.getElementById('unit-toggle')?.checked ? 'celsius' : 'fahrenheit',
                speed: document.getElementById('speed-slider')?.value || 12,
                displays: getActiveDisplays(),
                volume: document.getElementById('volume-slider')?.value || 40,
                tts: document.getElementById('tts-toggle')?.checked ?? true,
                duck: document.getElementById('duck-toggle')?.checked ?? true,
                shuffle: document.getElementById('shuffle-toggle')?.checked ?? true,
            };
            localStorage.setItem('weathernow_settings', JSON.stringify(state));
        } catch { }
    }

    function loadFromStorage() {
        try {
            const raw = localStorage.getItem('weathernow_settings');
            if (!raw) return;
            const state = JSON.parse(raw);

            if (state.theme) {
                setTheme(state.theme);
                document.querySelectorAll('.theme-btn').forEach(b => {
                    b.classList.toggle('active', b.dataset.theme === state.theme);
                });
            }

            const unitToggle = document.getElementById('unit-toggle');
            const unitLabel = document.getElementById('unit-label');
            if (unitToggle && state.units) {
                unitToggle.checked = state.units === 'celsius';
                if (unitLabel) unitLabel.textContent = state.units === 'celsius' ? '°C' : '°F';
            }

            const speedSlider = document.getElementById('speed-slider');
            const speedDisplay = document.getElementById('speed-value');
            if (speedSlider && state.speed) {
                speedSlider.value = state.speed;
                if (speedDisplay) speedDisplay.textContent = state.speed;
            }

            const volSlider = document.getElementById('volume-slider');
            if (volSlider && state.volume !== undefined) volSlider.value = state.volume;

            if (state.displays) {
                document.querySelectorAll('[data-display]').forEach(cb => {
                    cb.checked = state.displays.includes(cb.dataset.display);
                });
            }

            const ttsT = document.getElementById('tts-toggle');
            const duckT = document.getElementById('duck-toggle');
            const shuffT = document.getElementById('shuffle-toggle');
            if (ttsT && state.tts !== undefined) ttsT.checked = state.tts;
            if (duckT && state.duck !== undefined) duckT.checked = state.duck;
            if (shuffT && state.shuffle !== undefined) shuffT.checked = state.shuffle;

        } catch { }
    }

    function getSpeed() {
        return parseInt(document.getElementById('speed-slider')?.value || 12) * 1000;
    }

    return { init, openPanel, closePanel, getActiveDisplays, bindDisplayToggles, getSpeed, saveToStorage };
})();
